pub mod autostart;
pub mod bridge;
pub mod commands;
pub mod db;
pub mod engine;
pub mod ota;
pub mod scheduler;
pub mod tray;
pub mod version;

use commands::*;
use db::DatabaseManager;
use scheduler::QueueManager;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::mpsc;

pub struct AppState {
    pub db: DatabaseManager,
    pub queue_manager: Arc<QueueManager>,
    pub http_client: reqwest::Client,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    unsafe {
        let app_id: Vec<u16> = "com.downex.manager\0".encode_utf16().collect();
        let _ = windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(app_id.as_ptr());
    }

    let (progress_tx, mut progress_rx) = mpsc::channel(256);

    let is_background_boot = std::env::args().any(|arg| {
        arg == "--background" || arg == "--silent" || arg == "--minimized" || arg == "--autostart" || arg == "-b"
    });

    #[cfg(target_os = "windows")]
    if is_background_boot {
        // Run with BELOW_NORMAL_PRIORITY_CLASS so mouse cursor, DWM & foreground apps have 100% CPU priority
        crate::commands::set_process_priority_background(true);
    }

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
        .http1_only() // Force HTTP/1.1: Every worker opens an independent TCP socket (IDM architecture)
        .pool_max_idle_per_host(64)
        .tcp_nodelay(true)
        .tcp_keepalive(Some(std::time::Duration::from_secs(30)))
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .build()
        .expect("Failed to build HTTP client");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            #[cfg(target_os = "windows")]
            crate::commands::set_process_priority_background(false);

            let is_background = argv.iter().any(|arg| {
                arg == "--background" || arg == "--silent" || arg == "--minimized" || arg == "-b"
            });
            let is_stop = argv.iter().any(|arg| arg == "--stop" || arg == "--quit");
            if is_stop {
                app.exit(0);
                return;
            }

            // Check if a URL was passed from CLI
            let url_arg = argv.iter().find(|arg| arg.starts_with("http://") || arg.starts_with("https://"));
            if let Some(url) = url_arg {
                crate::commands::show_download_dialog(app, Some(serde_json::json!({ "url": url })));
                return;
            }

            if !is_background {
                let _ = crate::tray::create_or_show_main_window(app);
            }
        }))
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                    #[cfg(target_os = "windows")]
                    {
                        crate::commands::set_process_priority_background(true);
                        crate::commands::trim_process_working_set();
                    }
                    if window.label() == "main" {
                        let _ = crate::tray::refresh_tray_menu(window.app_handle());
                    }
                }
                tauri::WindowEvent::Focused(true) => {
                    #[cfg(target_os = "windows")]
                    crate::commands::set_process_priority_background(false);
                    if window.label() == "main" {
                        let _ = crate::tray::refresh_tray_menu(window.app_handle());
                    }
                }
                _ => {}
            }
        })
        .setup(move |app| {
            // Initialize SQLite DB
            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let db_path = app_data_dir.join("downex.db");

            let db = DatabaseManager::new(&db_path).unwrap_or_else(|err| {
                eprintln!("[Downex DB] Primary db init failed: {}. Using local fallback...", err);
                DatabaseManager::new("downex_local.db").expect("Failed to initialize fallback database")
            });

            // Reconcile interrupted tasks
            let _ = db.recover_interrupted_tasks();

            let queue_manager = Arc::new(QueueManager::new(
                client.clone(),
                db.clone(),
                progress_tx,
            ));

            app.manage(AppState {
                db: db.clone(),
                queue_manager: queue_manager.clone(),
                http_client: client,
            });

            // Setup system tray AFTER AppState is managed so dynamic stats are accessible
            if let Ok(tray) = tray::setup_system_tray(app.handle()) {
                app.manage(tray);
            }

            // Sync Windows Startup autostart entry with current executable and SQLite setting
            crate::autostart::sync_autostart_on_boot(&db);

            // Ensure main downloader window is displayed and focused on initial launch (unless background boot)
            if let Some(main_win) = app.get_webview_window("main") {
                if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png")) {
                    let _ = main_win.set_icon(icon);
                }
                if !is_background_boot {
                    let _ = main_win.show();
                    let _ = main_win.unminimize();
                    let _ = main_win.set_focus();
                    let _ = crate::tray::refresh_tray_menu(app.handle());
                }
            }
            if !is_background_boot {
                #[cfg(target_os = "windows")]
                crate::commands::set_process_priority_background(false);
            } else {
                eprintln!("[Downex Setup] Started silently in background mode: running lightweight background engine in system tray with minimal RAM.");
                #[cfg(target_os = "windows")]
                {
                    crate::commands::set_process_priority_background(true);
                    crate::commands::trim_process_working_set();
                }
                let _ = crate::tray::refresh_tray_menu(app.handle());
            }

            // Initialize or load local secure bridge authentication token
            let token_path = app_data_dir.join("bridge.token");
            let auth_token = if token_path.exists() {
                std::fs::read_to_string(&token_path)
                    .unwrap_or_default()
                    .trim()
                    .to_string()
            } else {
                String::new()
            };
            let auth_token = if auth_token.len() >= 32 {
                auth_token
            } else {
                let new_token = format!(
                    "{}{}",
                    uuid::Uuid::new_v4().simple(),
                    uuid::Uuid::new_v4().simple()
                );
                let _ = std::fs::write(&token_path, &new_token);
                new_token
            };

            // Start extension HTTP loopback bridge on 127.0.0.1:18888 with token auth
            let bridge = Arc::new(bridge::ExtensionHttpBridge::new(
                Some(app.handle().clone()),
                queue_manager.clone(),
                db.clone(),
                18888,
                auth_token,
            ));
            bridge.start();

            // Forward download progress events to frontend at high frequency
            let app_handle = app.handle().clone();
            let db_handle = db.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(progress) = progress_rx.recv().await {
                    let is_completed = progress.status == "completed";
                    let task_id = progress.task_id.clone();
                    let _ = app_handle.emit("download-progress", &progress);

                    if is_completed {
                        let _ = crate::tray::refresh_tray_menu(&app_handle);
                        if let Ok(Some(record)) = db_handle.get_download(&task_id) {
                            if !record.url.trim().is_empty() && (record.total_bytes.unwrap_or(0) > 0 || record.downloaded_bytes > 0) {
                                let payload = serde_json::json!({
                                    "id": record.id,
                                    "url": record.url,
                                    "filename": record.filename,
                                    "destination_path": record.destination_path,
                                    "total_bytes": record.total_bytes,
                                    "downloaded_bytes": record.downloaded_bytes,
                                });
                                let _ = app_handle.emit("download-completed", &payload);
                                crate::commands::show_download_complete(&app_handle, Some(payload));
                            }
                        }
                    }
                }
            });

            // Self-Healing Rollback Recovery Handler: If watchdog rolled back bad update
            let is_rollback_recovery = std::env::args().any(|arg| arg == "--rollback-recovery");
            if is_rollback_recovery {
                eprintln!("[Downex OTA Recovery] Started in SELF-HEALING RECOVERY MODE (--rollback-recovery). Previous version safely preserved!");
                let current_exe = std::env::current_exe().unwrap_or_default();
                let actual_ver = crate::version::extract_pe_version(&current_exe)
                    .unwrap_or_else(|| app.package_info().version.to_string());
                crate::version::write_persisted_version(&app.handle(), Some(&db), &actual_ver);
                commands::sync_windows_installed_version(&actual_ver);
                let _ = app.handle().emit("ota-rollback-recovered", serde_json::json!({ "version": actual_ver }));
            }

            // Dynamically resolve and persist runtime installed version (GPN 1:1 REA pattern)
            let resolved_version = crate::version::resolve_installed_version(&app.handle(), Some(&db));
            eprintln!("[Downex Version] Dynamically resolved installed version: {}", resolved_version);
            commands::sync_windows_installed_version(&resolved_version);

            // Delay clean up of superseded .exe.old by 60 seconds of healthy uptime so watchdog can roll back if needed
            if !is_rollback_recovery {
                std::thread::spawn(|| {
                    std::thread::sleep(std::time::Duration::from_secs(60));
                    let _ = commands::cmd_clean_superseded_old_binaries();
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd_add_download,
            cmd_pause_download,
            cmd_resume_download,
            cmd_cancel_download,
            cmd_get_downloads,
            cmd_fetch_update_manifest,
            cmd_download_update_binary,
            cmd_check_updates,
            cmd_download_update_container,
            cmd_get_resolved_version,
            cmd_get_clipboard_text,
            cmd_sync_windows_installed_version,
            cmd_write_update_staging_file,
            cmd_get_staged_update,
            cmd_verify_update_signature,
            cmd_apply_in_process_update,
            cmd_clean_superseded_old_binaries,
            cmd_minimize_to_background,
            cmd_quit_app,
            cmd_set_tray_icon,
            cmd_get_default_download_dir,
            cmd_set_default_download_dir,
            cmd_set_max_segments,
            cmd_get_max_segments,
            cmd_is_autostart_enabled,
            cmd_set_autostart,
            cmd_change_download_destination,
            cmd_open_folder_picker,
            cmd_probe_url,
            cmd_start_queue,
            cmd_pause_queue,
            cmd_is_queue_running,
            cmd_queue_download,
            cmd_restore_manager_window,
            cmd_hide_main_window,
            cmd_show_download_dialog,
            cmd_close_download_dialog,
            cmd_get_download_dialog_payload,
            cmd_get_disk_free_space,
            cmd_open_file,
            cmd_open_file_with,
            cmd_open_file_folder,
            cmd_show_download_complete,
            cmd_close_download_complete,
            cmd_get_download_complete_payload,
            cmd_notify_dom_ready,
            cmd_show_restarting_window,
            cmd_get_restarting_payload,
            cmd_get_patch_notes,
            cmd_save_patch_note,
            cmd_delete_patch_note,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Downex application");
}
