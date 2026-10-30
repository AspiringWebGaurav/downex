use parking_lot::RwLock;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

static TRAY_UPDATE_STATUS: RwLock<TrayUpdateState> = RwLock::new(TrayUpdateState {
    status: UpdateTrayStatus::Idle,
    version: None,
    manifest: None,
});

#[derive(Clone, Debug, PartialEq)]
pub enum UpdateTrayStatus {
    Idle,
    Available,
    Ready,
}

#[derive(Clone, Debug)]
pub struct TrayUpdateState {
    pub status: UpdateTrayStatus,
    pub version: Option<String>,
    pub manifest: Option<crate::ota::ReleaseManifest>,
}

pub fn get_pending_update_manifest() -> Option<crate::ota::ReleaseManifest> {
    let guard = TRAY_UPDATE_STATUS.read();
    guard.manifest.clone()
}

pub fn get_tray_update_status_string() -> String {
    let guard = TRAY_UPDATE_STATUS.read();
    match guard.status {
        UpdateTrayStatus::Idle => "idle".to_string(),
        UpdateTrayStatus::Available => "available".to_string(),
        UpdateTrayStatus::Ready => "ready".to_string(),
    }
}

pub fn set_tray_update_info<R: Runtime>(
    app: &AppHandle<R>,
    status: &str,
    version: Option<String>,
    manifest: Option<crate::ota::ReleaseManifest>,
) {
    let new_status = match status {
        "available" => UpdateTrayStatus::Available,
        "ready" => UpdateTrayStatus::Ready,
        _ => UpdateTrayStatus::Idle,
    };

    {
        let mut guard = TRAY_UPDATE_STATUS.write();
        guard.status = new_status.clone();
        guard.version = version.clone();
        guard.manifest = manifest;
    }

    let _ = set_tray_icon_state(app, status);

    if let Some(tray) = app.tray_by_id("main-tray") {
        match new_status {
            UpdateTrayStatus::Available => {
                let ver_str = version.as_deref().unwrap_or("latest");
                let _ = tray.set_tooltip(Some(&format!(
                    "Downex • Update v{} Available (Click to view)",
                    ver_str
                )));
            }
            UpdateTrayStatus::Ready => {
                let ver_str = version.as_deref().unwrap_or("latest");
                let _ = tray.set_tooltip(Some(&format!(
                    "Downex • v{} Ready (Click to restart)",
                    ver_str
                )));
            }
            UpdateTrayStatus::Idle => {
                let _ = tray.set_tooltip(Some("Downex - Download Manager"));
            }
        }
    }

    let _ = refresh_tray_menu(app);
}

/// Dynamically constructs the tray context menu reflecting real-time window & download state (IDM / REA pattern)
pub fn build_dynamic_tray_menu<R: Runtime>(app: &AppHandle<R>) -> Result<Menu<R>, Box<dyn std::error::Error>> {
    let is_showing = if let Some(window) = app.get_webview_window("main") {
        window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false)
    } else {
        false
    };

    // Query active, paused, and total downloads for dynamic IDM-style actions
    let (active_count, paused_count, total_count) = if let Some(state) = app.try_state::<crate::AppState>() {
        let downloads = state.db.get_all_downloads().unwrap_or_default();
        let active = downloads
            .iter()
            .filter(|d| d.status == "downloading" || d.status == "probing")
            .count();
        let paused = downloads
            .iter()
            .filter(|d| d.status == "paused" || d.status == "queued" || d.status == "failed")
            .count();
        let total = downloads.len();
        (active, paused, total)
    } else {
        (0, 0, 0)
    };

    let menu = Menu::new(app)?;

    // 1. Header: Application & Version Title (disabled)
    let version = crate::version::resolve_installed_version(app, None);
    let header_title = format!("Downex v{}", version);
    let header_item = MenuItem::with_id(app, "header_title", &header_title, false, None::<&str>)?;
    menu.append(&header_item)?;

    let update_state = {
        let guard = TRAY_UPDATE_STATUS.read();
        guard.clone()
    };

    if update_state.status == UpdateTrayStatus::Available {
        let ver = update_state.version.as_deref().unwrap_or("latest");
        let title = format!("✨ Update to v{} Available • View Update", ver);
        let update_action = MenuItem::with_id(app, "view_update", &title, true, None::<&str>)?;
        menu.append(&update_action)?;
        let sep_up = PredefinedMenuItem::separator(app)?;
        menu.append(&sep_up)?;
    } else if update_state.status == UpdateTrayStatus::Ready {
        let ver = update_state.version.as_deref().unwrap_or("latest");
        let title = format!("🚀 Update Ready (v{}) • Restart Now", ver);
        let restart_action = MenuItem::with_id(app, "restart_update", &title, true, None::<&str>)?;
        menu.append(&restart_action)?;
        let sep_up = PredefinedMenuItem::separator(app)?;
        menu.append(&sep_up)?;
    }

    // 2. Real-time Status Banner (disabled)
    let status_text = if active_count > 0 {
        format!("⬇ Downloading ({} active)", active_count)
    } else if paused_count > 0 {
        format!("⏸ Paused ({} tasks)", paused_count)
    } else if total_count > 0 {
        format!("✔ All {} downloads finished", total_count)
    } else {
        "● Downex Core: Ready".to_string()
    };
    let status_item = MenuItem::with_id(app, "status", &status_text, false, None::<&str>)?;
    menu.append(&status_item)?;

    let sep1 = PredefinedMenuItem::separator(app)?;
    menu.append(&sep1)?;

    // 3. Dynamic window toggle: "Show Downex" or "Hide Downex"
    let toggle_label = if is_showing {
        "Hide Downex"
    } else {
        "Show Downex"
    };
    let toggle_item = MenuItem::with_id(app, "toggle_window", toggle_label, true, None::<&str>)?;
    menu.append(&toggle_item)?;

    // 4. Quick Action: Add Download URL
    let new_dl_item = MenuItem::with_id(app, "new_download", "+ Add Download URL... (Ctrl+N)", true, None::<&str>)?;
    menu.append(&new_dl_item)?;

    let sep2 = PredefinedMenuItem::separator(app)?;
    menu.append(&sep2)?;

    // 5. Batch Queue Controls (Dynamic counts & enablement)
    let pause_label = if active_count > 0 {
        format!("⏸ Pause All Downloads ({})", active_count)
    } else {
        "⏸ Pause All Downloads".to_string()
    };
    let pause_item = MenuItem::with_id(app, "pause_all", &pause_label, active_count > 0, None::<&str>)?;
    menu.append(&pause_item)?;

    let resume_label = if paused_count > 0 {
        format!("▶ Resume All Downloads ({})", paused_count)
    } else {
        "▶ Resume All Downloads".to_string()
    };
    let resume_item = MenuItem::with_id(app, "resume_all", &resume_label, paused_count > 0, None::<&str>)?;
    menu.append(&resume_item)?;

    let sep3 = PredefinedMenuItem::separator(app)?;
    menu.append(&sep3)?;

    // 6. Productivity Tools & Quick Links
    let open_dl_item = MenuItem::with_id(app, "open_downloads", "📁 Open Downloads Folder", true, None::<&str>)?;
    menu.append(&open_dl_item)?;

    let settings_item = MenuItem::with_id(app, "open_settings", "⚙ Settings", true, None::<&str>)?;
    menu.append(&settings_item)?;

    let updates_item = MenuItem::with_id(app, "check_updates", "🔄 Check for Updates...", true, None::<&str>)?;
    menu.append(&updates_item)?;

    let sep4 = PredefinedMenuItem::separator(app)?;
    menu.append(&sep4)?;

    // 7. Close Window (Keep running in background system tray)
    let hide_item = MenuItem::with_id(app, "hide_to_tray", "✕ Close Window (Keep in Tray)", true, None::<&str>)?;
    menu.append(&hide_item)?;

    Ok(menu)
}

/// Dynamically updates the tray menu for the running application
pub fn refresh_tray_menu<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let menu = build_dynamic_tray_menu(app)?;
        let _ = tray.set_menu(Some(menu));
    }
    Ok(())
}

pub fn setup_system_tray<R: Runtime>(app: &AppHandle<R>) -> Result<TrayIcon<R>, Box<dyn std::error::Error>> {
    let tray_menu = build_dynamic_tray_menu(app)?;

    // Embed and set official Downex tray icon
    let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))?;

    let tray = TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .menu(&tray_menu)
        .tooltip("Downex - Download Manager")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle_window" => {
                if let Some(window) = app.get_webview_window("main") {
                    let is_showing = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
                    if is_showing {
                        let _ = window.hide();
                        #[cfg(target_os = "windows")]
                        {
                            crate::commands::set_process_priority_background(true);
                            crate::commands::trim_process_working_set();
                        }
                    } else {
                        #[cfg(target_os = "windows")]
                        crate::commands::set_process_priority_background(false);
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                } else {
                    let _ = create_or_show_main_window(app);
                }
                let _ = refresh_tray_menu(app);
            }
            "new_download" => {
                crate::commands::show_download_dialog(app, None);
                let _ = refresh_tray_menu(app);
            }
            "pause_all" => {
                if let Some(state) = app.try_state::<crate::AppState>() {
                    state.queue_manager.pause_all_tasks();
                }
                let _ = refresh_tray_menu(app);
            }
            "resume_all" => {
                if let Some(state) = app.try_state::<crate::AppState>() {
                    let qm = state.queue_manager.clone();
                    tauri::async_runtime::spawn(async move {
                        qm.resume_all_tasks().await;
                    });
                }
                let _ = refresh_tray_menu(app);
            }
            "open_downloads" => {
                if let Some(state) = app.try_state::<crate::AppState>() {
                    let dir = state.queue_manager.get_default_download_directory();
                    let _ = std::process::Command::new("explorer.exe").arg(&dir).spawn();
                }
            }
            "open_settings" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                    let _ = app.emit("downex-navigate", "settings");
                } else {
                    let _ = create_or_show_main_window(app);
                    let _ = app.emit("downex-navigate", "settings");
                }
                let _ = refresh_tray_menu(app);
            }
            "view_update" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                    let _ = app.emit("downex-check-updates", ());
                } else {
                    let _ = create_or_show_main_window(app);
                    let _ = app.emit("downex-check-updates", ());
                }
                let _ = refresh_tray_menu(app);
            }
            "restart_update" => {
                let _ = app.emit("downex-restart-update", ());
            }
            "check_updates" => {
                crate::ota::supervisor::trigger_background_update_check();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                    let _ = app.emit("downex-check-updates", ());
                } else {
                    let _ = create_or_show_main_window(app);
                    let _ = app.emit("downex-check-updates", ());
                }
                let _ = refresh_tray_menu(app);
            }
            "hide_to_tray" | "quit" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                    #[cfg(target_os = "windows")]
                    {
                        crate::commands::set_process_priority_background(true);
                        crate::commands::trim_process_working_set();
                    }
                }
                let _ = refresh_tray_menu(app);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            let app = tray.app_handle();
            match event {
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => {
                    // Left click toggles window: If showing, minimize to tray with low RAM trimming. If hidden, show & focus.
                    if let Some(window) = app.get_webview_window("main") {
                        let is_showing = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
                        if is_showing {
                            let _ = window.hide();
                            #[cfg(target_os = "windows")]
                            {
                                crate::commands::set_process_priority_background(true);
                                crate::commands::trim_process_working_set();
                            }
                        } else {
                            #[cfg(target_os = "windows")]
                            crate::commands::set_process_priority_background(false);
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    } else {
                        let _ = create_or_show_main_window(app);
                    }
                    let _ = refresh_tray_menu(app);
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(tray)
}

pub fn set_tray_icon_state<R: Runtime>(app: &AppHandle<R>, state: &str) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let bytes: &[u8] = match state {
            "update_available" | "downloading" => include_bytes!("../icons/32x32-update-1.png"),
            "downloading_pulse" => include_bytes!("../icons/32x32-update-2.png"),
            "ready" => include_bytes!("../icons/32x32-update-ready.png"),
            _ => include_bytes!("../icons/32x32.png"),
        };
        let img = Image::from_bytes(bytes)?;
        let _ = tray.set_icon(Some(img));
    }
    Ok(())
}

pub fn create_or_show_main_window<R: Runtime>(app: &AppHandle<R>) -> Result<tauri::WebviewWindow<R>, Box<dyn std::error::Error>> {
    #[cfg(target_os = "windows")]
    crate::commands::set_process_priority_background(false);

    if let Some(window) = app.get_webview_window("main") {
        if let Ok(icon) = Image::from_bytes(include_bytes!("../icons/128x128.png")) {
            let _ = window.set_icon(icon);
        }
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = refresh_tray_menu(app);
        Ok(window)
    } else {
        let icon_res = Image::from_bytes(include_bytes!("../icons/128x128.png"));
        let builder = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
            .title("Downex")
            .inner_size(960.0, 640.0)
            .min_inner_size(820.0, 540.0)
            .decorations(false)
            .transparent(false)
            .shadow(true)
            .visible(true)
            .center();

        let window = builder.build()?;
        if let Ok(icon) = icon_res {
            let _ = window.set_icon(icon);
        }
        let _ = refresh_tray_menu(app);
        Ok(window)
    }
}
