use std::sync::Mutex;

use tauri::Manager;

use crate::actions;
use crate::config::{self, AppConfig};
use crate::logging::ActivityLog;
use crate::rules::{Rule, RuleAction};
use crate::watcher::FileWatcher;

pub struct AppState {
    pub watcher: Mutex<FileWatcher>,
    pub config: Mutex<AppConfig>,
    pub log: ActivityLog,
}

impl AppState {
    pub fn new() -> Self {
        let config_dir = config::config_dir().unwrap_or_default();
        Self {
            watcher: Mutex::new(FileWatcher::new()),
            config: Mutex::new(config::load().unwrap_or_default()),
            log: ActivityLog::new(config_dir),
        }
    }

    /// Reloads the persisted config into state, then restarts watchers.
    pub fn reload(app: &tauri::AppHandle) -> Result<(), String> {
        let state = app.state::<AppState>();
        let loaded = config::load().map_err(|e| e.to_string())?;
        {
            let mut cfg = state.config.lock().unwrap();
            *cfg = loaded;
        }
        Self::restart_watchers(app)
    }

    pub fn restart_watchers(app: &tauri::AppHandle) -> Result<(), String> {
        let state = app.state::<AppState>();

        let folders: Vec<String> = {
            let cfg = state.config.lock().unwrap();
            collect_watch_folders(&cfg.rules)
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

            // Hot-reload the config file: any edit restarts watchers against
            // the freshly loaded config.
            if let Ok(path) = config::config_path() {
                let app = app.clone();
                watcher.watch_file(path, move || {
                    let _ = Self::reload(&app);
                })?;
            }
        }
        Ok(())
    }

    /// Applies rules to `path`. Called from the watcher thread on every event.
    /// Skips files that no longer exist (already handled by a prior event).
    pub fn process(app: tauri::AppHandle, path: std::path::PathBuf) {
        let state = app.state::<AppState>();
        let rules: Vec<Rule> = {
            let cfg = state.config.lock().unwrap();
            cfg.rules.clone()
        };

        if !path.is_file() {
            return;
        }

        for rule in &rules {
            if !rule.applies_to(&path) {
                continue;
            }
            if rule.matches(&path) {
                match actions::execute(&path, &rule.action) {
                    Ok(dest) => {
                        let verb = action_verb(&rule.action);
                        state.log.write(
                            &app,
                            "info",
                            &format!(
                                "[{}] {verb} \"{}\" -> \"{}\"",
                                rule.name,
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
                            &format!("[{}] \"{}\": {error}", rule.name, path.to_string_lossy()),
                        );
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

/// Returns the deduplicated set of folders watched across all rules.
fn collect_watch_folders(rules: &[Rule]) -> Vec<String> {
    let mut folders: Vec<String> = Vec::new();
    for rule in rules {
        for folder in &rule.watched_folders {
            if !folders.contains(folder) {
                folders.push(folder.clone());
            }
        }
    }
    folders
}
