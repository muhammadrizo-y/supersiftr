pub mod actions;
pub mod config;
pub mod rules;
pub mod state;
pub mod watcher;

use tauri::{Emitter, Manager, State};

use crate::config::AppConfig;
use crate::rules::Rule;
use crate::state::AppState;

#[tauri::command]
fn get_config(state: State<'_, AppState>) -> AppConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
fn get_watched_folders(state: State<'_, AppState>) -> Vec<String> {
    state
        .watcher
        .lock()
        .unwrap()
        .watched_paths()
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect()
}

#[tauri::command]
fn add_watched_folder(path: String, app: tauri::AppHandle) -> Result<Vec<String>, String> {
    {
        let state = app.state::<AppState>();
        let mut cfg = state.config.lock().unwrap();
        if !cfg.watched_folders.contains(&path) {
            cfg.watched_folders.push(path.clone());
        }
        config::save(&cfg).map_err(|e| e.to_string())?;
    }
    AppState::restart_watchers(&app)?;
    Ok(get_watched_folders(app.state::<AppState>()))
}

#[tauri::command]
fn remove_watched_folder(path: String, app: tauri::AppHandle) -> Result<Vec<String>, String> {
    {
        let state = app.state::<AppState>();
        let mut cfg = state.config.lock().unwrap();
        cfg.watched_folders.retain(|p| p != &path);
        config::save(&cfg).map_err(|e| e.to_string())?;
    }
    AppState::restart_watchers(&app)?;
    Ok(get_watched_folders(app.state::<AppState>()))
}

#[tauri::command]
fn add_rule(rule: Rule, app: tauri::AppHandle) -> Result<Vec<Rule>, String> {
    {
        let state = app.state::<AppState>();
        let mut cfg = state.config.lock().unwrap();
        cfg.rules.push(rule);
        config::save(&cfg).map_err(|e| e.to_string())?;
    }
    Ok(get_rules(app.state::<AppState>()))
}

#[tauri::command]
fn remove_rule(index: usize, app: tauri::AppHandle) -> Result<Vec<Rule>, String> {
    {
        let state = app.state::<AppState>();
        let mut cfg = state.config.lock().unwrap();
        if index >= cfg.rules.len() {
            return Err("Rule index out of bounds".into());
        }
        cfg.rules.remove(index);
        config::save(&cfg).map_err(|e| e.to_string())?;
    }
    Ok(get_rules(app.state::<AppState>()))
}

fn get_rules(state: State<'_, AppState>) -> Vec<Rule> {
    state.config.lock().unwrap().rules.clone()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let startup_config: AppConfig = {
        let s = AppState::new();
        let cfg = s.config.lock().unwrap().clone();
        std::mem::drop(s);
        cfg
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState::new())
        .setup(move |app| {
            AppState::restart_watchers(app.handle()).map_err(|e| format!("setup: {e}"))?;
            let _ = app.emit("config-loaded", &startup_config);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            get_watched_folders,
            add_watched_folder,
            remove_watched_folder,
            add_rule,
            remove_rule
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
