pub mod actions;
pub mod config;
pub mod logging;
pub mod presets;
pub mod rules;
pub mod state;
pub mod watcher;

use tauri::{Manager, State};

use crate::config::AppConfig;
use crate::presets::Preset;
use crate::rules::Rule;
use crate::state::AppState;

#[tauri::command]
fn get_config(state: State<'_, AppState>) -> AppConfig {
    state.config.lock().unwrap().clone()
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

fn get_preset_list(state: State<'_, AppState>) -> Vec<Preset> {
    state.presets.lock().unwrap().presets.clone()
}

#[tauri::command]
fn get_presets(state: State<'_, AppState>) -> Vec<Preset> {
    get_preset_list(state)
}

#[tauri::command]
fn add_preset(preset: Preset, app: tauri::AppHandle) -> Result<Vec<Preset>, String> {
    {
        let state = app.state::<AppState>();
        let mut store = state.presets.lock().unwrap();
        if store.presets.iter().any(|p| p.name == preset.name) {
            return Err(presets::PresetError::Duplicate.to_string());
        }
        store.presets.push(preset);
        presets::save(&store).map_err(|e| e.to_string())?;
    }
    Ok(get_preset_list(app.state::<AppState>()))
}

#[tauri::command]
fn update_preset(preset: Preset, app: tauri::AppHandle) -> Result<Vec<Preset>, String> {
    {
        let state = app.state::<AppState>();
        let mut store = state.presets.lock().unwrap();
        match store
            .presets
            .iter_mut()
            .find(|p| p.name == preset.name)
        {
            Some(existing) => *existing = preset,
            None => return Err(presets::PresetError::NotFound.to_string()),
        }
        presets::save(&store).map_err(|e| e.to_string())?;
    }
    Ok(get_preset_list(app.state::<AppState>()))
}

#[tauri::command]
fn delete_preset(name: String, app: tauri::AppHandle) -> Result<Vec<Preset>, String> {
    {
        let state = app.state::<AppState>();
        let mut store = state.presets.lock().unwrap();
        let before = store.presets.len();
        store.presets.retain(|p| p.name != name);
        if store.presets.len() == before {
            return Err(presets::PresetError::NotFound.to_string());
        }
        presets::save(&store).map_err(|e| e.to_string())?;
    }
    Ok(get_preset_list(app.state::<AppState>()))
}

#[tauri::command]
fn get_logs(state: State<'_, AppState>, count: Option<usize>) -> Vec<String> {
    state.log.read_tail(count.unwrap_or(200))
}

#[tauri::command]
fn get_log_path(state: State<'_, AppState>) -> String {
    state.log.path().to_string_lossy().to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState::new())
        .setup(|app| {
            AppState::restart_watchers(app.handle()).map_err(|e| format!("setup: {e}"))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            add_rule,
            remove_rule,
            get_logs,
            get_log_path,
            get_presets,
            add_preset,
            update_preset,
            delete_preset
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
