use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};

/// Dynamically constructs the tray context menu reflecting real-time window & download state (IDM / REA pattern)
pub fn build_dynamic_tray_menu<R: Runtime>(app: &AppHandle<R>) -> Result<Menu<R>, Box<dyn std::error::Error>> {
    let is_showing = if let Some(window) = app.get_webview_window("main") {
        window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false)
    } else {
        false
    };

    // Query active & paused downloads for dynamic IDM-style actions
    let (active_count, paused_count) = if let Some(state) = app.try_state::<crate::AppState>() {
        let downloads = state.db.get_all_downloads().unwrap_or_default();
        let active = downloads
            .iter()
            .filter(|d| d.status == "downloading" || d.status == "probing")
            .count();
        let paused = downloads
            .iter()
            .filter(|d| d.status == "paused" || d.status == "queued" || d.status == "failed")
            .count();
        (active, paused)
    } else {
        (0, 0)
    };

    let menu = Menu::new(app)?;

    // 1. Live status banner (disabled header)
    let status_text = if active_count > 0 {
        format!("Downex: Downloading ({} active)", active_count)
    } else if paused_count > 0 {
        format!("Downex: {} Paused", paused_count)
    } else {
        "Downex Core: Ready".to_string()
    };
    let status_item = MenuItem::with_id(app, "status", &status_text, false, None::<&str>)?;
    menu.append(&status_item)?;

    let sep1 = PredefinedMenuItem::separator(app)?;
    menu.append(&sep1)?;

    // 2. Pure dynamic window toggle:
    // If app is already showing -> "Hide Downex"
    // If app is hidden / minimized -> "Show Downex"
    let toggle_label = if is_showing {
        "Hide Downex"
    } else {
        "Show Downex"
    };
    let toggle_item = MenuItem::with_id(app, "toggle_window", toggle_label, true, None::<&str>)?;
    menu.append(&toggle_item)?;

    // 3. Quick action: Add download link
    let new_dl_item = MenuItem::with_id(app, "new_download", "+ Add Download URL...", true, None::<&str>)?;
    menu.append(&new_dl_item)?;

    let sep2 = PredefinedMenuItem::separator(app)?;
    menu.append(&sep2)?;

    // 4. Batch Queue Controls (Dynamic counts & enablement)
    if active_count > 0 {
        let pause_label = format!("Pause All Downloads ({})", active_count);
        let pause_item = MenuItem::with_id(app, "pause_all", &pause_label, true, None::<&str>)?;
        menu.append(&pause_item)?;
    } else {
        let pause_item = MenuItem::with_id(app, "pause_all", "Pause All Downloads", false, None::<&str>)?;
        menu.append(&pause_item)?;
    }

    if paused_count > 0 {
        let resume_label = format!("Resume All Downloads ({})", paused_count);
        let resume_item = MenuItem::with_id(app, "resume_all", &resume_label, true, None::<&str>)?;
        menu.append(&resume_item)?;
    } else {
        let resume_item = MenuItem::with_id(app, "resume_all", "Resume All Downloads", false, None::<&str>)?;
        menu.append(&resume_item)?;
    }

    let sep3 = PredefinedMenuItem::separator(app)?;
    menu.append(&sep3)?;

    // 5. Exit Downex
    let quit_item = MenuItem::with_id(app, "quit", "Quit Downex", true, None::<&str>)?;
    menu.append(&quit_item)?;

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
                    } else {
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
            "quit" => {
                app.exit(0);
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
                    // Left click toggles window: If showing, minimize to tray. If hidden/minimized, show & focus.
                    if let Some(window) = app.get_webview_window("main") {
                        let is_showing = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
                        if is_showing {
                            let _ = window.hide();
                        } else {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    } else {
                        let _ = create_or_show_main_window(app);
                    }
                    let _ = refresh_tray_menu(app);
                }
                TrayIconEvent::Click {
                    button: MouseButton::Right,
                    button_state: MouseButtonState::Down | MouseButtonState::Up,
                    ..
                } => {
                    // Right click: dynamically rebuild menu before Windows displays context popup
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
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = refresh_tray_menu(app);
        Ok(window)
    } else {
        let builder = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
            .title("Downex")
            .inner_size(960.0, 640.0)
            .min_inner_size(820.0, 540.0)
            .decorations(false)
            .transparent(false)
            .shadow(true)
            .center();

        let window = builder.build()?;
        let _ = refresh_tray_menu(app);
        Ok(window)
    }
}
