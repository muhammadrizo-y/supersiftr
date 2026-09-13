pub mod actions;
pub mod archive;
pub mod config;
pub mod kinds;
pub mod license;
pub mod logging;
pub mod sieves;
pub mod state;
pub mod compound_extensions;
pub mod watcher;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, State, WindowEvent};
use tauri_plugin_autostart::ManagerExt;

use crate::config::{AppConfig, DateFormat};
use crate::kinds::Kind;
use crate::license::LicenseStore;
use crate::sieves::Sieve;
use crate::state::AppState;

#[tauri::command]
fn set_window_background(dark: bool, window: tauri::WebviewWindow) {
    let _ = window.set_background_color(Some(window_background(theme_color(dark))));
}

#[derive(serde::Serialize)]
struct ConfigView {
    config: AppConfig,
    fresh: bool,
}

#[tauri::command]
fn get_config(state: State<'_, AppState>) -> ConfigView {
    ConfigView {
        config: state.config.lock().unwrap().clone(),
        fresh: state.first_run,
    }
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
    Ok(app.state::<AppState>().config.lock().unwrap().clone())
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

#[tauri::command]
fn set_date_format(format: DateFormat, app: tauri::AppHandle) -> Result<AppConfig, String> {
    let state = app.state::<AppState>();
    let mut config = state.config.lock().unwrap();
    config.date_format = format;
    config::save(&config).map_err(|e| e.to_string())?;
    Ok(config.clone())
}

#[tauri::command]
fn set_check_for_updates(enabled: bool, app: tauri::AppHandle) -> Result<AppConfig, String> {
    let state = app.state::<AppState>();
    let mut config = state.config.lock().unwrap();
    config.check_for_updates = enabled;
    config::save(&config).map_err(|e| e.to_string())?;
    Ok(config.clone())
}

#[derive(serde::Serialize)]
struct CompoundExtensionsView {
    defaults: Vec<String>,
    custom: Vec<String>,
}

#[tauri::command]
fn get_compound_extensions(state: State<'_, AppState>) -> CompoundExtensionsView {
    CompoundExtensionsView {
        defaults: compound_extensions::DEFAULT_COMPOUND_EXTENSIONS.iter().map(|s| s.to_string()).collect(),
        custom: state.config.lock().unwrap().compound_extensions.clone(),
    }
}

#[tauri::command]
fn set_compound_extensions(
    custom: Vec<String>,
    app: tauri::AppHandle,
) -> Result<Vec<String>, String> {
    let state = app.state::<AppState>();
    let mut config = state.config.lock().unwrap();
    let mut cleaned: Vec<String> = Vec::new();
    for s in custom {
        let Some(normalized) = compound_extensions::normalize_custom_extension(&s, &cleaned) else {
            continue;
        };
        cleaned.push(normalized);
    }
    config.compound_extensions = cleaned;
    config::save(&config).map_err(|e| e.to_string())?;
    Ok(config.compound_extensions.clone())
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
fn insert_sieve(
    index: usize,
    sieve: Sieve,
    app: tauri::AppHandle,
) -> Result<Vec<Sieve>, String> {
    {
        let state = app.state::<AppState>();
        let mut store = state.sieves.lock().unwrap();
        let index = index.min(store.sieves.len());
        store.sieves.insert(index, sieve);
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
fn set_sieve_enabled(
    index: usize,
    enabled: bool,
    app: tauri::AppHandle,
) -> Result<Vec<Sieve>, String> {
    {
        let state = app.state::<AppState>();
        let mut store = state.sieves.lock().unwrap();
        if index >= store.sieves.len() {
            return Err("Sieve index out of bounds".into());
        }
        store.sieves[index].enabled = enabled;
        sieves::save(&store).map_err(|e| e.to_string())?;
    }
    AppState::restart_watchers(&app).map_err(|e| e.to_string())?;
    Ok(get_sieves(app.state::<AppState>()))
}

#[tauri::command]
fn get_sieves(state: State<'_, AppState>) -> Vec<Sieve> {
    state.sieves.lock().unwrap().sieves.clone()
}

fn get_kind_list(state: State<'_, AppState>) -> Vec<Kind> {
    state.kinds.lock().unwrap().effective()
}

#[tauri::command]
fn get_kinds(state: State<'_, AppState>) -> Vec<Kind> {
    get_kind_list(state)
}

#[tauri::command]
fn add_kind(kind: Kind, app: tauri::AppHandle) -> Result<Vec<Kind>, String> {
    let mut kind = kind;
    kind.enabled = true;
    kind.is_default = false;
    {
        let state = app.state::<AppState>();
        let mut store = state.kinds.lock().unwrap();
        let base = kinds::slugify(&kind.name)
            .or_else(|| kinds::slugify(&kind.title))
            .ok_or_else(|| "Kind name can't be empty".to_string())?;
        kind.name = kinds::unique_name(&base, &store.effective());
        store.upsert_override(kind);
        kinds::save(&store).map_err(|e| e.to_string())?;
    }
    Ok(get_kind_list(app.state::<AppState>()))
}

#[tauri::command]
fn update_kind(mut kind: Kind, app: tauri::AppHandle) -> Result<Vec<Kind>, String> {
    {
        let state = app.state::<AppState>();
        let mut store = state.kinds.lock().unwrap();
        if !store.effective().iter().any(|p| p.name == kind.name) {
            return Err(kinds::KindError::NotFound.to_string());
        }
        kind.is_default = kinds::default_kind(&kind.name).is_some();
        store.upsert_override(kind);
        kinds::save(&store).map_err(|e| e.to_string())?;
    }
    Ok(get_kind_list(app.state::<AppState>()))
}

#[tauri::command]
fn delete_kind(name: String, app: tauri::AppHandle) -> Result<Vec<Kind>, String> {
    {
        let state = app.state::<AppState>();
        let mut store = state.kinds.lock().unwrap();
        if kinds::default_kind(&name).is_some() {
            return Err("Default kinds can't be deleted".into());
        }
        let before = store.kinds.len();
        store.kinds.retain(|p| p.name != name);
        if store.kinds.len() == before {
            return Err(kinds::KindError::NotFound.to_string());
        }
        kinds::save(&store).map_err(|e| e.to_string())?;
    }
    Ok(get_kind_list(app.state::<AppState>()))
}

#[tauri::command]
fn set_kind_enabled(name: String, enabled: bool, app: tauri::AppHandle) -> Result<Vec<Kind>, String> {
    {
        let state = app.state::<AppState>();
        let mut store = state.kinds.lock().unwrap();
        let mut kind = match store.effective().iter().find(|p| p.name == name) {
            Some(existing) => {
                let mut kind = existing.clone();
                kind.enabled = enabled;
                kind
            }
            None => return Err(kinds::KindError::NotFound.to_string()),
        };
        kind.is_default = kinds::default_kind(&name).is_some();
        store.upsert_override(kind);
        kinds::save(&store).map_err(|e| e.to_string())?;
    }
    Ok(get_kind_list(app.state::<AppState>()))
}

#[tauri::command]
fn reset_kind(name: String, app: tauri::AppHandle) -> Result<Vec<Kind>, String> {
    if kinds::default_kind(&name).is_none() {
        return Err(format!("No default kind named \"{name}\""));
    }
    {
        let state = app.state::<AppState>();
        let mut store = state.kinds.lock().unwrap();
        store.kinds.retain(|p| p.name != name);
        kinds::save(&store).map_err(|e| e.to_string())?;
    }
    Ok(get_kind_list(app.state::<AppState>()))
}

#[tauri::command]
fn get_license_status(state: State<'_, AppState>) -> LicenseStore {
    state.license.lock().unwrap().clone()
}

#[tauri::command]
async fn activate_license(key: String, app: tauri::AppHandle) -> Result<LicenseStore, String> {
    let activated = license::activate(&key).await.map_err(|e| e.to_string())?;
    let state = app.state::<AppState>();
    *state.license.lock().unwrap() = activated.clone();
    let _ = app.emit("license-changed", &activated);
    Ok(activated)
}

#[tauri::command]
async fn refresh_license(app: tauri::AppHandle) -> Result<LicenseStore, String> {
    let current = { app.state::<AppState>().license.lock().unwrap().clone() };
    if current.activation_id.is_none() {
        return Ok(current);
    }
    let refreshed = license::refresh(current).await.map_err(|e| e.to_string())?;
    let state = app.state::<AppState>();
    *state.license.lock().unwrap() = refreshed.clone();
    let _ = app.emit("license-changed", &refreshed);
    Ok(refreshed)
}

#[tauri::command]
async fn deactivate_license(app: tauri::AppHandle) -> Result<LicenseStore, String> {
    let current = { app.state::<AppState>().license.lock().unwrap().clone() };
    let cleared = license::deactivate(current).await.map_err(|e| e.to_string())?;
    let state = app.state::<AppState>();
    *state.license.lock().unwrap() = cleared.clone();
    let _ = app.emit("license-changed", &cleared);
    Ok(cleared)
}

#[tauri::command]
fn get_logs(state: State<'_, AppState>, count: Option<usize>) -> Vec<logging::LogEntry> {
    state.log.read_tail(count.unwrap_or(200))
}

#[tauri::command]
fn get_log_path(state: State<'_, AppState>) -> String {
    state.log.path().to_string_lossy().to_string()
}

#[tauri::command]
fn clear_logs(state: State<'_, AppState>) {
    state.log.clear();
}

/// Match the native window background to the app's theme so the sliver of
/// window that the webview hasn't repainted yet during a live resize doesn't
/// flash white in dark mode.
fn window_background(color: [u8; 4]) -> tauri::webview::Color {
    tauri::webview::Color(color[0], color[1], color[2], color[3])
}

fn theme_color(dark: bool) -> [u8; 4] {
    if dark {
        [0x15, 0x15, 0x15, 255]
    } else {
        [255, 255, 255, 255]
    }
}

fn apply_theme_background(window: &tauri::WebviewWindow) {
    let color = theme_color(window.theme().unwrap_or(tauri::Theme::Light) == tauri::Theme::Dark);
    let _ = window.set_background_color(Some(window_background(color)));

    let handle = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::ThemeChanged(theme) = event {
            let color = theme_color(matches!(theme, tauri::Theme::Dark));
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
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
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let current = { app_handle.state::<AppState>().license.lock().unwrap().clone() };
                    if current.activation_id.is_some() && current.needs_revalidation() {
                        if let Ok(refreshed) = license::refresh(current).await {
                            *app_handle.state::<AppState>().license.lock().unwrap() = refreshed;
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_window_background,
            get_config,
            set_show_in_tray,
            get_run_at_startup,
            set_run_at_startup,
            set_date_format,
            set_check_for_updates,
            get_compound_extensions,
            set_compound_extensions,
            get_sieves,
            add_sieve,
            insert_sieve,
            remove_sieve,
            update_sieve,
            set_sieve_enabled,
            get_logs,
            get_log_path,
            clear_logs,
            get_kinds,
            add_kind,
            update_kind,
            delete_kind,
            set_kind_enabled,
            reset_kind,
            get_license_status,
            activate_license,
            refresh_license,
            deactivate_license
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
