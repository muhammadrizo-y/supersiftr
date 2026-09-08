use std::sync::Mutex;

use tauri::Manager;

use crate::actions;
use crate::config::{self, AppConfig};
use crate::kinds::{self, KindStore};
use crate::logging::ActivityLog;
use crate::sieves::{self, RuleAction, Sieve, SieveStore};
use crate::suffix::{self, SuffixStore};
use crate::watcher::FileWatcher;

pub struct AppState {
    pub watcher: Mutex<FileWatcher>,
    pub config: Mutex<AppConfig>,
    pub sieves: Mutex<SieveStore>,
    pub kinds: Mutex<KindStore>,
    pub suffixes: Mutex<SuffixStore>,
    pub log: ActivityLog,
    pub tray: Mutex<Option<tauri::tray::TrayIcon>>,
}

// Lock ordering: any block that holds more than one of these mutexes must
// acquire them in this canonical order — sieves → kinds → suffixes, and
// sieves → watcher. `process()` and `restart_watchers()` are the only nested
// acquisitions today and both start with `sieves`. Keep it that way or a new
// command that locks the reverse order will deadlock.

impl AppState {
    pub fn new() -> Self {
        let config_dir = config::config_dir().unwrap_or_default();
        Self {
            watcher: Mutex::new(FileWatcher::new()),
            config: Mutex::new(config::load().unwrap_or_default()),
            sieves: Mutex::new(sieves::load().unwrap_or_default()),
            kinds: Mutex::new(kinds::load().unwrap_or_default()),
            suffixes: Mutex::new(suffix::load().unwrap_or_default()),
            log: ActivityLog::new(config_dir),
            tray: Mutex::new(None),
        }
    }

    /// Reloads the persisted sieves into state, then restarts watchers — but
    /// only when the file actually changed. The app itself writes `sieves.json`
    /// on every mutation, which the file watcher also sees; without this guard
    /// each save would trigger an unnecessary `restart_watchers` (and the
    /// re-watch churn would look like an endless loop from the outside).
    pub fn reload(app: &tauri::AppHandle) -> Result<(), String> {
        let state = app.state::<AppState>();
        let loaded = sieves::load().map_err(|e| e.to_string())?;
        {
            let current = state.sieves.lock().unwrap();
            if serde_json::to_string(&current.sieves).unwrap_or_default()
                == serde_json::to_string(&loaded.sieves).unwrap_or_default()
            {
                return Ok(());
            }
            drop(current);
        }
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
                let folder_path = std::path::PathBuf::from(folder);
                let folder_str = folder_path.display().to_string();
                if !folder_path.is_dir() {
                    state.log.write(
                        app,
                        "error",
                        &format!("Cannot watch non-existent folder: \"{folder_str}\""),
                    );
                    continue;
                }
                let app_handle = app.clone();
                if let Err(e) = watcher.watch(folder_path, move |path| {
                    Self::process(app_handle.clone(), path);
                }) {
                    state.log.write(
                        app,
                        "error",
                        &format!("Failed to watch \"{folder_str}\": {e}"),
                    );
                }
            }

            // Hot-reload the sieves file: any edit restarts watchers against
            // the freshly loaded sieves.
            if let Ok(path) = sieves::sieves_path() {
                let app_handle = app.clone();
                if let Err(e) = watcher.watch_file(path, move || {
                    let _ = Self::reload(&app_handle);
                }) {
                    state.log.write(app, "error", &format!("Failed to watch sieves file: {e}"));
                }
            }
        }
        Ok(())
    }

    /// Applies sieves to `path`. Called from the watcher thread on every event.
    /// Skips files that no longer exist (already handled by a prior event).
    pub fn process(app: tauri::AppHandle, path: std::path::PathBuf) {
        let state = app.state::<AppState>();
        let (sieves, kinds, custom_suffixes) = {
            let sieves = state.sieves.lock().unwrap();
            let kinds = state.kinds.lock().unwrap();
            let suffixes = state.suffixes.lock().unwrap();
            (sieves.sieves.clone(), kinds.kinds.clone(), suffixes.custom_suffixes.clone())
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
            if sieve.matches(&path, &kinds) {
                let mut current = path.to_owned();
                for action in &sieve.actions {
                    match actions::execute(&current, action, &custom_suffixes) {
                        Ok(dest) => {
                            let verb = action_verb(action);
                            state.log.write(
                                &app,
                                "info",
                                &format!(
                                    "[{}] {verb} \"{}\" -> \"{}\"",
                                    sieve.name,
                                    current
                                        .file_name()
                                        .map(|n| n.to_string_lossy().to_string())
                                        .unwrap_or_default(),
                                    dest.to_string_lossy(),
                                ),
                            );
                            current = dest;
                        }
                        Err(actions::ActionError::SourceNotFound(_)) => {
                            // A prior action in this chain already moved the file,
                            // or a duplicate event fired; not an error.
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
                                &format!(
                                    "[{}] \"{}\": {error}",
                                    sieve.name,
                                    current.to_string_lossy()
                                ),
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
