pub mod bridge;
pub mod commands;
pub mod db;
pub mod engine;
pub mod ota;
pub mod scheduler;
pub mod tray;

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
    let (progress_tx, mut progress_rx) = mpsc::channel(256);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
        .http1_only() // Force HTTP/1.1: Every worker opens an independent TCP socket (IDM architecture)
        .pool_max_idle_per_host(64)
        .tcp_nodelay(true)
        .tcp_keepalive(Some(std::time::Duration::from_secs(30)))
        .build()
        .expect("Failed to build HTTP client");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let _ = crate::tray::create_or_show_main_window(app);
        }))
        .setup(move |app| {
            // Setup system tray
            let _ = tray::setup_system_tray(app.handle());

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
                        if let Ok(Some(record)) = db_handle.get_download(&task_id) {
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

                            // Hide main downloader window so only the complete dialog appears on the desktop (IDM tribute)
                            if let Some(main_win) = app_handle.get_webview_window("main") {
                                let _ = main_win.hide();
                                let _ = crate::tray::refresh_tray_menu(&app_handle);
                            }
                        }
                    }
                }
            });

            // Sync Windows Registry with active binary version (Installed Apps / Control Panel persistency)
            let running_version = app.package_info().version.to_string();
            commands::sync_windows_installed_version(&running_version);

            // Delay clean up of superseded .exe.old by 60 seconds of healthy uptime so watchdog can roll back if needed
            std::thread::spawn(|| {
                std::thread::sleep(std::time::Duration::from_secs(60));
                let _ = commands::cmd_clean_superseded_old_binaries();
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd_add_download,
            cmd_pause_download,
            cmd_resume_download,
            cmd_cancel_download,
            cmd_get_downloads,
            cmd_check_updates,
            cmd_get_resolved_version,
            cmd_sync_windows_installed_version,
            cmd_write_update_staging_file,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Downex application");
}
