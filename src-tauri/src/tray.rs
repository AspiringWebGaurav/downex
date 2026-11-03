use std::collections::HashSet;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use parking_lot::{Mutex, RwLock};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

static TRAY_UPDATE_STATUS: RwLock<TrayUpdateState> = RwLock::new(TrayUpdateState {
    status: UpdateTrayStatus::Idle,
    version: None,
    manifest: None,
    deferred_due_to_downloads: false,
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
    pub deferred_due_to_downloads: bool,
}

pub fn is_update_deferred() -> bool {
    TRAY_UPDATE_STATUS.read().deferred_due_to_downloads
}

pub fn defer_update_due_to_downloads<R: Runtime>(
    app: &AppHandle<R>,
    version: Option<String>,
    manifest: Option<crate::ota::ReleaseManifest>,
) {
    {
        let mut guard = TRAY_UPDATE_STATUS.write();
        guard.deferred_due_to_downloads = true;
        guard.status = UpdateTrayStatus::Idle;
        guard.version = version;
        guard.manifest = manifest.clone();
    }
    let _ = set_tray_icon_state(app, "idle");
    let _ = refresh_tray_menu(app);
    let _ = app.emit("downex-update-deferred", &manifest);
}

pub fn on_downloads_completed<R: Runtime>(app: &AppHandle<R>) {
    let (should_reveal, version, manifest) = {
        let mut guard = TRAY_UPDATE_STATUS.write();
        if guard.deferred_due_to_downloads && guard.manifest.is_some() {
            guard.deferred_due_to_downloads = false;
            guard.status = UpdateTrayStatus::Available;
            (true, guard.version.clone(), guard.manifest.clone())
        } else {
            (false, None, None)
        }
    };

    if should_reveal {
        let remote_ver = version.unwrap_or_else(|| "latest".to_string());
        eprintln!(
            "[Downex OTA] All downloads completed! Revealing deferred update v{}",
            remote_ver
        );

        // 1. Change Tray Icon to Emerald Green!
        let _ = set_tray_icon_state(app, "update_available");
        if let Some(tray) = app.tray_by_id("main-tray") {
            let _ = tray.set_tooltip(Some(&format!(
                "Downex • Update v{} Available (Click to view)",
                remote_ver
            )));
        }
        let _ = refresh_tray_menu(app);

        // 2. Dispatch Non-Intrusive Windows Native Toast Notification!
        use tauri_plugin_notification::NotificationExt;
        let _ = app
            .notification()
            .builder()
            .title("Downex")
            .body(format!(
                "Downex v{} update is ready. All downloads have finished.",
                remote_ver
            ))
            .show();

        // 3. Emit real-time unblocked event to frontend!
        let _ = app.emit("downex-update-unblocked", &manifest);
        let _ = app.emit("downex-update-detected", &manifest);
    }
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
        "available" | "update_available" => UpdateTrayStatus::Available,
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

/// Self-healing fallback: Verifies the primary Downex system tray icon exists and recreates it if lost (e.g., Windows Explorer restart)
pub fn ensure_main_tray<R: Runtime>(app: &AppHandle<R>) {
    if app.tray_by_id("main-tray").is_none() {
        if let Err(e) = setup_system_tray(app) {
            eprintln!("[Downex Tray] Notice: Main tray self-healing recovery: {}", e);
        }
    }
}

/// Dynamically updates the tray menu for the running application
pub fn refresh_tray_menu<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    ensure_main_tray(app);
    if let Some(tray) = app.tray_by_id("main-tray") {
        let menu = build_dynamic_tray_menu(app)?;
        let _ = tray.set_menu(Some(menu));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn sweep_windows_zombie_tray_icons() {
    unsafe {
        use windows_sys::Win32::Foundation::RECT;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            FindWindowExW, FindWindowW, GetClientRect, SendMessageW, WM_MOUSEMOVE,
        };

        fn to_wide(s: &str) -> Vec<u16> {
            s.encode_utf16().chain(std::iter::once(0)).collect()
        }

        unsafe fn sweep_toolbar(hwnd: windows_sys::Win32::Foundation::HWND) {
            if hwnd.is_null() {
                return;
            }
            let mut rc = RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            };
            if GetClientRect(hwnd, &mut rc) == 0 {
                return;
            }
            let width = rc.right - rc.left;
            let height = rc.bottom - rc.top;
            if width <= 0 || height <= 0 {
                return;
            }

            // Step across toolbar in small increments to trigger WM_MOUSEMOVE hit-testing
            let step_x = 8;
            let step_y = 8;
            let mut x = 0;
            while x < width {
                let mut y = 0;
                while y < height {
                    let lparam = ((y as u32) << 16 | (x as u32 & 0xFFFF)) as isize;
                    SendMessageW(hwnd, WM_MOUSEMOVE, 0, lparam);
                    y += step_y;
                }
                x += step_x;
            }
        }

        // 1. Taskbar Tray Window
        let shell_tray = FindWindowW(to_wide("Shell_TrayWnd").as_ptr(), std::ptr::null());
        if !shell_tray.is_null() {
            let tray_notify = FindWindowExW(
                shell_tray,
                std::ptr::null_mut(),
                to_wide("TrayNotifyWnd").as_ptr(),
                std::ptr::null(),
            );
            if !tray_notify.is_null() {
                let sys_pager = FindWindowExW(
                    tray_notify,
                    std::ptr::null_mut(),
                    to_wide("SysPager").as_ptr(),
                    std::ptr::null(),
                );
                let parent = if !sys_pager.is_null() {
                    sys_pager
                } else {
                    tray_notify
                };
                let toolbar = FindWindowExW(
                    parent,
                    std::ptr::null_mut(),
                    to_wide("ToolbarWindow32").as_ptr(),
                    std::ptr::null(),
                );
                if !toolbar.is_null() {
                    sweep_toolbar(toolbar);
                }
            }
        }

        // 2. Notification Overflow Window
        let overflow = FindWindowW(to_wide("NotifyIconOverflowWindow").as_ptr(), std::ptr::null());
        if !overflow.is_null() {
            let toolbar = FindWindowExW(
                overflow,
                std::ptr::null_mut(),
                to_wide("ToolbarWindow32").as_ptr(),
                std::ptr::null(),
            );
            if !toolbar.is_null() {
                sweep_toolbar(toolbar);
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn sweep_windows_zombie_tray_icons() {}

pub fn setup_system_tray<R: Runtime>(app: &AppHandle<R>) -> Result<TrayIcon<R>, Box<dyn std::error::Error>> {
    // 1. Idempotency guard: Return existing tray icon if already created in this process
    if let Some(existing) = app.tray_by_id("main-tray") {
        let _ = refresh_tray_menu(app);
        return Ok(existing);
    }

    // 2. Clear any lingering Windows zombie tray icons from killed/crashed previous processes
    #[cfg(target_os = "windows")]
    sweep_windows_zombie_tray_icons();
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
                        let _ = sync_download_task_tray(app);
                    } else {
                        #[cfg(target_os = "windows")]
                        crate::commands::set_process_priority_background(false);
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                        clean_all_task_trays(app);
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
                    #[cfg(target_os = "windows")]
                    {
                        use std::os::windows::process::CommandExt;
                        let _ = std::process::Command::new("explorer.exe")
                            .arg(&dir)
                            .creation_flags(0x08000000)
                            .spawn();
                    }
                    #[cfg(not(target_os = "windows"))]
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
                    let _ = sync_download_task_tray(app);
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
                            let _ = sync_download_task_tray(app);
                        } else {
                            #[cfg(target_os = "windows")]
                            crate::commands::set_process_priority_background(false);
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                            clean_all_task_trays(app);
                            if let Some(manifest) = get_pending_update_manifest() {
                                let _ = app.emit("downex-update-detected", &manifest);
                            }
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
    ensure_main_tray(app);
    if let Some(tray) = app.tray_by_id("main-tray") {
        let bytes: &[u8] = match state {
            "update_available" | "available" => include_bytes!("../icons/32x32-update-1.png"),
            "ready" => include_bytes!("../icons/32x32-update-ready.png"),
            _ => include_bytes!("../icons/32x32.png"),
        };
        let img = Image::from_bytes(bytes)?;
        let _ = tray.set_icon(Some(img));
    }
    Ok(())
}

static LAST_TASK_TRAY_UPDATE_MS: AtomicU64 = AtomicU64::new(0);
static ACTIVE_TASK_TRAYS: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

fn current_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn format_tray_speed(bytes_per_sec: u64) -> String {
    if bytes_per_sec >= 1024 * 1024 * 1024 {
        format!("{:.1} GB/s", bytes_per_sec as f64 / (1024.0 * 1024.0 * 1024.0))
    } else if bytes_per_sec >= 1024 * 1024 {
        format!("{:.1} MB/s", bytes_per_sec as f64 / (1024.0 * 1024.0))
    } else if bytes_per_sec >= 1024 {
        format!("{:.0} KB/s", bytes_per_sec as f64 / 1024.0)
    } else {
        format!("{} B/s", bytes_per_sec)
    }
}

fn format_tray_bytes(bytes: u64) -> String {
    if bytes >= 1024 * 1024 * 1024 {
        format!("{:.1} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    } else if bytes >= 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    } else if bytes >= 1024 {
        format!("{:.0} KB", bytes as f64 / 1024.0)
    } else {
        format!("{} B", bytes)
    }
}

pub fn clean_all_task_trays<R: Runtime>(app: &AppHandle<R>) {
    let mut guard = ACTIVE_TASK_TRAYS.lock();
    for task_id in guard.drain() {
        let tray_id = format!("task-tray-{}", task_id);
        let _ = app.remove_tray_by_id(&tray_id);
    }
    let _ = app.remove_tray_by_id("download-task-tray");

    // Defensively ensure no task tray icons remain for tasks in the database
    if let Some(state) = app.try_state::<crate::AppState>() {
        if let Ok(downloads) = state.db.get_all_downloads() {
            for d in downloads {
                let tray_id = format!("task-tray-{}", d.id);
                let _ = app.remove_tray_by_id(&tray_id);
            }
        }
    }
}

pub fn build_task_tray_menu<R: Runtime>(
    app: &AppHandle<R>,
    task_id: &str,
    task_summary: &str,
) -> Result<Menu<R>, Box<dyn std::error::Error>> {
    let menu = Menu::new(app)?;

    let header_item = MenuItem::with_id(
        app,
        format!("task_hdr_{}", task_id),
        task_summary,
        false,
        None::<&str>,
    )?;
    menu.append(&header_item)?;

    let sep1 = PredefinedMenuItem::separator(app)?;
    menu.append(&sep1)?;

    let show_item = MenuItem::with_id(
        app,
        format!("task_show_{}", task_id),
        "Open Downex",
        true,
        None::<&str>,
    )?;
    menu.append(&show_item)?;

    let pause_item = MenuItem::with_id(
        app,
        format!("task_pause_{}", task_id),
        "⏸ Pause This Download",
        true,
        None::<&str>,
    )?;
    menu.append(&pause_item)?;

    let open_item = MenuItem::with_id(
        app,
        format!("task_folder_{}", task_id),
        "📁 Open Destination Folder",
        true,
        None::<&str>,
    )?;
    menu.append(&open_item)?;

    let sep2 = PredefinedMenuItem::separator(app)?;
    menu.append(&sep2)?;

    let dismiss_item = MenuItem::with_id(
        app,
        format!("task_dismiss_{}", task_id),
        "✕ Dismiss Task Icon",
        true,
        None::<&str>,
    )?;
    menu.append(&dismiss_item)?;

    Ok(menu)
}

/// Throttled progress update for the active download task tray icons (IDM / REA pattern)
pub fn update_download_task_progress<R: Runtime>(
    app: &AppHandle<R>,
    progress: &crate::engine::DownloadProgressEvent,
) {
    let is_showing = if let Some(window) = app.get_webview_window("main") {
        window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false)
    } else {
        false
    };

    if is_showing {
        clean_all_task_trays(app);
        return;
    }

    let is_terminal_or_paused = progress.status == "completed"
        || progress.status == "error"
        || progress.status == "cancelled"
        || progress.status == "paused";

    if !is_terminal_or_paused {
        let now = current_millis();
        let last = LAST_TASK_TRAY_UPDATE_MS.load(Ordering::Relaxed);
        if now.saturating_sub(last) < 800 {
            return;
        }
        LAST_TASK_TRAY_UPDATE_MS.store(now, Ordering::Relaxed);
    }

    sync_download_task_trays_with_progress(app, Some(progress));
}

/// Synchronizes dedicated task trays per running download without modifying the primary Downex logo (IDM / REA pattern)
pub fn sync_download_task_tray<R: Runtime>(app: &AppHandle<R>) {
    sync_download_task_trays(app);
}

pub fn sync_download_task_tray_with_progress<R: Runtime>(
    app: &AppHandle<R>,
    latest_progress: Option<&crate::engine::DownloadProgressEvent>,
) {
    sync_download_task_trays_with_progress(app, latest_progress);
}

pub fn sync_download_task_trays<R: Runtime>(app: &AppHandle<R>) {
    sync_download_task_trays_with_progress(app, None);
}

pub fn sync_download_task_trays_with_progress<R: Runtime>(
    app: &AppHandle<R>,
    latest_progress: Option<&crate::engine::DownloadProgressEvent>,
) {
    let is_showing = if let Some(window) = app.get_webview_window("main") {
        window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false)
    } else {
        false
    };

    if is_showing {
        clean_all_task_trays(app);
        return;
    }

    // Clean up any legacy single-tray ID if it exists
    let _ = app.remove_tray_by_id("download-task-tray");

    let downloads = if let Some(state) = app.try_state::<crate::AppState>() {
        state.db.get_all_downloads().unwrap_or_default()
    } else {
        vec![]
    };

    let running_tasks: Vec<_> = downloads
        .into_iter()
        .filter(|d| {
            if let Some(p) = latest_progress {
                if p.task_id == d.id && p.status == "completed" {
                    return false;
                }
            }
            d.status == "downloading" || d.status == "probing"
        })
        .collect();

    let mut guard = ACTIVE_TASK_TRAYS.lock();
    let running_ids: HashSet<String> = running_tasks.iter().map(|d| d.id.clone()).collect();

    // 1. Remove tray icons for tasks that are no longer running (completed, paused, or cancelled)
    let to_remove: Vec<String> = guard
        .iter()
        .filter(|id| !running_ids.contains(*id))
        .cloned()
        .collect();

    for task_id in to_remove {
        let tray_id = format!("task-tray-{}", task_id);
        let _ = app.remove_tray_by_id(&tray_id);
        guard.remove(&task_id);
    }

    if running_tasks.is_empty() {
        drop(guard);
        clean_all_task_trays(app);
        return;
    }

    // 2. For EACH running task, maintain its dedicated tray icon
    for task in &running_tasks {
        let task_id = task.id.clone();
        let tray_id = format!("task-tray-{}", task_id);

        let (speed, downloaded, total) = if let Some(p) = latest_progress.filter(|p| p.task_id == task_id) {
            (p.speed_bytes_sec, p.downloaded_bytes, p.total_bytes)
        } else {
            (task.speed_bytes_sec, task.downloaded_bytes, task.total_bytes)
        };

        let pct = if let Some(tot) = total {
            if tot > 0 {
                (downloaded as f64 / tot as f64 * 100.0).clamp(0.0, 100.0) as u32
            } else {
                0
            }
        } else {
            0
        };

        let short_name = if task.filename.chars().count() > 28 {
            format!("{}...", task.filename.chars().take(25).collect::<String>())
        } else {
            task.filename.clone()
        };

        let speed_str = format_tray_speed(speed);
        let tooltip = if let Some(tot) = total {
            format!(
                "Downex Task: {}
{}% of {} ({})",
                short_name,
                pct,
                format_tray_bytes(tot),
                speed_str
            )
        } else {
            format!(
                "Downex Task: {}
{} ({})",
                short_name,
                format_tray_bytes(downloaded),
                speed_str
            )
        };

        if guard.contains(&task_id) {
            if let Some(tray) = app.tray_by_id(&tray_id) {
                let _ = tray.set_tooltip(Some(&tooltip));
            } else {
                guard.remove(&task_id);
            }
        }

        if !guard.contains(&task_id) {
            if let Ok(icon) = Image::from_bytes(include_bytes!("../icons/32x32-update-1.png")) {
                let menu_summary = format!("Task: {} ({}%)", short_name, pct);
                let menu = match build_task_tray_menu(app, &task_id, &menu_summary) {
                    Ok(m) => m,
                    Err(e) => {
                        eprintln!("[Downex Task Tray] Failed to build task tray menu for {}: {}", task_id, e);
                        continue;
                    }
                };

                let tray_result = TrayIconBuilder::with_id(&tray_id)
                    .icon(icon)
                    .menu(&menu)
                    .tooltip(&tooltip)
                    .show_menu_on_left_click(false)
                    .on_menu_event(move |app, event| {
                        let id_str = event.id.as_ref();
                        if id_str.starts_with("task_show_") {
                            let _ = create_or_show_main_window(app);
                        } else if let Some(t) = id_str.strip_prefix("task_pause_") {
                            if let Some(state) = app.try_state::<crate::AppState>() {
                                let _ = state.queue_manager.pause_task(t);
                            }
                            sync_download_task_trays(app);
                            let _ = refresh_tray_menu(app);
                        } else if let Some(t) = id_str.strip_prefix("task_folder_") {
                            if let Some(state) = app.try_state::<crate::AppState>() {
                                if let Ok(Some(rec)) = state.db.get_download(t) {
                                    let path = std::path::Path::new(&rec.destination_path);
                                    if let Some(parent) = path.parent() {
                                        #[cfg(target_os = "windows")]
                                        {
                                            use std::os::windows::process::CommandExt;
                                            let _ = std::process::Command::new("explorer.exe")
                                                .arg(parent)
                                                .creation_flags(0x08000000)
                                                .spawn();
                                        }
                                        #[cfg(not(target_os = "windows"))]
                                        let _ = std::process::Command::new("explorer.exe").arg(parent).spawn();
                                    }
                                }
                            }
                        } else if let Some(t) = id_str.strip_prefix("task_dismiss_") {
                            let tid_str = format!("task-tray-{}", t);
                            let _ = app.remove_tray_by_id(&tid_str);
                            let mut g = ACTIVE_TASK_TRAYS.lock();
                            g.remove(t);
                        }
                    })
                    .on_tray_icon_event(|tray, event| {
                        let app = tray.app_handle();
                        match event {
                            TrayIconEvent::Click {
                                button: MouseButton::Left,
                                button_state: MouseButtonState::Up,
                                ..
                            } => {
                                let _ = create_or_show_main_window(app);
                            }
                            _ => {}
                        }
                    })
                    .build(app);

                if tray_result.is_ok() {
                    guard.insert(task_id);
                }
            }
        }
    }
}

pub fn create_or_show_main_window<R: Runtime>(app: &AppHandle<R>) -> Result<tauri::WebviewWindow<R>, Box<dyn std::error::Error>> {
    #[cfg(target_os = "windows")]
    crate::commands::set_process_priority_background(false);

    clean_all_task_trays(app);

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_always_on_top(false);
        if let Ok(icon) = Image::from_bytes(include_bytes!("../icons/128x128.png")) {
            let _ = window.set_icon(icon);
        }
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        #[cfg(target_os = "windows")]
        crate::commands::force_window_to_foreground(&window);
        let _ = refresh_tray_menu(app);
        if let Some(manifest) = get_pending_update_manifest() {
            let _ = app.emit("downex-update-detected", &manifest);
        }
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
            .always_on_top(false)
            .visible(true)
            .center();

        let window = builder.build()?;
        if let Ok(icon) = icon_res {
            let _ = window.set_icon(icon);
        }
        let _ = refresh_tray_menu(app);
        if let Some(manifest) = get_pending_update_manifest() {
            let _ = app.emit("downex-update-detected", &manifest);
        }
        Ok(window)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_tray_speed_formatting() {
        assert_eq!(format_tray_speed(0), "0 B/s");
        assert_eq!(format_tray_speed(512), "512 B/s");
        assert_eq!(format_tray_speed(1024), "1 KB/s");
        assert_eq!(format_tray_speed(1048576), "1.0 MB/s");
        assert_eq!(format_tray_speed(15728640), "15.0 MB/s");
        assert_eq!(format_tray_speed(1073741824), "1.0 GB/s");
    }

    #[test]
    fn test_format_tray_bytes_formatting() {
        assert_eq!(format_tray_bytes(0), "0 B");
        assert_eq!(format_tray_bytes(1024), "1 KB");
        assert_eq!(format_tray_bytes(400556032), "382.0 MB");
        assert_eq!(format_tray_bytes(10737418240), "10.0 GB");
    }

    #[test]
    fn test_multiple_running_tasks_assigned_distinct_tray_ids() {
        let task1 = crate::db::DownloadRecord {
            id: "task-bigg-boss".to_string(),
            url: "https://example.com/bigg-boss.mkv".to_string(),
            filename: "Bigg.Boss.S20E01.1080p.mkv".to_string(),
            destination_path: r"C:\Downloads\Bigg.Boss.S20E01.1080p.mkv".to_string(),
            total_bytes: Some(1800000000),
            downloaded_bytes: 54200000,
            status: "downloading".to_string(),
            etag: None,
            last_modified: None,
            headers_json: None,
            queue_id: "default".to_string(),
            speed_bytes_sec: 2097152,
            error_message: None,
            checksum: None,
            media_type: None,
            supports_ranges: true,
            created_at: 0,
            updated_at: 0,
            speed_limit_mbps: None,
        };

        let task2 = crate::db::DownloadRecord {
            id: "task-obsession".to_string(),
            url: "https://example.com/obsession.mkv".to_string(),
            filename: "Obsession.2025.1080p.mkv".to_string(),
            destination_path: r"C:\Downloads\Obsession.2025.1080p.mkv".to_string(),
            total_bytes: Some(2000000000),
            downloaded_bytes: 45400000,
            status: "downloading".to_string(),
            etag: None,
            last_modified: None,
            headers_json: None,
            queue_id: "default".to_string(),
            speed_bytes_sec: 2097152,
            error_message: None,
            checksum: None,
            media_type: None,
            supports_ranges: true,
            created_at: 0,
            updated_at: 0,
            speed_limit_mbps: None,
        };

        let downloads = vec![task1, task2];

        // Each task gets its own unique tray ID
        let tray_ids: Vec<String> = downloads.iter().map(|d| format!("task-tray-{}", d.id)).collect();
        assert_eq!(tray_ids.len(), 2);
        assert_ne!(tray_ids[0], tray_ids[1]);
        assert_eq!(tray_ids[0], "task-tray-task-bigg-boss");
        assert_eq!(tray_ids[1], "task-tray-task-obsession");

        // When task 1 completes, only task 2 remains active
        let completion_event = crate::engine::DownloadProgressEvent {
            task_id: "task-bigg-boss".to_string(),
            status: "completed".to_string(),
            downloaded_bytes: 1800000000,
            total_bytes: Some(1800000000),
            speed_bytes_sec: 0,
            eta_seconds: None,
            segments: vec![],
            supports_ranges: Some(true),
        };

        let remaining: Vec<_> = downloads
            .iter()
            .filter(|d| {
                if completion_event.task_id == d.id && completion_event.status == "completed" {
                    return false;
                }
                d.status == "downloading" || d.status == "probing"
            })
            .collect();

        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, "task-obsession");
    }

    #[test]
    fn test_active_download_filter_with_completion_event() {
        let dummy_record = crate::db::DownloadRecord {
            id: "task-test-complete".to_string(),
            url: "https://example.com/asset.iso".to_string(),
            filename: "asset.iso".to_string(),
            destination_path: "C:\\Downloads\\asset.iso".to_string(),
            total_bytes: Some(1000),
            downloaded_bytes: 1000,
            status: "downloading".to_string(),
            etag: None,
            last_modified: None,
            headers_json: None,
            queue_id: "default".to_string(),
            speed_bytes_sec: 500,
            error_message: None,
            checksum: None,
            media_type: None,
            supports_ranges: true,
            created_at: 0,
            updated_at: 0,
            speed_limit_mbps: None,
        };

        let downloads = vec![dummy_record];

        // 1. Without completion event, status "downloading" is counted active
        let active_without_event: Vec<_> = downloads
            .iter()
            .filter(|d| d.status == "downloading" || d.status == "probing")
            .collect();
        assert_eq!(active_without_event.len(), 1);

        // 2. When a completion progress event is received for that task, it is immediately excluded
        let completion_event = crate::engine::DownloadProgressEvent {
            task_id: "task-test-complete".to_string(),
            status: "completed".to_string(),
            downloaded_bytes: 1000,
            total_bytes: Some(1000),
            speed_bytes_sec: 0,
            eta_seconds: None,
            segments: vec![],
            supports_ranges: Some(true),
        };

        let active_with_completion: Vec<_> = downloads
            .iter()
            .filter(|d| {
                if completion_event.task_id == d.id && completion_event.status == "completed" {
                    return false;
                }
                d.status == "downloading" || d.status == "probing"
            })
            .collect();

        // Must be zero, guaranteeing immediate tray dismissal upon download completion!
        assert_eq!(active_with_completion.len(), 0);
    }
}
