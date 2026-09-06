pub mod actions;
pub mod config;
pub mod logging;
pub mod presets;
pub mod sieves;
pub mod state;
pub mod watcher;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, State, WindowEvent};
use tauri_plugin_autostart::ManagerExt;

use crate::config::AppConfig;
use crate::presets::Preset;
use crate::sieves::Sieve;
use crate::state::AppState;

#[tauri::command]
fn set_window_background(dark: bool, window: tauri::WebviewWindow) {
    let color = match dark {
        true => [0x15, 0x15, 0x15, 255],
        false => [255, 255, 255, 255],
    };
    let _ = window.set_background_color(Some(window_background(color)));
}

#[tauri::command]
fn get_config(state: State<'_, AppState>) -> AppConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
fn set_show_in_tray(enabled: bool, app: tauri::AppHandle) -> Result<AppConfig, String> {
    {
        let state = app.state::<AppState>();
        let mut config = state.config.lock().unwrap();
        config.show_in_tray = enabled;
        config::save(&config).map_err(|e| e.to_string())?;
    }
    set_tray_enabled(&app, enabled).map_err(|e| e.to_string())?;
    Ok(get_config(app.state::<AppState>()))
}

#[tauri::command]
fn get_run_at_startup(app: tauri::AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_run_at_startup(enabled: bool, app: tauri::AppHandle) -> Result<bool, String> {
    let autolaunch = app.autolaunch();
    let result = if enabled {
        autolaunch.enable()
    } else {
        autolaunch.disable()
    };
    result.map_err(|e| e.to_string())?;
    autolaunch.is_enabled().map_err(|e| e.to_string())
}

fn set_tray_enabled(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut tray_opt = state.tray.lock().unwrap();
    match enabled {
        true => {
            if let Some(tray) = tray_opt.as_ref() {
                tray.set_visible(true).map_err(|e| e.to_string())?;
            } else {
                *tray_opt = Some(build_tray(app).map_err(|e| e.to_string())?);
            }
        }
        false => {
            if let Some(tray) = tray_opt.as_ref() {
                tray.set_visible(false).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

fn build_tray(app: &tauri::AppHandle) -> Result<tauri::tray::TrayIcon, String> {
    let open_item =
        MenuItem::with_id(app, "open", "Open Supersiftr", true, None::<&str>).map_err(|e| e.to_string())?;
    let separator =
        PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
    let version = app.package_info().version.clone();
    let version_item = MenuItem::with_id(
        app,
        "version",
        format!("Version: {version}"),
        false,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let settings_item = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let quit_item =
        MenuItem::with_id(app, "quit", "Quit", true, None::<&str>).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(
        app,
        &[&open_item, &separator, &version_item, &settings_item, &separator, &quit_item],
    )
    .map_err(|e| e.to_string())?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Supersiftr")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "settings" => {
                let _ = app.emit("show-settings", ());
                show_main_window(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)
        .map_err(|e| e.to_string())
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn attach_close_behavior(window: &tauri::WebviewWindow) {
    let handle = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            let state = handle.state::<AppState>();
            if state.config.lock().unwrap().show_in_tray {
                api.prevent_close();
                let _ = handle.hide();
            }
        }
    });
}

#[tauri::command]
fn add_sieve(sieve: Sieve, app: tauri::AppHandle) -> Result<Vec<Sieve>, String> {
    {
        let state = app.state::<AppState>();
        let mut store = state.sieves.lock().unwrap();
        store.sieves.push(sieve);
        sieves::save(&store).map_err(|e| e.to_string())?;
    }
    AppState::restart_watchers(&app).map_err(|e| e.to_string())?;
    Ok(get_sieves(app.state::<AppState>()))
}

#[tauri::command]
fn remove_sieve(index: usize, app: tauri::AppHandle) -> Result<Vec<Sieve>, String> {
    {
        let state = app.state::<AppState>();
        let mut store = state.sieves.lock().unwrap();
        if index >= store.sieves.len() {
            return Err("Sieve index out of bounds".into());
        }
        store.sieves.remove(index);
        sieves::save(&store).map_err(|e| e.to_string())?;
    }
    AppState::restart_watchers(&app).map_err(|e| e.to_string())?;
    Ok(get_sieves(app.state::<AppState>()))
}

#[tauri::command]
fn update_sieve(
    index: usize,
    sieve: Sieve,
    app: tauri::AppHandle,
) -> Result<Vec<Sieve>, String> {
    {
        let state = app.state::<AppState>();
        let mut store = state.sieves.lock().unwrap();
        if index >= store.sieves.len() {
            return Err("Sieve index out of bounds".into());
        }
        store.sieves[index] = sieve;
        sieves::save(&store).map_err(|e| e.to_string())?;
    }
    AppState::restart_watchers(&app).map_err(|e| e.to_string())?;
    Ok(get_sieves(app.state::<AppState>()))
}

#[tauri::command]
fn get_sieves(state: State<'_, AppState>) -> Vec<Sieve> {
    state.sieves.lock().unwrap().sieves.clone()
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

/// Match the native window background to the app's theme so the sliver of
/// window that the webview hasn't repainted yet during a live resize doesn't
/// flash white in dark mode.
fn window_background(color: [u8; 4]) -> tauri::webview::Color {
    tauri::webview::Color(color[0], color[1], color[2], color[3])
}

fn apply_theme_background(window: &tauri::WebviewWindow) {
    let theme = window.theme().unwrap_or(tauri::Theme::Light);
    let color = match theme {
        tauri::Theme::Dark => [0x15, 0x15, 0x15, 255],
        _ => [255, 255, 255, 255],
    };
    let _ = window.set_background_color(Some(window_background(color)));

    let handle = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::ThemeChanged(theme) = event {
            let color = match theme {
                tauri::Theme::Dark => [0x15, 0x15, 0x15, 255],
                _ => [255, 255, 255, 255],
            };
            let _ = handle.set_background_color(Some(window_background(color)));
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .manage(AppState::new())
        .setup(|app| {
            AppState::restart_watchers(app.handle()).map_err(|e| format!("setup: {e}"))?;
            if let Some(window) = app.get_webview_window("main") {
                apply_theme_background(&window);
                attach_close_behavior(&window);
            }
            {
                let state = app.state::<AppState>();
                if state.config.lock().unwrap().show_in_tray {
                    let mut tray = state.tray.lock().unwrap();
                    *tray = Some(build_tray(app.handle()).map_err(|e| format!("setup tray: {e}"))?);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_window_background,
            get_config,
            set_show_in_tray,
            get_run_at_startup,
            set_run_at_startup,
            get_sieves,
            add_sieve,
            remove_sieve,
            update_sieve,
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
