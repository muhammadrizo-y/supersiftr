use std::sync::Mutex;

use tauri::{Emitter, Manager};

use crate::actions;
use crate::config::{self, AppConfig};
use crate::rules::Rule;
use crate::watcher::FileWatcher;

pub struct AppState {
    pub watcher: Mutex<FileWatcher>,
    pub config: Mutex<AppConfig>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            watcher: Mutex::new(FileWatcher::new()),
            config: Mutex::new(config::load().unwrap_or_default()),
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
            cfg.watched_folders.clone()
        };

        {
            let mut watcher = state.watcher.lock().unwrap();
            watcher.stop();
            for folder in folders {
                let app = app.clone();
                watcher.watch(
                    folder.into(),
                    app.clone(),
                    move |path| {
                        Self::process(app.clone(), path);
                    },
                )?;
            }
        }
        Ok(())
    }

    /// Applies rules to `path`. Called from the watcher thread on every event.
    pub fn process(app: tauri::AppHandle, path: std::path::PathBuf) {
        let rules: Vec<Rule> = {
            let state = app.state::<AppState>();
            let cfg = state.config.lock().unwrap();
            cfg.rules.clone()
        };

        for rule in &rules {
            if rule.matches(&path) {
                match actions::execute(&path, &rule.action) {
                    Ok(dest) => {
                        let _ = app.emit(
                            "rule-applied",
                            serde_json::json!({
                                "rule": rule.name,
                                "source": path.to_string_lossy(),
                                "destination": dest.to_string_lossy(),
                            }),
                        );
                    }
                    Err(e) => {
                        let _ = app.emit(
                            "rule-error",
                            serde_json::json!({
                                "rule": rule.name,
                                "path": path.to_string_lossy(),
                                "error": e.to_string(),
                            }),
                        );
                    }
                }
                break;
            }
        }
    }
}
