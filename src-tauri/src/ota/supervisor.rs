use tauri::AppHandle;

/// Triggers an immediate non-blocking update check (strictly on-demand, zero background loops)
pub fn trigger_background_update_check() {
    // Zero-op: Update checks run strictly on UI open or user interaction in the frontend
}

/// No-op: Background update supervisor is completely disabled.
/// All updates are detected strictly when user opens the UI or interacts with Downex.
pub fn spawn_update_supervisor(_app: AppHandle, _http_client: reqwest::Client) {
    // Zero-op: Never poll or stream in the background while sitting in system tray
}
