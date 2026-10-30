use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::Notify;

static SUPERVISOR_RUNNING: AtomicBool = AtomicBool::new(false);
static MANUAL_TRIGGER: parking_lot::RwLock<Option<Arc<Notify>>> = parking_lot::RwLock::new(None);

/// Triggers an immediate non-blocking update check in the background supervisor
pub fn trigger_background_update_check() {
    let guard = MANUAL_TRIGGER.read();
    if let Some(ref notify) = *guard {
        notify.notify_one();
    }
}

/// Spawns the autonomous native background update supervisor
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
        // 1. Initial settling delay on process boot (4.0s) so system startup & UI load stay completely smooth
        tokio::time::sleep(std::time::Duration::from_millis(4000)).await;

        let mut last_notified_version: Option<String> = None;

        loop {
            let current_version = crate::version::resolve_installed_version(&app, None);

            // Execute resilient release check against GPHost
            match crate::ota::check_latest_release(&http_client, &current_version).await {
                Ok(Some(manifest)) => {
                    let remote_ver = manifest.version.trim_start_matches('v').to_string();

                    // Deduplication: Only alert once per version
                    let is_new_version = last_notified_version.as_deref() != Some(&remote_ver);
                    if is_new_version {
                        last_notified_version = Some(remote_ver.clone());
                        eprintln!(
                            "[Downex OTA Supervisor] Update detected in background: v{} (installed: v{})",
                            remote_ver, current_version
                        );

                        // 1. Update Tray Icon, Tooltip, and Context Menu in Native Host
                        crate::tray::set_tray_update_info(
                            &app,
                            "update_available",
                            Some(remote_ver.clone()),
                            Some(manifest.clone()),
                        );

                        // 2. Dispatch Non-Intrusive Windows Native Toast Notification (Deduplicated)
                        let _ = app
                            .notification()
                            .builder()
                            .title("Downex")
                            .body(format!(
                                "Downex v{} update is available. Click tray icon to review.",
                                remote_ver
                            ))
                            .show();

                        // 3. Emit real-time event to WebView2 if window is active
                        let _ = app.emit("downex-update-detected", &manifest);
                    }
                }
                Ok(None) => {
                    // Application is completely up to date
                }
                Err(err) => {
                    // Non-fatal network notice (e.g. machine temporarily offline or CDN hiccup)
                    eprintln!("[Downex OTA Supervisor] Probe notice (resilient retry): {}", err);
                }
            }

            // 2. Event-driven wait: Wake immediately on manual trigger / network event,
            // or sleep for adaptive jittered cadence (15-20 min) to prevent server load
            let jitter_secs = (std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                % 60) as u64;
            let sleep_duration = std::time::Duration::from_secs(15 * 60 + jitter_secs);

            tokio::select! {
                _ = notify.notified() => {
                    // Fast re-check triggered by user interaction or network reconnect
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                }
                _ = tokio::time::sleep(sleep_duration) => {
                    // Periodic cadence elapsed
                }
            }
        }
    });
}

