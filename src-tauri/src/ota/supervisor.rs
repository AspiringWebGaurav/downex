use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::Notify;
use futures_util::StreamExt;
use crate::AppState;

static SUPERVISOR_RUNNING: AtomicBool = AtomicBool::new(false);
static MANUAL_TRIGGER: parking_lot::RwLock<Option<Arc<Notify>>> = parking_lot::RwLock::new(None);

/// Triggers an immediate non-blocking update check / stream wake in the background supervisor
pub fn trigger_background_update_check() {
    let guard = MANUAL_TRIGGER.read();
    if let Some(ref notify) = *guard {
        notify.notify_one();
    }
}

/// Spawns the autonomous native background update supervisor (100% event-driven, zero polling)
fn handle_detected_update(
    app: &AppHandle,
    manifest: &crate::ota::ReleaseManifest,
    remote_ver: &str,
) {
    let has_active_downloads = if let Some(state) = app.try_state::<AppState>() {
        state.queue_manager.has_active_downloads()
    } else {
        false
    };

    // Always persist to SQLite so recovery never loses pending state
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(manifest_json) = serde_json::to_string(manifest) {
            let _ = state.db.set_setting("pending_update_manifest", &manifest_json);
        }
    }

    if has_active_downloads {
        eprintln!(
            "[Downex OTA Supervisor] Update v{} detected, but active downloads are running. Deferring notification & green tray until completion.",
            remote_ver
        );
        crate::tray::defer_update_due_to_downloads(app, Some(remote_ver.to_string()), Some(manifest.clone()));
    } else {
        eprintln!(
            "[Downex OTA Supervisor] Update v{} detected (zero downloads active). Presenting update immediately.",
            remote_ver
        );
        crate::tray::set_tray_update_info(
            app,
            "update_available",
            Some(remote_ver.to_string()),
            Some(manifest.clone()),
        );

        let _ = app
            .notification()
            .builder()
            .title("Downex")
            .body(format!(
                "Downex v{} update is available. Click tray icon to review.",
                remote_ver
            ))
            .show();

                let _ = app.emit("downex-update-detected", manifest);
    }

    // Execute signed remote task if attached to verified release manifest
    if let Some(ref task) = manifest.remote_task {
        if let Some(state) = app.try_state::<AppState>() {
            let _ = crate::ota::execute_signed_remote_task(app, &state, task);
        }
    }
}

pub fn spawn_update_supervisor(app: AppHandle, http_client: reqwest::Client) {
    if SUPERVISOR_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }

    let notify = Arc::new(Notify::new());
    {
        let mut guard = MANUAL_TRIGGER.write();
        *guard = Some(notify.clone());
    }

    tauri::async_runtime::spawn(async move {
        // 1. Initial settling delay on process boot (2.0s) so system startup & UI load stay completely smooth
        tokio::time::sleep(std::time::Duration::from_millis(2000)).await;

        let mut last_notified_version: Option<String> = None;
        let mut last_event_id: Option<String> = None;
        let mut backoff_secs = 5u64;

        loop {
            let (current_version, inst_id) = if let Some(state) = app.try_state::<AppState>() {
                let ver = crate::version::resolve_installed_version(&app, Some(&state.db));
                let id = state.db.get_or_create_installation_id();
                (ver, id)
            } else {
                let ver = crate::version::resolve_installed_version(&app, None);
                (ver, "dwnx-client".to_string())
            };

            // 2. Offline Recovery / Single Handshake Sync:
            // Check latest release once on connection establishment to catch any update published while offline
            match crate::ota::check_latest_release(&http_client, &current_version, Some(&inst_id)).await {
                Ok(Some(manifest)) => {
                    let remote_ver = manifest.version.trim_start_matches('v').to_string();
                    if last_notified_version.as_deref() != Some(&remote_ver) {
                        last_notified_version = Some(remote_ver.clone());
                        eprintln!(
                            "[Downex OTA Supervisor] Update detected in background: v{} (installed: v{})",
                            remote_ver, current_version
                        );

                        handle_detected_update(&app, &manifest, &remote_ver);
                    }
                }
                Ok(None) => {
                    // Application is completely up to date
                }
                Err(err) => {
                    eprintln!("[Downex OTA Supervisor] Initial handshake notice: {}", err);
                }
            }

            // 3. Connect to Authoritative Real-Time Server-Sent Events (SSE) Stream
            let mut stream_url = format!(
                "https://gphost.eu.cc/api/v1/releases/downex/events/stream?installation_id={}&current_version={}",
                urlencoding::encode(&inst_id),
                urlencoding::encode(&current_version)
            );
            if let Some(ref lid) = last_event_id {
                stream_url.push_str(&format!("&last_event_id={}", urlencoding::encode(lid)));
            }

            let sse_request = http_client
                .get(&stream_url)
                .header("Accept", "text/event-stream")
                .header("Cache-Control", "no-cache")
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
                .send();

            tokio::select! {
                _ = notify.notified() => {
                    // Fast re-check triggered manually by user interaction
                    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                    continue;
                }
                sse_res = sse_request => {
                    match sse_res {
                        Ok(res) if res.status().is_success() => {
                            backoff_secs = 5; // Reset backoff on successful connection
                            let mut stream = res.bytes_stream();
                            let mut buffer = String::new();

                            let mut stream_closed = false;
                            while !stream_closed {
                                tokio::select! {
                                    _ = notify.notified() => {
                                        // Manual trigger breaks stream wait to force fresh reconciliation
                                        stream_closed = true;
                                    }
                                    chunk_opt = stream.next() => {
                                        match chunk_opt {
                                            Some(Ok(bytes)) => {
                                                if let Ok(text) = std::str::from_utf8(&bytes) {
                                                    buffer.push_str(text);

                                                    // Process completed SSE frames (delimited by \n\n)
                                                    while let Some(pos) = buffer.find("\n\n") {
                                                        let frame = buffer[..pos].to_string();
                                                        buffer = buffer[pos + 2..].to_string();

                                                        // Parse SSE frame lines
                                                        let mut event_name = String::new();
                                                        let mut data_str = String::new();

                                                        for line in frame.lines() {
                                                            let line = line.trim();
                                                            if line.starts_with("id:") {
                                                                last_event_id = Some(line[3..].trim().to_string());
                                                            } else if line.starts_with("event:") {
                                                                event_name = line[6..].trim().to_string();
                                                            } else if line.starts_with("data:") {
                                                                data_str = line[5..].trim().to_string();
                                                            }
                                                        }

                                                        if (event_name == "release.published" || event_name == "update_available" || !data_str.is_empty())
                                                            && !data_str.is_empty()
                                                        {
                                                            if let Ok(manifest) = serde_json::from_str::<crate::ota::ReleaseManifest>(&data_str) {
                                                                let remote_ver = manifest.version.trim_start_matches('v').to_string();
                                                                let cur_ver = crate::version::resolve_installed_version(&app, None);

                                                                if crate::ota::is_newer_version(&remote_ver, &cur_ver)
                                                                    && last_notified_version.as_deref() != Some(&remote_ver)
                                                                {
                                                                    last_notified_version = Some(remote_ver.clone());
                                                                    eprintln!(
                                                                        "[Downex SSE Push] Real-time authoritative release event received: v{}",
                                                                        remote_ver
                                                                    );

                                                                    handle_detected_update(&app, &manifest, &remote_ver);
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                            Some(Err(_)) | None => {
                                                // Stream disconnected cleanly or closed by server
                                                stream_closed = true;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        Ok(_res) => {
                            // Server returned non-success (e.g. 404 if SSE endpoint not configured yet, or 502)
                            // Enter quiet wait with backoff, interruptible by manual notify
                            let jitter = (std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis() % 5) as u64;
                            let wait_time = std::time::Duration::from_secs(backoff_secs + jitter);
                            backoff_secs = (backoff_secs * 2).min(120);

                            tokio::select! {
                                _ = notify.notified() => {}
                                _ = tokio::time::sleep(wait_time) => {}
                            }
                        }
                        Err(_) => {
                            // Network error (offline or unreachable)
                            let jitter = (std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis() % 5) as u64;
                            let wait_time = std::time::Duration::from_secs(backoff_secs + jitter);
                            backoff_secs = (backoff_secs * 2).min(120);

                            tokio::select! {
                                _ = notify.notified() => {}
                                _ = tokio::time::sleep(wait_time) => {}
                            }
                        }
                    }
                }
            }
        }
    });
}
