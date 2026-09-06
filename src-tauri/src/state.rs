use std::sync::Mutex;

use tauri::Manager;

use crate::actions;
use crate::config::{self, AppConfig};
use crate::logging::ActivityLog;
use crate::presets::{self, PresetStore};
use crate::sieves::{self, RuleAction, Sieve, SieveStore};
use crate::watcher::FileWatcher;

pub struct AppState {
    pub watcher: Mutex<FileWatcher>,
    pub config: Mutex<AppConfig>,
    pub sieves: Mutex<SieveStore>,
    pub presets: Mutex<PresetStore>,
    pub log: ActivityLog,
    pub tray: Mutex<Option<tauri::tray::TrayIcon>>,
}

impl AppState {
    pub fn new() -> Self {
        let config_dir = config::config_dir().unwrap_or_default();
        Self {
            watcher: Mutex::new(FileWatcher::new()),
            config: Mutex::new(config::load().unwrap_or_default()),
            sieves: Mutex::new(sieves::load().unwrap_or_default()),
            presets: Mutex::new(presets::load().unwrap_or_default()),
            log: ActivityLog::new(config_dir),
            tray: Mutex::new(None),
        }
    }

    /// Reloads the persisted sieves into state, then restarts watchers.
    pub fn reload(app: &tauri::AppHandle) -> Result<(), String> {
        let state = app.state::<AppState>();
        let loaded = sieves::load().map_err(|e| e.to_string())?;
        {
            let mut sieves = state.sieves.lock().unwrap();
            *sieves = loaded;
        }
        Self::restart_watchers(app)
    }

    pub fn restart_watchers(app: &tauri::AppHandle) -> Result<(), String> {
        let state = app.state::<AppState>();

        let folders: Vec<String> = {
            let sieves = state.sieves.lock().unwrap();
            collect_watch_folders(&sieves.sieves)
        };

        {
            let mut watcher = state.watcher.lock().unwrap();
            watcher.stop();
            for folder in folders {
                let app = app.clone();
                watcher.watch(folder.into(), move |path| {
                    Self::process(app.clone(), path);
                })?;
            }

            // Hot-reload the sieves file: any edit restarts watchers against
            // the freshly loaded sieves.
            if let Ok(path) = sieves::sieves_path() {
                let app = app.clone();
                watcher.watch_file(path, move || {
                    let _ = Self::reload(&app);
                })?;
            }
        }
        Ok(())
    }

    /// Applies sieves to `path`. Called from the watcher thread on every event.
    /// Skips files that no longer exist (already handled by a prior event).
    pub fn process(app: tauri::AppHandle, path: std::path::PathBuf) {
        let state = app.state::<AppState>();
        let (sieves, presets) = {
            let sieves = state.sieves.lock().unwrap();
            let presets = state.presets.lock().unwrap();
            (sieves.sieves.clone(), presets.presets.clone())
        };

        if !path.is_file() {
            return;
        }

        for sieve in &sieves {
            if !sieve.applies_to(&path) {
                continue;
            }
            if !sieve.is_runnable() {
                continue;
            }
            if sieve.matches(&path, &presets) {
                for action in &sieve.actions {
                    match actions::execute(&path, action) {
                        Ok(dest) => {
                            let verb = action_verb(action);
                            state.log.write(
                                &app,
                                "info",
                                &format!(
                                    "[{}] {verb} \"{}\" -> \"{}\"",
                                    sieve.name,
                                    path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                                    dest.to_string_lossy(),
                                ),
                            );
                        }
                        Err(actions::ActionError::SourceNotFound(_)) => {
                            // The file was already moved by an earlier duplicate
                            // event; not an error, so just ignore it.
                        }
                        Err(e) => {
                            let mut error = e.to_string();
                            // Trim the redundant path prefix.
                            if let Some(pos) = error.find(": ") {
                                let shorthand = &error[pos + 2..];
                                if !shorthand.is_empty() {
                                    error = shorthand.to_string();
                                }
                            }
                            state.log.write(
                                &app,
                                "error",
                                &format!("[{}] \"{}\": {error}", sieve.name, path.to_string_lossy()),
                            );
                        }
                    }
                }
                break;
            }
        }
    }
}

fn action_verb(action: &RuleAction) -> &'static str {
    match action {
        RuleAction::Move { .. } => "Moved",
        RuleAction::Copy { .. } => "Copied",
        RuleAction::Rename { .. } => "Renamed",
    }
}

/// Returns the deduplicated set of folders watched across all sieves.
fn collect_watch_folders(sieves: &[Sieve]) -> Vec<String> {
    let mut folders: Vec<String> = Vec::new();
    for sieve in sieves {
        for folder in &sieve.watched_folders {
            if !folders.contains(folder) {
                folders.push(folder.clone());
            }
        }
    }
    folders
}
