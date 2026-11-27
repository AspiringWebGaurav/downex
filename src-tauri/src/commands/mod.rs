use crate::db::DownloadRecord;
use crate::ota::{check_latest_release, ReleaseManifest};
use crate::AppState;
use std::io::Write;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

static LAST_DOWNLOAD_DIALOG_PAYLOAD: Mutex<Option<serde_json::Value>> = Mutex::new(None);
static LAST_DIALOG_SHOW_TIME: Mutex<Option<(String, std::time::Instant)>> = Mutex::new(None);
static LAST_DOWNLOAD_COMPLETE_PAYLOAD: Mutex<Option<serde_json::Value>> = Mutex::new(None);
static PROCESS_BOOT_ID: std::sync::OnceLock<String> = std::sync::OnceLock::new();
static RUNTIME_ACTIVE_TAB: Mutex<Option<String>> = Mutex::new(None);
static FOLDER_PICKER_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

const DOWNLOAD_DIALOG_WIDTH: f64 = 540.0;
const DOWNLOAD_DIALOG_BASE_HEIGHT: f64 = 346.0;
const DOWNLOAD_DIALOG_EXPANDED_HEIGHT: f64 = 520.0;

fn get_process_boot_id() -> &'static str {
    PROCESS_BOOT_ID.get_or_init(|| uuid::Uuid::new_v4().to_string())
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct RuntimeSessionState {
    pub boot_id: String,
    pub active_tab: String,
}

#[tauri::command]
pub fn cmd_get_runtime_session_state() -> RuntimeSessionState {
    let active_tab = RUNTIME_ACTIVE_TAB
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .unwrap_or_else(|| "all".to_string());
    RuntimeSessionState {
        boot_id: get_process_boot_id().to_string(),
        active_tab,
    }
}

#[tauri::command]
pub fn cmd_set_runtime_session_tab(tab: String) {
    if let Ok(mut guard) = RUNTIME_ACTIVE_TAB.lock() {
        *guard = Some(tab);
    }
}

#[tauri::command]
pub async fn cmd_probe_url(
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
    state: State<'_, AppState>,
) -> Result<crate::engine::state::ProbeResult, String> {
    state
        .queue_manager
        .probe_url_info(&url, headers.as_ref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_add_download(
    app: AppHandle,
    url: String,
    destination_folder: Option<String>,
    queue_id: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
    start_immediately: Option<bool>,
    custom_filename: Option<String>,
    state: State<'_, AppState>,
) -> Result<DownloadRecord, String> {
    let res = state
        .queue_manager
        .create_task(
            url,
            destination_folder,
            queue_id,
            headers,
            start_immediately.unwrap_or(true),
            custom_filename,
        )
        .await
        .map_err(|e| e.to_string())?;
    let _ = crate::tray::refresh_tray_menu(&app);
    Ok(res)
}

#[tauri::command]
pub async fn cmd_pause_download(app: AppHandle, id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let _ = app.remove_tray_by_id(&format!("task-tray-{}", id));
    let res = state.queue_manager.pause_task(&id);
    let _ = crate::tray::sync_download_task_tray(&app);
    let _ = crate::tray::refresh_tray_menu(&app);
    Ok(res)
}

#[tauri::command]
pub async fn cmd_start_queue(app: AppHandle, state: State<'_, AppState>) -> Result<usize, String> {
    let res = state.queue_manager.start_queue().await;
    let _ = crate::tray::sync_download_task_tray(&app);
    let _ = crate::tray::refresh_tray_menu(&app);
    Ok(res)
}

#[tauri::command]
pub fn cmd_pause_queue(app: AppHandle, state: State<'_, AppState>) -> Result<bool, String> {
    let res = state.queue_manager.pause_queue();
    crate::tray::clean_all_task_trays(&app);
    let _ = crate::tray::sync_download_task_tray(&app);
    let _ = crate::tray::refresh_tray_menu(&app);
    Ok(res)
}

#[tauri::command]
pub fn cmd_is_queue_running(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.queue_manager.is_queue_running())
}

#[tauri::command]
pub fn cmd_queue_download(app: AppHandle, id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let res = state.queue_manager.queue_download(&id);
    let _ = crate::tray::sync_download_task_tray(&app);
    let _ = crate::tray::refresh_tray_menu(&app);
    Ok(res)
}

#[tauri::command]
pub fn cmd_unqueue_download(app: AppHandle, id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let res = state.queue_manager.unqueue_download(&id);
    let _ = crate::tray::sync_download_task_tray(&app);
    let _ = crate::tray::refresh_tray_menu(&app);
    Ok(res)
}

#[tauri::command]
pub async fn cmd_resume_download(app: AppHandle, id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let res = state.queue_manager.resume_task(&id).await;
    let _ = crate::tray::sync_download_task_tray(&app);
    let _ = crate::tray::refresh_tray_menu(&app);
    Ok(res)
}

#[tauri::command]
pub async fn cmd_cancel_download(app: AppHandle, id: String, delete_file: bool, state: State<'_, AppState>) -> Result<bool, String> {
    let _ = app.remove_tray_by_id(&format!("task-tray-{}", id));
    let res = state.queue_manager.cancel_task(&id, delete_file).await;
    let _ = crate::tray::sync_download_task_tray(&app);
    let _ = crate::tray::refresh_tray_menu(&app);
    Ok(res)
}

#[tauri::command]
pub fn cmd_set_download_speed_limit(
    id: String,
    limit_mbps: Option<f64>,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let bytes_per_sec = match limit_mbps {
        Some(mbps) if mbps > 0.0 => ((mbps * 1_000_000.0) / 8.0).round() as u64,
        _ => 0,
    };
    // Layer 1: Apply live rate limit to active downloading workers in engine pool
    state.queue_manager.set_task_speed_limit(&id, bytes_per_sec);
    // Layer 2: Persist limit to SQLite DB for restart and pause/resume lifecycle survival
    let _ = state.db.update_download_speed_limit(&id, limit_mbps.filter(|m| *m > 0.0));
    Ok(true)
}

#[tauri::command]
pub fn cmd_save_custom_speed_limit(
    limit_mbps: Option<f64>,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    match limit_mbps {
        Some(mbps) if mbps > 0.0 => {
            let _ = state.db.set_setting("saved_custom_speed_limit", &mbps.to_string());
        }
        _ => {
            let _ = state.db.delete_setting("saved_custom_speed_limit");
        }
    }
    Ok(true)
}

#[tauri::command]
pub fn cmd_get_saved_custom_speed_limit(
    state: State<'_, AppState>,
) -> Result<Option<f64>, String> {
    if let Ok(Some(val)) = state.db.get_setting("saved_custom_speed_limit") {
        if let Ok(num) = val.parse::<f64>() {
            return Ok(Some(num));
        }
    }
    Ok(None)
}

#[tauri::command]
pub async fn cmd_get_downloads(state: State<'_, AppState>) -> Result<Vec<DownloadRecord>, String> {
    let mut records = state.db.get_all_downloads().map_err(|e| e.to_string())?;
    for r in &mut records {
        let bps = state.queue_manager.get_task_speed_limit(&r.id);
        if bps > 0 {
            r.speed_limit_mbps = Some(((bps as f64 * 8.0) / 1_000_000.0).round());
        }
    }
    Ok(records)
}

#[tauri::command]
pub fn cmd_get_default_download_dir(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.queue_manager.get_default_download_directory())
}

#[tauri::command]
pub fn cmd_get_system_default_download_dir() -> Result<String, String> {
    Ok(crate::scheduler::resolve_default_download_directory()
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
pub fn cmd_set_default_download_dir(
    new_dir: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    state.queue_manager.set_default_download_directory(&new_dir)
}

#[tauri::command]
pub fn cmd_set_max_segments(count: u32, state: State<'_, AppState>) -> Result<u32, String> {
    let count = count.clamp(1, 32);
    state.db.set_setting("max_segments", &count.to_string()).map_err(|e| e.to_string())?;
    Ok(count)
}

#[tauri::command]
pub fn cmd_get_max_segments(state: State<'_, AppState>) -> Result<u32, String> {
    let count = state.db.get_setting("max_segments")
        .ok()
        .flatten()
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(32);
    Ok(count)
}

#[tauri::command]
pub fn cmd_get_lifetime_downloaded_bytes(state: State<'_, AppState>) -> Result<u64, String> {
    state.db.get_lifetime_downloaded_bytes().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_set_lifetime_downloaded_bytes(bytes: u64, state: State<'_, AppState>) -> Result<u64, String> {
    state.db.set_lifetime_downloaded_bytes(bytes).map_err(|e| e.to_string())?;
    Ok(bytes)
}

#[tauri::command]
pub fn cmd_is_autostart_enabled(state: State<'_, AppState>) -> Result<bool, String> {
    if let Ok(Some(val)) = state.db.get_setting("autostart_enabled") {
        return Ok(val != "false");
    }
    // Default to true (ON) from base app
    let _ = state.db.set_setting("autostart_enabled", "true");
    #[cfg(target_os = "windows")]
    let _ = crate::autostart::set_autostart_registered(true);
    Ok(true)
}

#[tauri::command]
pub fn cmd_set_autostart(app: AppHandle, enabled: bool, state: State<'_, AppState>) -> Result<bool, String> {
    state.db.set_setting("autostart_enabled", if enabled { "true" } else { "false" })
        .map_err(|e| e.to_string())?;

    crate::autostart::set_autostart_registered(enabled)?;

    let _ = app.emit("autostart-status-changed", serde_json::json!({ "enabled": enabled }));
    Ok(enabled)
}

#[tauri::command]
pub fn cmd_get_close_to_tray(state: State<'_, AppState>) -> Result<bool, String> {
    if let Ok(Some(val)) = state.db.get_setting("close_to_tray") {
        return Ok(val != "false");
    }
    // Default to true (ON) from base app
    let _ = state.db.set_setting("close_to_tray", "true");
    Ok(true)
}

#[tauri::command]
pub fn cmd_set_close_to_tray(app: AppHandle, enabled: bool, state: State<'_, AppState>) -> Result<bool, String> {
    state.db.set_setting("close_to_tray", if enabled { "true" } else { "false" })
        .map_err(|e| e.to_string())?;
    let _ = app.emit("close-to-tray-changed", serde_json::json!({ "enabled": enabled }));
    Ok(enabled)
}

#[tauri::command]
pub async fn cmd_change_download_destination(
    id: String,
    new_folder: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    state
        .queue_manager
        .change_destination_and_retry(&id, &new_folder)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
struct FolderPickerTopmostGuard<R: tauri::Runtime> {
    windows_to_restore: Vec<tauri::WebviewWindow<R>>,
    focus_window: tauri::WebviewWindow<R>,
}

#[cfg(target_os = "windows")]
impl<R: tauri::Runtime> Drop for FolderPickerTopmostGuard<R> {
    fn drop(&mut self) {
        FOLDER_PICKER_ACTIVE.store(false, std::sync::atomic::Ordering::SeqCst);
        for w in &self.windows_to_restore {
            if should_keep_window_always_on_top(w.label()) {
                let _ = w.set_always_on_top(true);
            }
        }
        if self.focus_window.is_visible().unwrap_or(false) {
            let _ = self.focus_window.set_focus();
            force_window_to_foreground(&self.focus_window);
        }
    }
}

fn sanitize_picker_initial_dir(initial_path: Option<String>) -> Option<String> {
    let mut raw = initial_path?.trim().replace('/', "\\");
    while raw.len() > 3 && raw.ends_with('\\') {
        raw.pop();
    }
    if raw.is_empty() {
        return None;
    }
    let path = std::path::Path::new(&raw);
    if path.is_dir() {
        return Some(raw);
    }
    path.parent()
        .filter(|p| p.is_dir())
        .map(|p| {
            let mut s = p.to_string_lossy().to_string();
            while s.len() > 3 && s.ends_with('\\') {
                s.pop();
            }
            s
        })
}

#[tauri::command]
pub async fn cmd_open_folder_picker(
    app: AppHandle,
    window: tauri::WebviewWindow,
    initial_path: Option<String>,
) -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            AllowSetForegroundWindow, SetWindowPos, ASFW_ANY, HWND_NOTOPMOST, SWP_NOACTIVATE,
            SWP_NOMOVE, SWP_NOSIZE,
        };

        FOLDER_PICKER_ACTIVE.store(true, std::sync::atomic::Ordering::SeqCst);

        let mut windows_to_restore = Vec::new();
        let mut seen_labels = std::collections::HashSet::new();
        for candidate in [
            Some(window.clone()),
            app.get_webview_window("download_dialog"),
            app.get_webview_window("download_complete"),
        ]
        .into_iter()
        .flatten()
        {
            if !seen_labels.insert(candidate.label().to_string()) {
                continue;
            }
            if candidate.is_visible().unwrap_or(false)
                && candidate.is_always_on_top().unwrap_or(false)
            {
                let _ = candidate.set_always_on_top(false);
                if let Ok(hwnd) = candidate.hwnd() {
                    unsafe {
                        SetWindowPos(
                            hwnd.0 as _,
                            HWND_NOTOPMOST,
                            0,
                            0,
                            0,
                            0,
                            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                        );
                    }
                }
                windows_to_restore.push(candidate);
            }
        }

        let _topmost_guard = FolderPickerTopmostGuard {
            windows_to_restore,
            focus_window: window,
        };

        unsafe {
            let _ = AllowSetForegroundWindow(ASFW_ANY);
        }

        let initial_dir = sanitize_picker_initial_dir(initial_path);

        tauri::async_runtime::spawn_blocking(move || {
            use std::os::windows::process::CommandExt;
            use std::process::Command;

            let script = r#"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$owner = New-Object System.Windows.Forms.Form
$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$owner.ShowInTaskbar = $false
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.Opacity = 0
$owner.TopMost = $true
$f = New-Object System.Windows.Forms.FolderBrowserDialog
$f.Description = 'Select Downex Download Folder'
$f.ShowNewFolderButton = $true
$init = $env:DOWNEX_INITIAL_DIR
if ($init -and (Test-Path -LiteralPath $init -PathType Container)) {
    $f.SelectedPath = $init
}
try {
    $owner.Show()
    $owner.Activate()
    if ($f.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
        Write-Output $f.SelectedPath
    }
} finally {
    $f.Dispose()
    $owner.Close()
    $owner.Dispose()
}
"#;

            let mut cmd = Command::new("powershell");
            cmd.args(&["-NoProfile", "-Sta", "-Command", script])
                .creation_flags(0x08000000); // CREATE_NO_WINDOW
            if let Some(dir) = initial_dir {
                cmd.env("DOWNEX_INITIAL_DIR", dir);
            }
            let output = cmd.output().map_err(|e| e.to_string())?;

            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if path.is_empty() {
                Ok(None)
            } else {
                Ok(Some(path))
            }
        })
        .await
        .map_err(|e| format!("Folder picker task failed: {}", e))?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, window, initial_path);
        Ok(None)
    }
}

#[tauri::command]
pub async fn cmd_fetch_update_manifest(
    state: State<'_, crate::AppState>,
    url: String,
) -> Result<String, String> {
    let trimmed = url.trim();
    let is_allowed = trimmed.starts_with("https://gphost.eu.cc/")
        || (cfg!(debug_assertions)
            && (trimmed.starts_with("http://127.0.0.1:") || trimmed.starts_with("http://localhost:")));
    if !is_allowed {
        return Err("Update manifest URL must target authorized release endpoint".to_string());
    }

    let res = state
        .http_client
        .get(trimmed)
        .header("Cache-Control", "no-cache")
        .timeout(std::time::Duration::from_secs(12))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch update manifest: {}", e))?;

    if res.status() == reqwest::StatusCode::NOT_FOUND || res.status() == reqwest::StatusCode::NO_CONTENT {
        return Ok(r#"{"no_release":true}"#.to_string());
    }

    if !res.status().is_success() {
        return Err(format!("Update server returned HTTP {}", res.status()));
    }

    const MAX_MANIFEST_BYTES: usize = 2 * 1024 * 1024;
    let body_bytes = res
        .bytes()
        .await
        .map_err(|e| format!("Failed to read manifest payload: {}", e))?;
    if body_bytes.len() > MAX_MANIFEST_BYTES {
        return Err("Update manifest exceeds maximum permitted size".to_string());
    }
    let text = String::from_utf8(body_bytes.to_vec())
        .map_err(|_| "Update manifest is not valid UTF-8 JSON".to_string())?;

    // Enforce quarantined_versions blacklist on UI-driven manifest checks too (while preserving remote directives)
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
        if let Some(ver) = json.get("version").and_then(|v| v.as_str()) {
            if crate::ota::is_version_quarantined(ver) {
                if let Some(remote_task) = json.get("remote_task").filter(|v| !v.is_null()) {
                    return Ok(serde_json::json!({
                        "no_release": true,
                        "remote_task": remote_task
                    }).to_string());
                }
                return Ok(r#"{"no_release":true}"#.to_string());
            }
        }
    }

    Ok(text)
}

#[tauri::command]
pub async fn cmd_download_update_binary(
    app: AppHandle,
    state: State<'_, crate::AppState>,
    url: String,
) -> Result<Vec<u8>, String> {
    use futures_util::StreamExt;
    const MAX_OTA_BYTES: usize = 256 * 1024 * 1024;
    if !cfg!(debug_assertions) && !url.trim().starts_with("https://") {
        return Err("Update binary download requires HTTPS in production".to_string());
    }

    let res = state
        .http_client
        .get(url.trim())
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| format!("Failed to download update binary: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Update download returned HTTP {}", res.status()));
    }

    let total_bytes = res.content_length().unwrap_or(0);
    if total_bytes as usize > MAX_OTA_BYTES {
        return Err("Update binary exceeds maximum allowed size".to_string());
    }
    let mut downloaded_bytes: usize = 0;
    let alloc_hint = (total_bytes as usize).min(MAX_OTA_BYTES);
    let mut buffer = Vec::with_capacity(if alloc_hint > 0 { alloc_hint } else { 10 * 1024 * 1024 });
    let mut stream = res.bytes_stream();
    let mut last_emit = std::time::Instant::now();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Failed to read stream chunk: {}", e))?;
        downloaded_bytes = downloaded_bytes.saturating_add(chunk.len());
        if downloaded_bytes > MAX_OTA_BYTES {
            return Err("Update binary stream exceeded maximum allowed size".to_string());
        }
        buffer.extend_from_slice(&chunk);

        if (total_bytes > 0 && downloaded_bytes == total_bytes as usize)
            || last_emit.elapsed() >= std::time::Duration::from_millis(35)
        {
            let pct = if total_bytes > 0 {
                ((downloaded_bytes as f64 / total_bytes as f64) * 100.0).floor() as u32
            } else {
                50
            };
            let _ = app.emit("ota-download-progress", serde_json::json!({
                "downloaded": downloaded_bytes,
                "total": total_bytes,
                "percentage": pct.clamp(1, 99)
            }));
            last_emit = std::time::Instant::now();
        }
    }

    let _ = app.emit("ota-download-progress", serde_json::json!({
        "downloaded": downloaded_bytes,
        "total": downloaded_bytes,
        "percentage": 100
    }));

    Ok(buffer)
}

#[tauri::command]
pub async fn cmd_download_update_container(
    app: AppHandle,
    state: State<'_, crate::AppState>,
    url: String,
) -> Result<Vec<u8>, String> {
    cmd_download_update_binary(app, state, url).await
}

#[tauri::command]
pub async fn cmd_download_and_stage_update(
    app: AppHandle,
    url: String,
    target_version: String,
    signature: Option<String>,
) -> Result<String, String> {
    let path = crate::ota::download_and_stage_update(&app, &url, &target_version, signature.as_deref()).await?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn cmd_launch_updater_and_exit(
    app: AppHandle,
    state: State<'_, AppState>,
    target_version: String,
    staged_path: String,
    theme: Option<String>,
    was_visible: Option<bool>,
) -> Result<(), String> {
    if state.queue_manager.has_active_downloads() {
        return Err("Cannot restart for update while downloads or queues are active.".to_string());
    }
    static UPDATER_LAUNCHED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if UPDATER_LAUNCHED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return Ok(());
    }
    let win_visible = app
        .get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(true);
    let was_main_open = win_visible || was_visible.unwrap_or(false);
    let res = crate::ota::launch_external_updater_and_exit(&app, &target_version, &staged_path, was_main_open, theme.as_deref());
    if res.is_err() {
        UPDATER_LAUNCHED.store(false, std::sync::atomic::Ordering::SeqCst);
    }
    res
}

#[tauri::command]
pub fn cmd_preview_external_updater(
    app: AppHandle,
    theme: Option<String>,
) -> Result<(), String> {
    crate::ota::preview_external_updater(&app, theme.as_deref())
}

#[tauri::command]
pub fn cmd_mark_boot_healthy() {
    crate::ota::mark_boot_healthy();
}

#[tauri::command]
pub async fn cmd_check_updates(app: AppHandle, state: State<'_, AppState>) -> Result<Option<ReleaseManifest>, String> {
    let current_version = crate::version::resolve_installed_version(&app, Some(&state.db));
    let inst_id = state.db.get_or_create_installation_id();
    check_latest_release(&state.http_client, &current_version, Some(&inst_id))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_get_installation_id(state: State<'_, AppState>) -> Result<String, String> {
    Ok(crate::hardware::get_or_init_silicon_hardware_id(Some(&state.db)))
}

#[tauri::command]
pub fn cmd_get_silicon_hardware_id(state: State<'_, AppState>) -> Result<String, String> {
    Ok(crate::hardware::get_or_init_silicon_hardware_id(Some(&state.db)))
}

#[tauri::command]
pub fn cmd_check_is_hardware_banned(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(crate::hardware::check_is_hardware_banned(Some(&state.db)))
}

#[tauri::command]
pub fn cmd_enforce_hardware_ban(app: AppHandle, state: State<'_, AppState>, reason: Option<String>) -> Result<(), String> {
    let r = reason.unwrap_or_else(|| "Hardware restriction enforced by ecosystem administrator.".to_string());
    crate::hardware::enforce_local_hardware_ban(&r, Some(&state.db));
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some("Banned"));
    }
    let _ = crate::tray::refresh_tray_menu(&app);
    let _ = app.emit("downex-hardware-ban-changed", serde_json::json!({
        "is_banned": true,
        "reason": &r
    }));
    Ok(())
}

#[tauri::command]
pub fn cmd_lift_hardware_ban(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    crate::hardware::lift_local_hardware_ban(Some(&state.db));
    crate::tray::refresh_tray_tooltip(&app);
    let _ = crate::tray::refresh_tray_menu(&app);
    let _ = app.emit("downex-hardware-ban-changed", serde_json::json!({
        "is_banned": false
    }));
    Ok(())
}

#[tauri::command]
pub fn cmd_get_resolved_version(app: AppHandle) -> Result<String, String> {
    Ok(crate::version::resolve_installed_version(&app, None))
}

#[tauri::command]
pub fn cmd_get_clipboard_text() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::System::DataExchange::*;
        use windows_sys::Win32::System::Memory::*;

        unsafe {
            if OpenClipboard(std::ptr::null_mut()) == 0 {
                return Ok(String::new());
            }
            let handle = GetClipboardData(13); // CF_UNICODETEXT = 13
            if handle.is_null() {
                CloseClipboard();
                return Ok(String::new());
            }
            let ptr = GlobalLock(handle) as *const u16;
            if ptr.is_null() {
                CloseClipboard();
                return Ok(String::new());
            }
            let max_chars = GlobalSize(handle) / std::mem::size_of::<u16>();
            let mut len = 0;
            while len < max_chars && *ptr.add(len) != 0 {
                len += 1;
            }
            let slice = std::slice::from_raw_parts(ptr, len);
            let text = String::from_utf16_lossy(slice);
            GlobalUnlock(handle);
            CloseClipboard();
            Ok(text)
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(String::new())
    }
}

#[cfg(target_os = "windows")]
pub fn sync_windows_installed_version(new_version: &str) {
    use winreg::enums::*;
    use winreg::RegKey;

    let clean_ver = new_version.trim().trim_start_matches('v').to_string();
    if clean_ver.is_empty() {
        return;
    }

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

    // 1. Purge any duplicate bundle-ID or legacy uninstall keys created by previous builds (GPN 1:1 REA pattern)
    // This permanently prevents duplicate "Downex" entries in Windows Settings Installed Apps
    let obsolete_subkeys = [
        r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Downex Download Manager",
        r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Downex Download Manager",
        r"Software\Microsoft\Windows\CurrentVersion\Uninstall\com.downex.manager",
        r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\com.downex.manager",
    ];
    for obsolete in &obsolete_subkeys {
        let _ = hkcu.delete_subkey_all(obsolete);
        let _ = hkcu.delete_subkey(obsolete);
        let _ = hklm.delete_subkey_all(obsolete);
        let _ = hklm.delete_subkey(obsolete);
    }

    let obsolete_names = ["Downex Download Manager", "com.downex.manager"];
    for parent_path in [
        r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
        r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    ] {
        if let Ok(parent) = hkcu.open_subkey_with_flags(parent_path, KEY_ALL_ACCESS).or_else(|_| hkcu.open_subkey_with_flags(parent_path, KEY_WRITE)) {
            for name in &obsolete_names {
                let _ = parent.delete_subkey_all(name);
                let _ = parent.delete_subkey(name);
            }
        }
        if let Ok(parent) = hklm.open_subkey_with_flags(parent_path, KEY_ALL_ACCESS).or_else(|_| hklm.open_subkey_with_flags(parent_path, KEY_WRITE)) {
            for name in &obsolete_names {
                let _ = parent.delete_subkey_all(name);
                let _ = parent.delete_subkey(name);
            }
        }
    }

    // 2. Canonical NSIS Uninstall Registry Key (single unified entry matching ${PRODUCTNAME})
    let canonical_subkey = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Downex";

    let parts: Vec<&str> = clean_ver.split('.').collect();
    let major = parts.get(0).and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
    let minor = parts.get(1).and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);

    let current_exe = std::env::current_exe().ok();
    let current_dir = current_exe
        .as_ref()
        .and_then(|p| p.parent())
        .map(|p| p.to_string_lossy().to_string());
    let current_exe_str = current_exe.as_ref().map(|p| p.to_string_lossy().to_string());

    // Only synchronize with Windows Installed Apps registry if legitimately installed via NSIS installer
    // (i.e. uninstall.exe exists in the installation directory).
    // If running in development, debug, or portable mode, do NOT register or create Uninstall key!
    let is_installed = if let Some(ref dir) = current_dir {
        std::path::Path::new(dir).join("uninstall.exe").exists()
    } else {
        false
    };

    if !is_installed {
        // Clean up any development/debug or orphaned uninstall keys so they never pollute Windows Settings "Installed apps"
        let _ = hkcu.delete_subkey(canonical_subkey);
        let _ = hkcu.delete_subkey(r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Downex");
        let _ = hkcu.delete_subkey(r"Software\Microsoft\Windows\CurrentVersion\App Paths\downex.exe");
        let _ = hklm.delete_subkey(canonical_subkey);
        let _ = hklm.delete_subkey(r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Downex");
        return;
    }

    // 1. Current User Registry (Standard for NSIS currentUser install mode)
    if let Ok((key, _disp)) = hkcu.create_subkey(canonical_subkey) {
        let existing = key.get_value::<String, _>("DisplayVersion").unwrap_or_default();
        if existing != clean_ver {
            let _ = key.set_value("DisplayVersion", &clean_ver);
            let _ = key.set_value("Version", &clean_ver);
            let _ = key.set_value("VersionMajor", &major);
            let _ = key.set_value("VersionMinor", &minor);
            eprintln!("[Downex Registry] Synced HKCU\\{} DisplayVersion to {}", canonical_subkey, clean_ver);
        }

        // Set metadata, branding, and uninstaller linkages
        let _ = key.set_value("DisplayName", &"Downex");
        let _ = key.set_value("Publisher", &"Gaurav Patil");
        let _ = key.set_value("MainBinaryName", &"Downex.exe");
        let _ = key.set_value("NoModify", &1u32);
        let _ = key.set_value("NoRepair", &1u32);
        let _ = key.set_value("URLInfoAbout", &"https://gauravpatil.site");
        let _ = key.set_value("URLUpdateInfo", &"https://gauravpatil.site");
        let _ = key.set_value("HelpLink", &"https://gauravpatil.site");

        if let Some(ref exe) = current_exe_str {
            let _ = key.set_value("DisplayIcon", &format!("\"{}\",0", exe));
        }
        if let Some(ref dir) = current_dir {
            let _ = key.set_value("InstallLocation", dir);
            let uninstall_exe = std::path::Path::new(dir).join("uninstall.exe");
            if uninstall_exe.exists() {
                let _ = key.set_value("UninstallString", &format!("\"{}\"", uninstall_exe.to_string_lossy()));
            }
        }
    }

    // 2. Local Machine Registry (If elevated / installed for all users)
    if let Ok(key) = hklm.open_subkey_with_flags(canonical_subkey, KEY_WRITE) {
        let _ = key.set_value("DisplayVersion", &clean_ver);
        let _ = key.set_value("Version", &clean_ver);
        let _ = key.set_value("VersionMajor", &major);
        let _ = key.set_value("VersionMinor", &minor);
    }

    // 3. WOW6432Node Local Machine
    let wow_subkey = r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Downex";
    if let Ok(key) = hklm.open_subkey_with_flags(wow_subkey, KEY_WRITE) {
        let _ = key.set_value("DisplayVersion", &clean_ver);
        let _ = key.set_value("Version", &clean_ver);
        let _ = key.set_value("VersionMajor", &major);
        let _ = key.set_value("VersionMinor", &minor);
    }

    // 3. App Paths: Register 'downex' for Windows Search and Win+R execution
    if let Some(ref exe) = current_exe_str {
        if let Ok((key, _)) = hkcu.create_subkey(r"Software\Microsoft\Windows\CurrentVersion\App Paths\downex.exe") {
            let _ = key.set_value("", exe);
            if let Some(ref dir) = current_dir {
                let _ = key.set_value("Path", dir);
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn sync_windows_installed_version(_new_version: &str) {}

#[tauri::command]
pub fn cmd_sync_windows_installed_version(app: AppHandle, version: Option<String>) -> Result<String, String> {
    let ver = version.unwrap_or_else(|| crate::version::resolve_installed_version(&app, None));
    crate::version::write_persisted_version(&app, None, &ver);
    crate::tray::refresh_tray_tooltip(&app);
    let _ = crate::tray::refresh_tray_menu(&app);
    Ok(ver)
}

#[tauri::command]
pub fn cmd_write_update_staging_file(file_name: String, bytes: Vec<u8>) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        if !cfg!(debug_assertions) {
            return Err("Direct WebView staging writes are disabled in production; use verified OTA staging".to_string());
        }
        crate::ota::verify_pe_x64_header(&bytes)?;

        let trimmed = file_name.trim();
        let is_safe_name = !trimmed.is_empty()
            && !trimmed.contains('/')
            && !trimmed.contains('\\')
            && !trimmed.contains(':')
            && !trimmed.contains("..")
            && std::path::Path::new(trimmed).components().count() == 1;
        if !is_safe_name {
            return Err("Invalid staging file name".to_string());
        }
        let temp_dir = std::env::temp_dir().join("com.downex.manager");
        let _ = std::fs::create_dir_all(&temp_dir);
        let target_file = temp_dir.join(trimmed);
        let part_file = temp_dir.join(format!("{}.part", trimmed));

        // 1. Write to temporary .part file first
        {
            let mut file = std::fs::File::create(&part_file)
                .map_err(|e| format!("Could not create staging part file: {}", e))?;
            file.write_all(&bytes)
                .map_err(|e| format!("Could not write staging file: {}", e))?;
            file.flush()
                .map_err(|e| format!("Could not flush staging file: {}", e))?;
        }

        // 2. Atomic swap to final staged filename
        if target_file.exists() {
            let _ = std::fs::remove_file(&target_file);
        }
        std::fs::rename(&part_file, &target_file)
            .map_err(|e| format!("Could not finalize staging file: {}", e))?;

        Ok(target_file.to_string_lossy().to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (file_name, bytes);
        Err("In-process staging is supported on Windows".to_string())
    }
}

#[tauri::command]
pub fn cmd_get_staged_update(target_version: String) -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        let clean_ver = target_version.trim().trim_start_matches('v');
        if clean_ver.is_empty() || !clean_ver.chars().all(|c| c.is_ascii_digit() || c == '.') {
            return Ok(None);
        }
        if crate::ota::is_version_quarantined(clean_ver) {
            return Ok(None);
        }
        let temp_dir = std::env::temp_dir().join("com.downex.manager");
        let target_file = temp_dir.join(format!("downex-v{}.staged.exe", clean_ver));
        if target_file.exists() && crate::ota::verify_pe_x64_file(&target_file).is_ok() {
            return Ok(Some(target_file.to_string_lossy().to_string()));
        }
        Ok(None)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = target_version;
        Ok(None)
    }
}

#[tauri::command]
pub fn cmd_verify_update_signature(
    container_bytes: Vec<u8>,
    signature: String,
) -> Result<bool, String> {
    crate::ota::verify_minisign_signature(&container_bytes, &signature)
        .map(|_| true)
}

#[tauri::command]
pub fn cmd_apply_in_process_update(
    app: AppHandle,
    binary_bytes: Option<Vec<u8>>,
    staging_path: Option<String>,
    target_version: Option<String>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // 1. Fail-safe protection: Never apply update while downloads are in progress!
        if let Some(state) = app.try_state::<crate::AppState>() {
            if state.queue_manager.has_active_downloads() {
                return Err("Cannot apply update and restart while downloads are in progress. Please wait for downloads to complete or pause them first.".to_string());
            }
        }

        // 2. Atomic guard so we never attempt duplicate swap
        static UPDATE_APPLIED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
        if UPDATE_APPLIED.swap(true, std::sync::atomic::Ordering::SeqCst) {
            eprintln!("[Downex OTA] Update swap already in progress or completed, ignoring duplicate call");
            return Ok(());
        }

        let effective_staging_path = staging_path.clone().or_else(|| {
            let temp_dir = std::env::temp_dir().join("com.downex.manager");
            if let Ok(entries) = std::fs::read_dir(&temp_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        if name.starts_with("downex-v") && name.ends_with(".staged.exe") {
                            return Some(path.to_string_lossy().to_string());
                        }
                    }
                }
            }
            None
        });

        let bytes = if let Some(b) = binary_bytes {
            if !cfg!(debug_assertions) {
                UPDATE_APPLIED.store(false, std::sync::atomic::Ordering::SeqCst);
                return Err("Raw byte swaps are disabled in production; use verified staging".to_string());
            }
            b
        } else if let Some(ref path_str) = effective_staging_path {
            let temp_dir = std::env::temp_dir().join("com.downex.manager");
            let canon_temp = std::fs::canonicalize(&temp_dir).unwrap_or(temp_dir);
            let canon_path = match std::fs::canonicalize(path_str) {
                Ok(p) if p.starts_with(&canon_temp) => p,
                _ => {
                    UPDATE_APPLIED.store(false, std::sync::atomic::Ordering::SeqCst);
                    return Err("Staging path must reside within Downex temp directory".to_string());
                }
            };
            match std::fs::read(&canon_path) {
                Ok(b) => b,
                Err(e) => {
                    UPDATE_APPLIED.store(false, std::sync::atomic::Ordering::SeqCst);
                    return Err(format!("Could not read staged binary from '{}': {}", path_str, e));
                }
            }
        } else {
            UPDATE_APPLIED.store(false, std::sync::atomic::Ordering::SeqCst);
            return Err("Neither binary_bytes nor staging_path was provided".to_string());
        };

        // 3. Sanity check: payload must be > 512KB and valid PE x86_64 executable
        if let Err(err) = crate::ota::verify_pe_x64_header(&bytes) {
            UPDATE_APPLIED.store(false, std::sync::atomic::Ordering::SeqCst);
            return Err(err);
        }

        let clean_ver = target_version
            .as_deref()
            .map(|v| v.trim().trim_start_matches('v').to_string())
            .unwrap_or_else(|| "0.0.1".to_string());

        // 4. Development Mode (1:1 ScheduleMe Dev Lifecycle):
        // In dev mode (debug_assertions), signal supervisor via update_restart.flag and exit cleanly.
        #[cfg(debug_assertions)]
        {
            crate::version::write_persisted_version(&app, None, &clean_ver);
            sync_windows_installed_version(&clean_ver);

            let temp_dir = std::env::temp_dir().join("com.downex.manager");
            let _ = std::fs::create_dir_all(&temp_dir);
            let _ = std::fs::write(temp_dir.join("update_restart.flag"), clean_ver.as_bytes());

            if let Ok(app_data) = app.path().app_data_dir() {
                let _ = std::fs::create_dir_all(&app_data);
                let _ = std::fs::write(app_data.join("update_restart.flag"), clean_ver.as_bytes());
            }

            if let Some(ref p) = effective_staging_path {
                let _ = std::fs::remove_file(p);
            }

            eprintln!("[Downex OTA Dev] Dev update applied (v{}). Closing windows for supervisor restart.", clean_ver);

            for (_label, window) in app.webview_windows() {
                let _ = window.destroy();
            }

            let app_clone = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(150));
                app_clone.exit(0);
            });
            return Ok(());
        }

        // 6. Production Mode (ScheduleMe 1:1 In-Process Atomic NTFS Swap + Direct Detached Spawn)
        #[cfg(not(debug_assertions))]
        {
            let current_exe = match std::env::current_exe() {
                Ok(p) => p,
                Err(e) => {
                    UPDATE_APPLIED.store(false, std::sync::atomic::Ordering::SeqCst);
                    return Err(format!("Could not resolve current executable path: {}", e));
                }
            };

            let parent_dir = match current_exe.parent() {
                Some(p) => p.to_path_buf(),
                None => {
                    UPDATE_APPLIED.store(false, std::sync::atomic::Ordering::SeqCst);
                    return Err("Could not resolve executable directory".to_string());
                }
            };

            let file_name = match current_exe.file_name() {
                Some(n) => n.to_string_lossy().to_string(),
                None => {
                    UPDATE_APPLIED.store(false, std::sync::atomic::Ordering::SeqCst);
                    return Err("Could not determine executable name".to_string());
                }
            };

            let old_exe = parent_dir.join(format!("{}.old", file_name));
            let new_exe = parent_dir.join(format!("{}.new", file_name));
            let _ = std::fs::remove_file(&old_exe);
            let _ = std::fs::remove_file(&new_exe);

            // Write new verified binary to .new in same directory
            if let Err(e) = (|| -> Result<(), std::io::Error> {
                let mut file = std::fs::File::create(&new_exe)?;
                file.write_all(&bytes)?;
                file.flush()?;
                Ok(())
            })() {
                UPDATE_APPLIED.store(false, std::sync::atomic::Ordering::SeqCst);
                return Err(format!("Failed writing replacement executable: {}", e));
            }

            // Atomic rename: current -> old, new -> current
            let mut moved_old_path: Option<std::path::PathBuf> = None;
            if current_exe.exists() {
                if std::fs::rename(&current_exe, &old_exe).is_ok() {
                    moved_old_path = Some(old_exe.clone());
                } else {
                    let fallback = parent_dir.join(format!("{}.{}.old", file_name, std::process::id()));
                    let _ = std::fs::remove_file(&fallback);
                    if let Err(e) = std::fs::rename(&current_exe, &fallback) {
                        let _ = std::fs::remove_file(&new_exe);
                        UPDATE_APPLIED.store(false, std::sync::atomic::Ordering::SeqCst);
                        return Err(format!("Could not rename active executable aside: {}", e));
                    }
                    moved_old_path = Some(fallback);
                }
            }

            if let Err(e) = std::fs::rename(&new_exe, &current_exe) {
                if let Some(ref old_p) = moved_old_path {
                    let _ = std::fs::rename(old_p, &current_exe);
                }
                let _ = std::fs::remove_file(&new_exe);
                UPDATE_APPLIED.store(false, std::sync::atomic::Ordering::SeqCst);
                return Err(format!("Could not swap updated executable into place: {}", e));
            }

            // Clean staging file
            if let Some(ref p) = effective_staging_path {
                let _ = std::fs::remove_file(p);
            }

            eprintln!("[Downex OTA] NTFS atomic file swap complete. Spawning updated executable directly...");

            let was_main_open = app
                .get_webview_window("main")
                .map(|w| w.is_visible().unwrap_or(true))
                .unwrap_or(true);

            // Spawn updated application with direct parent PID handoff (ScheduleMe 1:1)
            let mut cmd = std::process::Command::new(&current_exe);
            cmd.arg("--update-restart")
                .arg("--restarted")
                .arg(format!("--parent-pid={}", std::process::id()))
                .arg(if was_main_open { "--show" } else { "--autostart" });
            cmd.current_dir(&parent_dir);
            cmd.stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null());

            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000 | 0x00000008); // CREATE_NO_WINDOW | DETACHED_PROCESS

            if let Err(e) = cmd.spawn() {
                eprintln!("[Downex OTA] Direct process spawn failed: {}. Attempting rollback...", e);
                if let Some(ref old_p) = moved_old_path {
                    let _ = std::fs::remove_file(&current_exe);
                    let _ = std::fs::rename(old_p, &current_exe);
                }
                UPDATE_APPLIED.store(false, std::sync::atomic::Ordering::SeqCst);
                return Err(format!("Could not spawn updated application: {}", e));
            }

            // Persist version ground-truth only after binary swap and spawn both succeed
            if let Some(state) = app.try_state::<crate::AppState>() {
                crate::version::write_persisted_version(&app, Some(&state.db), &clean_ver);
            } else {
                crate::version::write_persisted_version(&app, None, &clean_ver);
            }
            sync_windows_installed_version(&clean_ver);

            crate::tray::clean_all_task_trays(&app);
            let _ = app.remove_tray_by_id("main-tray");
            crate::tray::sweep_windows_zombie_tray_icons_force();

            for (_label, window) in app.webview_windows() {
                let _ = window.destroy();
            }

            let app_clone = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(150));
                app_clone.exit(0);
            });

            Ok(())
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, binary_bytes, staging_path, target_version);
        Err("In-process atomic swap is supported on Windows".to_string())
    }
}

pub fn cleanup_old_swap_files() {
    #[cfg(target_os = "windows")]
    {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                if let Ok(entries) = std::fs::read_dir(dir) {
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name.ends_with(".old")
                            || name.ends_with(".new")
                            || name.ends_with(".tmp")
                            || name.ends_with(".rollback.tmp")
                            || name.contains(".failed.")
                        {
                            let _ = std::fs::remove_file(entry.path());
                        }
                    }
                }
            }
        }

        let temp_dir = std::env::temp_dir().join("com.downex.manager");
        if let Ok(entries) = std::fs::read_dir(&temp_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(".staged.exe")
                    || name.ends_with(".staged.exe.part")
                    || name.ends_with(".part")
                    || (name.starts_with("watchdog_") && name.ends_with(".ps1"))
                    || (name.starts_with("reset_base_") && name.ends_with(".ps1"))
                {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }
}

pub fn clean_temp_staging_artifacts() -> bool {
    #[cfg(target_os = "windows")]
    {
        let mut cleaned = false;
        let temp_dir = std::env::temp_dir().join("com.downex.manager");
        if temp_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&temp_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let name = path.file_name().unwrap_or_default().to_string_lossy();
                    let is_stale_staged = name.contains(".staged.exe")
                        && entry
                            .metadata()
                            .ok()
                            .and_then(|m| m.modified().ok())
                            .and_then(|t| t.elapsed().ok())
                            .map(|age| age.as_secs() > 86_400)
                            .unwrap_or(false);
                    if (name.starts_with("watchdog_") && name.ends_with(".ps1"))
                        || (name.starts_with("reset_base_") && name.ends_with(".ps1"))
                        || (name.starts_with("remote_task_") && name.ends_with(".ps1"))
                        || (name.starts_with("repair_") && name.ends_with(".ps1"))
                        || name.ends_with(".part")
                        || name.ends_with(".flag")
                        || name.starts_with("downex_update_")
                        || is_stale_staged
                    {
                        let _ = std::fs::remove_file(&path);
                        cleaned = true;
                    }
                }
            }
        }
        cleaned
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

#[tauri::command]
pub fn cmd_clean_superseded_old_binaries() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let mut cleaned = false;
        // 1. Clean superseded .exe.old
        if let Ok(current_exe) = std::env::current_exe() {
            if let Some(parent) = current_exe.parent() {
                if let Some(file_name) = current_exe.file_name() {
                    let old_exe = parent.join(format!("{}.old", file_name.to_string_lossy()));
                    if old_exe.exists() {
                        let _ = std::fs::remove_file(old_exe);
                        cleaned = true;
                    }
                }
            }
        }

        // 2. Clean temporary staging directory artifacts (watchdog scripts, leftover part files)
        let temp_dir = std::env::temp_dir().join("com.downex.manager");
        if temp_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&temp_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let name = path.file_name().unwrap_or_default().to_string_lossy();
                    if name.starts_with("watchdog_") && name.ends_with(".ps1") {
                        let _ = std::fs::remove_file(&path);
                    } else if name.ends_with(".part") {
                        let _ = std::fs::remove_file(&path);
                    }
                }
            }
        }

        Ok(cleaned)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

#[cfg(target_os = "windows")]
pub fn set_process_priority_background(background: bool) {
    unsafe {
        extern "system" {
            fn GetCurrentProcess() -> *mut std::ffi::c_void;
            fn SetPriorityClass(hProcess: *mut std::ffi::c_void, dwPriorityClass: u32) -> i32;
        }
        // BELOW_NORMAL_PRIORITY_CLASS = 0x00004000 (yields CPU to DWM, games & foreground apps)
        // NORMAL_PRIORITY_CLASS = 0x00000020 (full interactive responsiveness when UI is active)
        let priority = if background { 0x00004000 } else { 0x00000020 };
        let _ = SetPriorityClass(GetCurrentProcess(), priority);
    }
}

#[cfg(not(target_os = "windows"))]
pub fn set_process_priority_background(_background: bool) {}

#[cfg(target_os = "windows")]
pub fn trim_process_working_set() {
    unsafe {
        extern "system" {
            fn GetCurrentProcess() -> *mut std::ffi::c_void;
            fn SetProcessWorkingSetSize(
                hProcess: *mut std::ffi::c_void,
                dwMinimumWorkingSetSize: usize,
                dwMaximumWorkingSetSize: usize,
            ) -> i32;
        }
        // (usize::MAX, usize::MAX) instructs the Windows Virtual Memory Manager
        // to immediately reclaim all unused private working set pages, drastically reducing RAM footprint
        let _ = SetProcessWorkingSetSize(GetCurrentProcess(), usize::MAX, usize::MAX);
    }
}

#[cfg(not(target_os = "windows"))]
pub fn trim_process_working_set() {}

#[cfg(target_os = "windows")]
pub fn refresh_windows_shell_icon_cache() {
    unsafe {
        windows_sys::Win32::UI::Shell::SHChangeNotify(
            windows_sys::Win32::UI::Shell::SHCNE_ASSOCCHANGED as i32,
            windows_sys::Win32::UI::Shell::SHCNF_IDLIST,
            std::ptr::null(),
            std::ptr::null(),
        );
    }
}

#[cfg(not(target_os = "windows"))]
pub fn refresh_windows_shell_icon_cache() {}

#[cfg(target_os = "windows")]
pub fn touch_user_shortcuts() {
    if let Ok(app_data) = std::env::var("APPDATA") {
        let start_menu_sc = std::path::PathBuf::from(&app_data)
            .join("Microsoft\\Windows\\Start Menu\\Programs\\Downex.lnk");
        if start_menu_sc.exists() {
            let _ = std::fs::OpenOptions::new()
                .write(true)
                .open(&start_menu_sc)
                .and_then(|f| f.set_modified(std::time::SystemTime::now()));
        }
        let pinned_sc = std::path::PathBuf::from(&app_data)
            .join("Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar\\Downex.lnk");
        if pinned_sc.exists() {
            let _ = std::fs::OpenOptions::new()
                .write(true)
                .open(&pinned_sc)
                .and_then(|f| f.set_modified(std::time::SystemTime::now()));
        }
    }
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        let desktop_sc = std::path::PathBuf::from(&user_profile)
            .join("Desktop\\Downex.lnk");
        if desktop_sc.exists() {
            let _ = std::fs::OpenOptions::new()
                .write(true)
                .open(&desktop_sc)
                .and_then(|f| f.set_modified(std::time::SystemTime::now()));
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn touch_user_shortcuts() {}

#[tauri::command]
pub fn cmd_refresh_shell_icons() -> Result<(), String> {
    touch_user_shortcuts();
    refresh_windows_shell_icon_cache();
    Ok(())
}

#[tauri::command]
pub fn cmd_notify_dom_ready(app: AppHandle) {
    crate::ota::mark_ui_dom_ready();
    static SHELL_REFRESHED_ON_READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    static ROLLBACK_EVENT_DELIVERED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

    let args: Vec<String> = std::env::args().collect();
    let is_background_boot = args.iter().any(|arg| {
        arg == "--background" || arg == "--silent" || arg == "--minimized" || arg == "--autostart" || arg == "-b"
    });
    let is_rollback_recovery = args.iter().any(|arg| arg == "--rollback-recovery" || arg == "--rolled-back");

    if is_rollback_recovery && !ROLLBACK_EVENT_DELIVERED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        let current_exe = std::env::current_exe().unwrap_or_default();
        let actual_ver = crate::version::extract_pe_version(&current_exe)
            .unwrap_or_else(|| app.package_info().version.to_string());
        let _ = app.emit("ota-rollback-recovered", serde_json::json!({ "version": actual_ver }));
    }

    if !is_background_boot {
        if let Some(w) = app.get_webview_window("main") {
            if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../../icons/128x128.png")) {
                let _ = w.set_icon(icon);
            }
            let _ = w.set_always_on_top(false);
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
            #[cfg(target_os = "windows")]
            {
                use windows_sys::Win32::UI::WindowsAndMessaging::{SetWindowPos, HWND_NOTOPMOST, HWND_TOP, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW};
                if let Ok(h) = w.hwnd() {
                    let hwnd_val = h.0 as _;
                    unsafe {
                        SetWindowPos(hwnd_val, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
                        SetWindowPos(hwnd_val, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
                    }
                }
            }
        }
        #[cfg(target_os = "windows")]
        {
            if !crate::system_profile::should_force_background_priority() {
                set_process_priority_background(false);
            }
            if !SHELL_REFRESHED_ON_READY.swap(true, std::sync::atomic::Ordering::SeqCst) {
                let is_update_handoff = args.iter().any(|a| {
                    a == "--update-restart" || a == "--restarted" || a == "--restarted-after-update" || a == "--rolled-back"
                });
                if is_update_handoff {
                    touch_user_shortcuts();
                    refresh_windows_shell_icon_cache();
                }
            }
        }
    } else {
        #[cfg(target_os = "windows")]
        {
            set_process_priority_background(true);
            trim_process_working_set();
        }
    }
}

#[tauri::command]
pub async fn cmd_minimize_to_background(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| e.to_string())?;
        #[cfg(target_os = "windows")]
        {
            set_process_priority_background(true);
            trim_process_working_set();
        }
        let _ = crate::tray::sync_download_task_tray(&app);
        let _ = crate::tray::refresh_tray_menu(&app);
    }
    Ok(())
}

#[tauri::command]
pub fn cmd_quit_app(app: AppHandle) {
    crate::tray::clean_all_task_trays(&app);
    let _ = app.remove_tray_by_id("main-tray");
    #[cfg(target_os = "windows")]
    crate::tray::sweep_windows_zombie_tray_icons_force();
    app.exit(0);
}

#[tauri::command]
pub fn cmd_set_tray_icon(app: AppHandle, state: String) -> Result<(), String> {
    crate::tray::set_tray_icon_state(&app, &state).map_err(|e| e.to_string())
}

/// Hides a secondary dialog in Normal mode (<10ms warm reuse) or destroys it under constrained profiles.
pub fn dispose_or_hide_secondary_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.set_always_on_top(false);
        let _ = window.hide();
        if crate::system_profile::should_destroy_dialogs_on_close() {
            let _ = window.destroy();
            #[cfg(target_os = "windows")]
            trim_process_working_set();
        } else if label == "download_dialog" {
            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                width: DOWNLOAD_DIALOG_WIDTH,
                height: DOWNLOAD_DIALOG_BASE_HEIGHT,
            }));
        }
    }
}

/// Destroys any secondary dialog currently sitting hidden in memory when pressure escalates.
pub fn reclaim_hidden_secondary_dialogs<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if !crate::system_profile::should_destroy_dialogs_on_close() {
        return;
    }
    let app_clone = app.clone();
    let _ = app.run_on_main_thread(move || {
        let mut reclaimed = false;
        for label in ["download_dialog", "download_complete"] {
            if let Some(window) = app_clone.get_webview_window(label) {
                let is_visible = window.is_visible().unwrap_or(false);
                if !is_visible {
                    let _ = window.set_always_on_top(false);
                    let _ = window.destroy();
                    reclaimed = true;
                }
            }
        }
        #[cfg(target_os = "windows")]
        if reclaimed {
            trim_process_working_set();
        }
    });
}

/// Pre-warms secondary dialog windows (`download_dialog`, `download_complete`) in hidden state
/// so browser extension captures and background completions appear instantaneously (<10ms)
/// as completely isolated standalone windows without surfacing the main window from tray.
pub fn prewarm_secondary_dialogs<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if !crate::system_profile::should_prewarm_dialogs() {
        return;
    }
    if app.get_webview_window("download_dialog").is_none() {
        let builder = tauri::WebviewWindowBuilder::new(
            app,
            "download_dialog",
            tauri::WebviewUrl::default(),
        )
        .title("Downex - Download File Info")
        .inner_size(DOWNLOAD_DIALOG_WIDTH, DOWNLOAD_DIALOG_BASE_HEIGHT)
        .decorations(false)
        .transparent(false)
        .shadow(true)
        .center()
        .resizable(false)
        .always_on_top(false)
        .initialization_script("window.__DOWNEX_WINDOW_LABEL__ = 'download_dialog';")
        .visible(false);

        if let Ok(window) = builder.build() {
            if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../../icons/128x128.png")) {
                let _ = window.set_icon(icon);
            }
        }
    }

    if app.get_webview_window("download_complete").is_none() {
        let builder = tauri::WebviewWindowBuilder::new(
            app,
            "download_complete",
            tauri::WebviewUrl::default(),
        )
        .title("Download complete")
        .inner_size(540.0, 282.0)
        .decorations(false)
        .transparent(false)
        .shadow(true)
        .center()
        .resizable(false)
        .always_on_top(false)
        .initialization_script("window.__DOWNEX_WINDOW_LABEL__ = 'download_complete';")
        .visible(false);

        if let Ok(window) = builder.build() {
            if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../../icons/128x128.png")) {
                let _ = window.set_icon(icon);
            }
        }
    }
}

pub fn show_download_dialog<R: tauri::Runtime>(app: &tauri::AppHandle<R>, payload: Option<serde_json::Value>) {
    if let Some(ref p) = payload {
        let url = p.get("url").and_then(|u| u.as_str()).unwrap_or_default().to_string();
        if !url.is_empty() {
            if let Ok(mut time_lock) = LAST_DIALOG_SHOW_TIME.lock() {
                if let Some((ref last_url, ref instant)) = *time_lock {
                    if last_url == &url && instant.elapsed() < std::time::Duration::from_millis(1500) {
                        if app.get_webview_window("download_dialog").is_some() {
                            let app_clone = app.clone();
                            let _ = app.run_on_main_thread(move || {
                                if let Some(window) = app_clone.get_webview_window("download_dialog") {
                                    let _ = window.unminimize();
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                    #[cfg(target_os = "windows")]
                                    force_window_to_foreground(&window);
                                }
                            });
                        }
                        return;
                    }
                }
                *time_lock = Some((url, std::time::Instant::now()));
            }
        }

        if let Ok(mut lock) = LAST_DOWNLOAD_DIALOG_PAYLOAD.lock() {
            *lock = Some(p.clone());
        }
    }

    let eval_script = payload.as_ref().map(|p| {
        let json_str = serde_json::to_string(p).unwrap_or_default();
        format!(
            "window.__DOWNEX_DIALOG_PAYLOAD__ = {json}; if (typeof window.__onDownexDialogPayload === 'function') {{ window.__onDownexDialogPayload({json}); }}",
            json = json_str
        )
    });

    if app.get_webview_window("download_dialog").is_some() {
        let app_clone = app.clone();
        let payload_clone = payload.clone();
        let eval_clone = eval_script.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(window) = app_clone.get_webview_window("download_dialog") {
                if let Some(ref p) = payload_clone {
                    use tauri::Emitter;
                    let _ = window.emit("open-download-info-modal", p);
                }
                if let Some(ref script) = eval_clone {
                    let _ = window.eval(script);
                }
                if !window.is_visible().unwrap_or(false) {
                    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                        width: DOWNLOAD_DIALOG_WIDTH,
                        height: DOWNLOAD_DIALOG_BASE_HEIGHT,
                    }));
                    let _ = window.center();
                }
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_always_on_top(false);
                let _ = window.set_focus();
                #[cfg(target_os = "windows")]
                force_window_to_foreground(&window);
            }
        });
    } else {
        let app_handle = app.clone();
        let payload_clone = payload.clone();
        let eval_clone = eval_script;
        let _ = app.run_on_main_thread(move || {
            let init_script = match payload_clone.as_ref() {
                Some(p) => format!(
                    "window.__DOWNEX_WINDOW_LABEL__ = 'download_dialog'; window.__DOWNEX_DIALOG_PAYLOAD__ = {};",
                    serde_json::to_string(p).unwrap_or_else(|_| "null".to_string())
                ),
                None => "window.__DOWNEX_WINDOW_LABEL__ = 'download_dialog';".to_string(),
            };
            let builder = tauri::WebviewWindowBuilder::new(
                &app_handle,
                "download_dialog",
                tauri::WebviewUrl::default(),
            )
            .title("Downex - Download File Info")
            .inner_size(DOWNLOAD_DIALOG_WIDTH, DOWNLOAD_DIALOG_BASE_HEIGHT)
            .decorations(false)
            .transparent(false)
            .shadow(true)
            .center()
            .resizable(false)
            .always_on_top(false)
            .initialization_script(&init_script)
            .visible(false);

            match builder.build() {
                Ok(window) => {
                    if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../../icons/128x128.png")) {
                        let _ = window.set_icon(icon);
                    }
                    if let Some(ref p) = payload_clone {
                        use tauri::Emitter;
                        let _ = window.emit("open-download-info-modal", p);
                    }
                    if let Some(ref script) = eval_clone {
                        let _ = window.eval(script);
                    }
                    let _ = window.unminimize();
                    let _ = window.center();
                    let _ = window.show();
                    let _ = window.set_always_on_top(false);
                    let _ = window.set_focus();

                    #[cfg(target_os = "windows")]
                    force_window_to_foreground(&window);
                }
                Err(err) => {
                    eprintln!("[Downex Dialog] Fallback: download_dialog failed to build ({}), emitting to main window...", err);
                    if let Some(main_win) = app_handle.get_webview_window("main") {
                        if let Some(ref p) = payload_clone {
                            use tauri::Emitter;
                            let _ = main_win.emit("open-download-info-modal", p);
                        }
                        let _ = main_win.unminimize();
                        let _ = main_win.show();
                        let _ = main_win.set_focus();
                        #[cfg(target_os = "windows")]
                        force_window_to_foreground(&main_win);
                    }
                }
            }
        });
    }
}

pub(crate) fn should_keep_window_always_on_top(label: &str) -> bool {
    !matches!(label, "main" | "download_complete" | "download_dialog")
}

#[cfg(target_os = "windows")]
pub fn force_window_to_foreground<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow, SetWindowPos, ShowWindow,
        HWND_NOTOPMOST, HWND_TOP, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_RESTORE, SW_SHOW,
    };
    if let Ok(h) = window.hwnd() {
        let hwnd_val = h.0 as _;
        extern "system" {
            fn AttachThreadInput(idAttach: u32, idAttachTo: u32, fAttach: i32) -> i32;
        }

        unsafe {
            let foreground_hwnd = GetForegroundWindow();
            let current_thread_id = windows_sys::Win32::System::Threading::GetCurrentThreadId();
            let foreground_thread_id = if !foreground_hwnd.is_null() {
                GetWindowThreadProcessId(foreground_hwnd, std::ptr::null_mut())
            } else {
                0
            };

            let attached = if foreground_thread_id != 0 && foreground_thread_id != current_thread_id {
                AttachThreadInput(foreground_thread_id, current_thread_id, 1) != 0
            } else {
                false
            };

            ShowWindow(hwnd_val, SW_RESTORE);
            ShowWindow(hwnd_val, SW_SHOW);
            if !should_keep_window_always_on_top(window.label()) {
                // Non-pinned windows (main, download_complete, download_dialog) must NEVER remain permanently
                // WS_EX_TOPMOST: briefly pulse to top then immediately drop to HWND_NOTOPMOST + HWND_TOP so other
                // apps naturally come in front and the modal loses focus when clicking elsewhere.
                SetWindowPos(hwnd_val, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                SetWindowPos(hwnd_val, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
                SetWindowPos(hwnd_val, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
            } else {
                SetWindowPos(hwnd_val, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
            }
            BringWindowToTop(hwnd_val);
            SetForegroundWindow(hwnd_val);

            if attached {
                AttachThreadInput(foreground_thread_id, current_thread_id, 0);
            }
        }
    }
}

/// Displays secondary notification windows (like download_complete) without stealing keyboard focus
/// from active user applications (e.g. text inputs, browsers, word processors).
#[cfg(target_os = "windows")]
pub fn show_window_without_stealing_focus<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        SWP_SHOWWINDOW, SW_SHOWNOACTIVATE,
    };
    if let Ok(h) = window.hwnd() {
        let hwnd_val = h.0 as _;

        unsafe {
            ShowWindow(hwnd_val, SW_SHOWNOACTIVATE);
            SetWindowPos(
                hwnd_val,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
        }
    } else {
        let _ = window.show();
    }
}

#[cfg(not(target_os = "windows"))]
pub fn show_window_without_stealing_focus<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let _ = window.show();
}

#[tauri::command]
pub fn cmd_get_download_dialog_payload() -> Option<serde_json::Value> {
    LAST_DOWNLOAD_DIALOG_PAYLOAD.lock().ok().and_then(|g| g.clone())
}

#[tauri::command]
pub fn cmd_show_download_dialog(app: AppHandle, payload: Option<serde_json::Value>) -> Result<(), String> {
    show_download_dialog(&app, payload);
    Ok(())
}

fn compute_centered_clamped_position(
    cur_pos: (i32, i32),
    cur_size: (i32, i32),
    target_size: (i32, i32),
    monitor_bounds: Option<(i32, i32, i32, i32)>,
    scale: f64,
) -> (i32, i32) {
    let mut next_x = cur_pos.0 + (cur_size.0 - target_size.0) / 2;
    let mut next_y = cur_pos.1 + (cur_size.1 - target_size.1) / 2;

    if let Some((mon_x, mon_y, mon_w, mon_h)) = monitor_bounds {
        let margin = (12.0 * scale).round() as i32;
        let taskbar_margin = (48.0 * scale).round() as i32;
        let min_x = mon_x + margin;
        let min_y = mon_y + margin;
        let max_x = (mon_x + mon_w - target_size.0 - margin).max(min_x);
        let max_y = (mon_y + mon_h - target_size.1 - taskbar_margin).max(min_y);
        next_x = next_x.clamp(min_x, max_x);
        next_y = next_y.clamp(min_y, max_y);
    }

    (next_x, next_y)
}

#[tauri::command]
pub fn cmd_set_download_dialog_expanded(
    app: AppHandle,
    expanded: bool,
    base_height: Option<f64>,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("download_dialog") {
        let target_w: f64 = DOWNLOAD_DIALOG_WIDTH;
        let resolved_base = base_height
            .filter(|h| h.is_finite() && *h >= 300.0 && *h <= 460.0)
            .unwrap_or(DOWNLOAD_DIALOG_BASE_HEIGHT);
        let target_h: f64 = if expanded {
            DOWNLOAD_DIALOG_EXPANDED_HEIGHT
        } else {
            resolved_base
        };
        let scale = window.scale_factor().unwrap_or(1.0);
        let target_phys_w = (target_w * scale).round() as i32;
        let target_phys_h = (target_h * scale).round() as i32;

        let prev_pos = window.outer_position().ok();
        let prev_size = window.outer_size().ok();

        if let Some(sz) = prev_size {
            if (sz.width as i32 - target_phys_w).abs() <= 2
                && (sz.height as i32 - target_phys_h).abs() <= 2
            {
                return Ok(());
            }
        }

        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: target_w,
            height: target_h,
        }));

        if let (Some(pos), Some(sz)) = (prev_pos, prev_size) {
            if window.is_visible().unwrap_or(false) {
                let monitor_bounds = window.current_monitor().ok().flatten().map(|m| {
                    let mp = m.position();
                    let ms = m.size();
                    (mp.x, mp.y, ms.width as i32, ms.height as i32)
                });
                let (next_x, next_y) = compute_centered_clamped_position(
                    (pos.x, pos.y),
                    (sz.width as i32, sz.height as i32),
                    (target_phys_w, target_phys_h),
                    monitor_bounds,
                    scale,
                );
                let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                    x: next_x,
                    y: next_y,
                }));
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn cmd_close_download_dialog(app: AppHandle) -> Result<(), String> {
    if let Ok(mut lock) = LAST_DOWNLOAD_DIALOG_PAYLOAD.lock() {
        *lock = None;
    }
    dispose_or_hide_secondary_window(&app, "download_dialog");
    Ok(())
}

#[tauri::command]
pub fn cmd_get_disk_free_space(path: String) -> Result<u64, String> {
    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        let mut free_bytes_available: u64 = 0;
        let mut total_bytes: u64 = 0;
        let mut total_free_bytes: u64 = 0;

        let clean_path = path.trim().replace('/', "\\");
        let mut probe = std::path::PathBuf::from(&clean_path);
        while !probe.exists() {
            match probe.parent() {
                Some(p) if !p.as_os_str().is_empty() => probe = p.to_path_buf(),
                _ => break,
            }
        }
        let target_str = probe.to_string_lossy().to_string();
        let query_path = if target_str.is_empty() { clean_path } else { target_str };
        let mut wide: Vec<u16> = OsStr::new(&query_path).encode_wide().collect();
        wide.push(0);

        unsafe {
            let res = windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut free_bytes_available,
                &mut total_bytes,
                &mut total_free_bytes,
            );
            if res != 0 {
                return Ok(free_bytes_available);
            }
        }
    }
    Ok(0)
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct DiskVolumeInfo {
    pub letter: String,
    pub path: String,
    pub free_bytes: u64,
    pub total_bytes: u64,
    pub is_default: bool,
}

#[tauri::command]
pub fn cmd_get_available_disks() -> Result<Vec<DiskVolumeInfo>, String> {
    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        let mut volumes = Vec::new();
        unsafe {
            let drives_mask = windows_sys::Win32::Storage::FileSystem::GetLogicalDrives();
            for i in 0..26 {
                if (drives_mask & (1 << i)) != 0 {
                    let letter = (b'A' + i) as char;
                    let path = format!("{}:\\", letter);
                    let mut wide: Vec<u16> = OsStr::new(&path).encode_wide().collect();
                    wide.push(0);
                    let mut free_bytes_available: u64 = 0;
                    let mut total_bytes: u64 = 0;
                    let mut total_free_bytes: u64 = 0;

                    let res = windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
                        wide.as_ptr(),
                        &mut free_bytes_available,
                        &mut total_bytes,
                        &mut total_free_bytes,
                    );
                    if res != 0 && total_bytes > 0 {
                        volumes.push(DiskVolumeInfo {
                            letter: letter.to_string(),
                            path: path.clone(),
                            free_bytes: free_bytes_available,
                            total_bytes,
                            is_default: letter == 'C',
                        });
                    }
                }
            }
        }
        return Ok(volumes);
    }
    #[allow(unreachable_code)]
    Ok(Vec::new())
}

pub(crate) fn resolve_restore_target_view(target_view: Option<&str>) -> Option<String> {
    let view = target_view?.trim();
    if matches!(
        view,
        "all" | "queues" | "telemetry" | "settings" | "speedtest" | "trash" | "active" | "completed"
    ) {
        Some(view.to_string())
    } else {
        None
    }
}

#[tauri::command]
pub fn cmd_restore_manager_window(app: AppHandle, target_view: Option<String>) -> Result<(), String> {
    let normalized_view = resolve_restore_target_view(target_view.as_deref());
    if let Some(ref view) = normalized_view {
        if let Ok(mut guard) = RUNTIME_ACTIVE_TAB.lock() {
            *guard = Some(view.clone());
        }
    }

    let window = if let Some(w) = app.get_webview_window("main") {
        w
    } else {
        crate::tray::create_or_show_main_window(&app).map_err(|e| e.to_string())?
    };

    if let Some(ref view) = normalized_view {
        let _ = app.emit("downex-navigate", view.as_str());
        if let Ok(view_json) = serde_json::to_string(view) {
            let _ = window.eval(&format!(
                "try {{ sessionStorage.setItem('downex_session_selected_view', {view_json}); }} catch(e) {{}}",
            ));
        }
    }

    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    let _ = crate::tray::refresh_tray_menu(&app);
    let _ = app.emit("refresh-downloads", ());
    let _ = app.emit("downex-ui-opened", ());
    Ok(())
}

#[tauri::command]
pub fn cmd_hide_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
        let _ = crate::tray::sync_download_task_tray(&app);
        let _ = crate::tray::refresh_tray_menu(&app);
    }
    Ok(())
}

pub(crate) fn ensure_file_ready_to_open(path: &str, db: &crate::db::DatabaseManager) -> Result<String, String> {
    use std::path::{Component, Path};
    let clean_path = path.trim().replace('/', "\\");
    if clean_path.is_empty()
        || clean_path.contains('\0')
        || clean_path.contains('"')
        || clean_path.starts_with("\\\\.\\")
        || clean_path.starts_with("\\\\?\\")
    {
        return Err("Invalid characters in file path".to_string());
    }
    let target_path = Path::new(&clean_path);
    if !target_path.is_absolute() {
        return Err("Path must be an absolute path".to_string());
    }
    if target_path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("Relative path traversal segments are not permitted".to_string());
    }

    if crate::engine::staging::is_unconfirmed_staging_path(target_path) {
        return Err("Download is still unconfirmed (.downex). Wait until it completes before opening.".to_string());
    }

    let io_target = crate::engine::staging::to_win_io_path(target_path);
    let canon_target = std::fs::canonicalize(&io_target).ok();
    let normalized_req = clean_path.to_lowercase();
    let mut matched_completed = false;
    if let Ok(downloads) = db.get_all_downloads() {
        if let Some(rec) = downloads.into_iter().find(|d| {
            let dest_clean = d.destination_path.trim().replace('/', "\\");
            let dest_matches = dest_clean.to_lowercase() == normalized_req
                || canon_target
                    .as_ref()
                    .and_then(|ct| {
                        let dest_io = crate::engine::staging::to_win_io_path(Path::new(&dest_clean));
                        std::fs::canonicalize(&dest_io).ok().map(|cd| cd == *ct)
                    })
                    .unwrap_or(false);
            let staging_matches = d.staging_path
                .as_deref()
                .map(|s| s.trim().replace('/', "\\").to_lowercase() == normalized_req)
                .unwrap_or(false);
            dest_matches || staging_matches
        }) {
            if rec.status != "completed" {
                return Err(format!(
                    "Download '{}' is still {} (unconfirmed). Wait for completion before opening.",
                    rec.filename, rec.status
                ));
            }
            matched_completed = true;
        }
    }

    if !matched_completed {
        if clean_path.starts_with("\\\\") {
            return Err("Opening unverified UNC network paths is not permitted".to_string());
        }
        let user_dl_canon = std::env::var("USERPROFILE")
            .ok()
            .map(|u| std::path::PathBuf::from(u).join("Downloads"))
            .and_then(|p| std::fs::canonicalize(crate::engine::staging::to_win_io_path(&p)).ok());
        match (user_dl_canon, canon_target.as_ref()) {
            (Some(base), Some(target)) if target.starts_with(&base) => {}
            _ => {
                return Err("Opening arbitrary paths outside completed downloads is not permitted".to_string());
            }
        }
    }

    if !io_target.is_file() {
        return Err(format!("Downloaded file is not available on disk yet: {}", clean_path));
    }

    Ok(canon_target
        .map(|p| {
            let s = p.to_string_lossy().to_string();
            if let Some(unc_rest) = s.strip_prefix("\\\\?\\UNC\\") {
                format!("\\\\{}", unc_rest)
            } else if s.len() < 259 {
                s.trim_start_matches("\\\\?\\").to_string()
            } else {
                s
            }
        })
        .unwrap_or(clean_path))
}

#[tauri::command]
pub fn cmd_open_file(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let clean_path = ensure_file_ready_to_open(&path, &state.db)?;
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        let op: Vec<u16> = "open\0".encode_utf16().collect();
        let file: Vec<u16> = std::ffi::OsStr::new(&clean_path)
            .encode_wide()
            .chain(Some(0))
            .collect();
        let res = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                op.as_ptr(),
                file.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            )
        };
        if (res as usize) <= 32 {
            return Err(format!("Failed to open file (ShellExecuteW code {})", res as usize));
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = opener::open(&clean_path);
    }
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum FolderRevealTarget {
    SelectFile(String),
    OpenDir(String),
}

fn sanitize_win_reveal_path(path: &str) -> Result<String, String> {
    use std::path::{Component, Path};

    let trimmed = path.trim().replace('/', "\\");
    let stripped = if let Some(unc_rest) = trimmed.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{}", unc_rest)
    } else if let Some(rest) = trimmed.strip_prefix("\\\\?\\") {
        rest.to_string()
    } else {
        trimmed
    };

    if stripped.is_empty()
        || stripped.contains('"')
        || stripped.contains('\0')
        || stripped.contains('\r')
        || stripped.contains('\n')
        || stripped.starts_with("\\\\.\\")
    {
        return Err("Invalid folder path".to_string());
    }

    let path_obj = Path::new(&stripped);
    if !path_obj.is_absolute() {
        return Err("Path must be an absolute path".to_string());
    }
    if path_obj.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("Relative path traversal segments are not permitted".to_string());
    }
    Ok(stripped)
}

fn canonical_display_win_path(path: &std::path::Path, fallback: &str) -> String {
    let io = crate::engine::staging::to_win_io_path(path);
    if let Ok(canon) = std::fs::canonicalize(&io) {
        let s = canon.to_string_lossy().to_string();
        if let Some(unc_rest) = s.strip_prefix("\\\\?\\UNC\\") {
            return format!("\\\\{}", unc_rest);
        }
        if s.len() < 259 {
            return s.trim_start_matches("\\\\?\\").to_string();
        }
        return s;
    }
    fallback.to_string()
}

pub(crate) fn resolve_folder_reveal_target(
    raw_path: &str,
    db: &crate::db::DatabaseManager,
) -> Result<FolderRevealTarget, String> {
    use std::path::Path;

    let clean_path = sanitize_win_reveal_path(raw_path)?;
    let path_obj = Path::new(&clean_path);
    let normalized_req = clean_path.to_lowercase();

    let matched_record = db
        .get_all_downloads()
        .ok()
        .and_then(|list| {
            list.into_iter().find(|d| {
                d.destination_path.trim().replace('/', "\\").to_lowercase() == normalized_req
                    || d.staging_path
                        .as_deref()
                        .map(|s| s.trim().replace('/', "\\").to_lowercase() == normalized_req)
                        .unwrap_or(false)
            })
        });

    if clean_path.starts_with("\\\\") && matched_record.is_none() {
        return Err("Opening unverified UNC network paths is not permitted".to_string());
    }

    let io_target = crate::engine::staging::to_win_io_path(path_obj);
    if io_target.is_file() {
        return Ok(FolderRevealTarget::SelectFile(canonical_display_win_path(
            path_obj,
            &clean_path,
        )));
    }

    let db_staging = matched_record.and_then(|d| d.staging_path);
    let active_staging = db_staging
        .map(std::path::PathBuf::from)
        .filter(|p| crate::engine::staging::to_win_io_path(p).is_file())
        .or_else(|| {
            let derived = crate::engine::staging::derive_primary_unconfirmed_path(path_obj);
            if crate::engine::staging::to_win_io_path(&derived).is_file() {
                Some(derived)
            } else {
                None
            }
        });

    if let Some(staging_file) = active_staging {
        let staging_str = staging_file
            .to_string_lossy()
            .replace(['/', '"', '\r', '\n', '\0'], "\\");
        return Ok(FolderRevealTarget::SelectFile(canonical_display_win_path(
            &staging_file,
            &staging_str,
        )));
    }

    if io_target.is_dir() {
        return Ok(FolderRevealTarget::OpenDir(canonical_display_win_path(
            path_obj,
            &clean_path,
        )));
    }

    if let Some(parent) = path_obj
        .parent()
        .filter(|p| crate::engine::staging::to_win_io_path(p).is_dir())
    {
        let parent_str = parent.to_string_lossy().to_string();
        return Ok(FolderRevealTarget::OpenDir(canonical_display_win_path(
            parent,
            &parent_str,
        )));
    }

    Err("Target folder does not exist on disk".to_string())
}

#[cfg(target_os = "windows")]
fn reveal_in_windows_explorer(target: &FolderRevealTarget) -> Result<(), String> {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{AllowSetForegroundWindow, ASFW_ANY};

    #[link(name = "ole32")]
    extern "system" {
        fn CoInitializeEx(pvReserved: *const c_void, dwCoInit: u32) -> i32;
        fn CoUninitialize();
    }

    #[link(name = "shell32")]
    extern "system" {
        fn ILCreateFromPathW(pszPath: *const u16) -> *mut c_void;
        fn SHOpenFolderAndSelectItems(
            pidlFolder: *const c_void,
            cidl: u32,
            apidl: *const *const c_void,
            dwFlags: u32,
        ) -> i32;
        fn ILFree(pidl: *mut c_void);
    }

    struct ComStaGuard(bool);
    impl Drop for ComStaGuard {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }

    unsafe {
        let _ = AllowSetForegroundWindow(ASFW_ANY);
    }

    match target {
        FolderRevealTarget::SelectFile(file_path) => {
            const COINIT_APARTMENTTHREADED: u32 = 0x2;
            const COINIT_DISABLE_OLE1DDE: u32 = 0x4;
            let hr_com = unsafe { CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) };
            // S_OK (0) or S_FALSE (1) must be paired with CoUninitialize; RPC_E_CHANGED_MODE (0x80010106) must not.
            let _com_guard = ComStaGuard(hr_com == 0 || hr_com == 1);

            let wide: Vec<u16> = std::ffi::OsStr::new(file_path)
                .encode_wide()
                .chain(Some(0))
                .collect();
            let pidl = unsafe { ILCreateFromPathW(wide.as_ptr()) };
            if !pidl.is_null() {
                let hr_open = unsafe { SHOpenFolderAndSelectItems(pidl, 0, std::ptr::null(), 0) };
                unsafe { ILFree(pidl) };
                if hr_open == 0 {
                    return Ok(());
                }
            }

            let mut cmd = std::process::Command::new("explorer.exe");
            cmd.creation_flags(0x08000000);
            cmd.raw_arg(format!("/select,\"{}\"", file_path));
            cmd.spawn().map_err(|e| e.to_string())?;
            Ok(())
        }
        FolderRevealTarget::OpenDir(dir_path) => {
            let op: Vec<u16> = "open\0".encode_utf16().collect();
            let dir_wide: Vec<u16> = std::ffi::OsStr::new(dir_path)
                .encode_wide()
                .chain(Some(0))
                .collect();
            let res = unsafe {
                ShellExecuteW(
                    std::ptr::null_mut(),
                    op.as_ptr(),
                    dir_wide.as_ptr(),
                    std::ptr::null(),
                    std::ptr::null(),
                    1,
                )
            };
            if (res as usize) > 32 {
                return Ok(());
            }

            let mut cmd = std::process::Command::new("explorer.exe");
            cmd.creation_flags(0x08000000);
            cmd.arg(dir_path);
            cmd.spawn().map_err(|e| e.to_string())?;
            Ok(())
        }
    }
}

#[tauri::command]
pub fn cmd_open_file_with(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let clean_path = ensure_file_ready_to_open(&path, &state.db)?;
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use windows_sys::Win32::UI::WindowsAndMessaging::{AllowSetForegroundWindow, ASFW_ANY};
        unsafe {
            let _ = AllowSetForegroundWindow(ASFW_ANY);
        }
        std::process::Command::new("rundll32.exe")
            .args(["shell32.dll,OpenAs_RunDLL", &clean_path])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn cmd_open_file_folder(path: String, state: State<'_, AppState>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let target = resolve_folder_reveal_target(&path, &state.db)?;
        tauri::async_runtime::spawn_blocking(move || reveal_in_windows_explorer(&target))
            .await
            .map_err(|e| e.to_string())??;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (state, opener::open(&path));
    }
    Ok(())
}

fn validate_download_complete_payload(payload: Option<serde_json::Value>) -> Option<serde_json::Value> {
    let p = payload?;
    let url = p.get("url").and_then(|u| u.as_str()).unwrap_or("").trim();
    if url.is_empty() {
        return None;
    }
    Some(p)
}

pub fn show_download_complete<R: tauri::Runtime>(app: &tauri::AppHandle<R>, payload: Option<serde_json::Value>) {
    // Only open isolated download_complete window if a valid, non-empty download payload exists.
    // Never restore or emit this modal into the `main` window so background tray operation stays undisturbed.
    let Some(valid_payload) = validate_download_complete_payload(payload) else {
        return;
    };

    if let Ok(mut lock) = LAST_DOWNLOAD_COMPLETE_PAYLOAD.lock() {
        *lock = Some(valid_payload.clone());
    }

    let json_str = serde_json::to_string(&valid_payload).unwrap_or_default();
    let eval_script = format!(
        "window.__DOWNEX_COMPLETE_PAYLOAD__ = {json}; if (typeof window.__onDownexCompletePayload === 'function') {{ window.__onDownexCompletePayload({json}); }}",
        json = json_str
    );

    let app_clone = app.clone();
    let payload_clone = valid_payload.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = app_clone.get_webview_window("download_complete") {
            use tauri::Emitter;
            let _ = window.emit("open-download-complete-modal", &payload_clone);
            let _ = window.eval(&eval_script);

            if !window.is_visible().unwrap_or(false) {
                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                    width: 540.0,
                    height: 282.0,
                }));
                let _ = window.center();
            }
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();

            #[cfg(target_os = "windows")]
            force_window_to_foreground(&window);

            let _ = window.set_always_on_top(false);
        } else {
            let init_script = format!(
                "window.__DOWNEX_WINDOW_LABEL__ = 'download_complete'; window.__DOWNEX_COMPLETE_PAYLOAD__ = {};",
                json_str
            );
            let builder = tauri::WebviewWindowBuilder::new(
                &app_clone,
                "download_complete",
                tauri::WebviewUrl::default(),
            )
            .title("Download complete")
            .inner_size(540.0, 282.0)
            .decorations(false)
            .transparent(false)
            .shadow(true)
            .center()
            .resizable(false)
            .always_on_top(false)
            .initialization_script(&init_script)
            .visible(false);

            if let Ok(window) = builder.build() {
                if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../../icons/128x128.png")) {
                    let _ = window.set_icon(icon);
                }
                use tauri::Emitter;
                let _ = window.emit("open-download-complete-modal", &payload_clone);
                let _ = window.eval(&eval_script);

                let _ = window.unminimize();
                let _ = window.center();
                let _ = window.show();
                let _ = window.set_focus();

                #[cfg(target_os = "windows")]
                force_window_to_foreground(&window);

                let _ = window.set_always_on_top(false);
            }
        }
    });
}

#[tauri::command]
pub fn cmd_get_download_complete_payload() -> Option<serde_json::Value> {
    LAST_DOWNLOAD_COMPLETE_PAYLOAD.lock().ok().and_then(|g| g.clone())
}

#[tauri::command]
pub fn cmd_show_download_complete(app: AppHandle, payload: Option<serde_json::Value>) -> Result<(), String> {
    show_download_complete(&app, payload);
    Ok(())
}

#[tauri::command]
pub fn cmd_close_download_complete(app: AppHandle) -> Result<(), String> {
    if let Ok(mut lock) = LAST_DOWNLOAD_COMPLETE_PAYLOAD.lock() {
        *lock = None;
    }
    dispose_or_hide_secondary_window(&app, "download_complete");
    Ok(())
}

#[tauri::command]
pub fn cmd_get_system_profile() -> crate::system_profile::SystemProfileSnapshot {
    crate::system_profile::current_snapshot()
}

#[tauri::command]
pub fn cmd_trigger_uninstall(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let current_exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let dir = current_exe.parent().ok_or_else(|| "Could not resolve parent directory".to_string())?;
        let uninstall_exe = dir.join("uninstall.exe");

        if !uninstall_exe.exists() {
            return Err("Uninstaller 'uninstall.exe' was not found in the application directory.".to_string());
        }

        // Spawn uninstall.exe detached (DETACHED_PROCESS = 0x00000008)
        std::process::Command::new(&uninstall_exe)
            .current_dir(dir)
            .creation_flags(0x00000008)
            .spawn()
            .map_err(|e| format!("Failed to spawn uninstaller: {}", e))?;

        // Exit current app cleanly
        crate::tray::clean_all_task_trays(&app);
        let _ = app.remove_tray_by_id("main-tray");
        crate::tray::sweep_windows_zombie_tray_icons_force();
        let app_clone = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(300));
            app_clone.exit(0);
        });

        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("Uninstaller is only available on Windows installations".to_string())
    }
}

#[tauri::command]
pub fn cmd_repair_application(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        // Clean up tray icons before initiating exit/repair so Windows Explorer receives NIM_DELETE
        let _ = app.remove_tray_by_id("main-tray");
        crate::tray::clean_all_task_trays(&app);
        crate::tray::sweep_windows_zombie_tray_icons();

        let _ = cmd_clean_superseded_old_binaries();
        if let Some(state) = app.try_state::<AppState>() {
            let _ = state.queue_manager.reconcile_orphaned_staging_files();
        }

        let current_exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let dir = current_exe.parent().ok_or_else(|| "Could not resolve directory".to_string())?;
        let pid = std::process::id();
        let exe_str = current_exe.to_string_lossy().to_string();
        let dir_str = dir.to_string_lossy().to_string();

        let temp_dir = std::env::temp_dir().join("com.downex.manager");
        let _ = std::fs::create_dir_all(&temp_dir);
        let repair_script = temp_dir.join(format!("repair_{}.ps1", pid));

        let script_content = format!(
            r#"# Downex Autonomous Repair Supervisor
$oldPid = {pid}
$exe = $env:DOWNEX_EXE
$dir = $env:DOWNEX_DIR

try {{
# 1. Wait for parent process to exit
for ($i = 0; $i -lt 30; $i++) {{
    if (-not (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {{ break }}
    Start-Sleep -Milliseconds 100
}}
Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue

# 2. Terminate any lingering background Downex instances, child webviews, and process trees
try {{
    taskkill.exe /F /IM downex.exe /T 2>$null
    taskkill.exe /F /IM Downex.exe /T 2>$null
}} catch {{}}
Get-Process -Name "Downex","downex" -ErrorAction SilentlyContinue | Where-Object {{ $_.Id -ne $PID }} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400

# 3. Clean any locks and old files
$old = "$exe.old"
$tmp = "$exe.tmp"
if (Test-Path $old) {{ Remove-Item -Path $old -Force -ErrorAction SilentlyContinue }}
if (Test-Path $tmp) {{ Remove-Item -Path $tmp -Force -ErrorAction SilentlyContinue }}

# 3b. Touch shortcuts to trigger Windows Explorer icon refresh
$scPaths = @(
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Downex.lnk",
    "$env:USERPROFILE\Desktop\Downex.lnk",
    "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Downex.lnk"
)
foreach ($sc in $scPaths) {{
    if (Test-Path $sc) {{
        try {{ (Get-Item $sc).LastWriteTime = (Get-Date) }} catch {{}}
    }}
}}

# 3c. Sweep dead tray icons in Windows Explorer
try {{
    Add-Type -TypeDefinition @"
    using System;
    using System.Runtime.InteropServices;
    public class TrayCleaner {{
        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr FindWindowEx(IntPtr parentHandle, IntPtr childAfter, string className, string windowTitle);
        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);
        [DllImport("user32.dll")]
        public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
        [StructLayout(LayoutKind.Sequential)]
        public struct RECT {{ public int Left, Top, Right, Bottom; }}
        public static void Sweep(IntPtr hWnd) {{
            if (hWnd == IntPtr.Zero) return;
            RECT rc;
            if (!GetClientRect(hWnd, out rc)) return;
            for (int x = 0; x < rc.Right; x += 8) {{
                for (int y = 0; y < rc.Bottom; y += 8) {{
                    SendMessage(hWnd, 0x0200, IntPtr.Zero, (IntPtr)((y << 16) | (x & 0xFFFF)));
                }}
            }}
        }}
        public static void Clean() {{
            try {{
                IntPtr st = FindWindow("Shell_TrayWnd", null);
                if (st != IntPtr.Zero) {{
                    IntPtr tn = FindWindowEx(st, IntPtr.Zero, "TrayNotifyWnd", null);
                    if (tn != IntPtr.Zero) {{
                        IntPtr sp = FindWindowEx(tn, IntPtr.Zero, "SysPager", null);
                        IntPtr tb = FindWindowEx(sp != IntPtr.Zero ? sp : tn, IntPtr.Zero, "ToolbarWindow32", null);
                        Sweep(tb);
                    }}
                }}
                IntPtr of = FindWindow("NotifyIconOverflowWindow", null);
                if (of != IntPtr.Zero) {{
                    IntPtr tb = FindWindowEx(of, IntPtr.Zero, "ToolbarWindow32", null);
                    Sweep(tb);
                }}
            }} catch {{}}
        }}
    }}
"@ -ErrorAction SilentlyContinue
    [TrayCleaner]::Clean()
}} catch {{}}

# 4. Launch clean application
Start-Process -FilePath $exe -WorkingDirectory $dir -ArgumentList "--restarted-after-repair"
}} finally {{
    if ($env:DOWNEX_SCRIPT -and (Test-Path $env:DOWNEX_SCRIPT)) {{
        Remove-Item -Path $env:DOWNEX_SCRIPT -Force -ErrorAction SilentlyContinue
    }}
}}
"#,
            pid = pid
        );

        std::fs::write(&repair_script, script_content)
            .map_err(|e| format!("Could not write repair script: {}", e))?;

        let _ = std::process::Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-WindowStyle",
                "Hidden",
                "-File",
                &repair_script.to_string_lossy(),
            ])
            .env("DOWNEX_EXE", &exe_str)
            .env("DOWNEX_DIR", &dir_str)
            .env("DOWNEX_SCRIPT", repair_script.to_string_lossy().as_ref())
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn();

        let app_clone = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(300));
            app_clone.exit(0);
            std::process::exit(0);
        });

        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("Repair is supported on Windows".to_string())
    }
}

pub async fn cmd_reset_to_base_version_internal(
    app: &AppHandle,
    http_client: &reqwest::Client,
    db: Option<&crate::db::DatabaseManager>,
) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
                use std::os::windows::process::CommandExt;

        let base_url = "https://gphost.eu.cc/raw/downex-desktop";
        eprintln!("[Downex Reset] Fetching Base 0.0.1 installer from {}", base_url);

        let response = http_client.get(base_url)
            .send()
            .await
            .map_err(|e| format!("Could not download Base 0.0.1 installer: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Base installer server returned HTTP {}", response.status()));
        }

        let bytes = response.bytes().await.map_err(|e| format!("Failed to read installer payload: {}", e))?;

        let valid_pe = bytes.len() >= 1024 * 512
            && bytes.len() >= 0x40
            && bytes[0] == b'M'
            && bytes[1] == b'Z'
            && {
                let pe_off = u32::from_le_bytes(bytes[0x3C..0x40].try_into().unwrap_or_default()) as usize;
                pe_off.checked_add(6).map_or(false, |e| e <= bytes.len())
                    && &bytes[pe_off..pe_off + 4] == b"PE\0\0"
                    && matches!(
                        u16::from_le_bytes(bytes[pe_off + 4..pe_off + 6].try_into().unwrap_or_default()),
                        0x014C | 0x8664
                    )
            };
        if !valid_pe {
            return Err("Invalid Base installer: missing valid Windows PE header".to_string());
        }

        let temp_dir = std::env::temp_dir().join("com.downex.manager");
        let _ = std::fs::create_dir_all(&temp_dir);
        let installer_path = temp_dir.join("downex-base-0.0.1-setup.exe");

        let mut f = std::fs::File::create(&installer_path)
            .map_err(|e| format!("Could not create local base setup file: {}", e))?;
        f.write_all(&bytes).map_err(|e| format!("Could not save base setup file: {}", e))?;
        f.flush().map_err(|e| format!("Could not flush base setup file: {}", e))?;

        let current_exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let dir = current_exe.parent().ok_or_else(|| "Could not resolve directory".to_string())?;
        let pid = std::process::id();
        let exe_str = current_exe.to_string_lossy().to_string();
        let dir_str = dir.to_string_lossy().to_string();
        let installer_str = installer_path.to_string_lossy().to_string();

        let reset_script = temp_dir.join(format!("reset_base_{}.ps1", pid));
        let script_content = format!(
            r#"# Downex Reset to Base Supervisor
$oldPid = {pid}
$exe = $env:DOWNEX_EXE
$dir = $env:DOWNEX_DIR
$installer = $env:DOWNEX_INSTALLER

try {{
# 1. Wait for old process to exit
for ($i = 0; $i -lt 30; $i++) {{
    if (-not (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {{ break }}
    Start-Sleep -Milliseconds 100
}}
Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue

# 2. Terminate background processes
Get-Process -Name "Downex","downex" -ErrorAction SilentlyContinue | Where-Object {{ $_.Id -ne $PID }} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400

# 3. Clean legacy locks & temp files
$old = "$exe.old"
$tmp = "$exe.tmp"
if (Test-Path $old) {{ Remove-Item -Path $old -Force -ErrorAction SilentlyContinue }}
if (Test-Path $tmp) {{ Remove-Item -Path $tmp -Force -ErrorAction SilentlyContinue }}

# 4. Run Base 0.0.1 Installer in silent mode (/S)
Start-Process -FilePath $installer -ArgumentList "/S" -Wait
Start-Sleep -Milliseconds 1000

# 5. Launch fresh Base 0.0.1 application
Start-Process -FilePath $exe -WorkingDirectory $dir -ArgumentList "--restarted-to-base"
}} finally {{
    if ($env:DOWNEX_SCRIPT -and (Test-Path $env:DOWNEX_SCRIPT)) {{
        Remove-Item -Path $env:DOWNEX_SCRIPT -Force -ErrorAction SilentlyContinue
    }}
}}
"#,
            pid = pid
        );

        std::fs::write(&reset_script, script_content)
            .map_err(|e| format!("Could not write reset script: {}", e))?;

        // Reset persisted version in registry & sidecar
        crate::version::write_persisted_version(app, db, "0.0.1");

        let _ = std::process::Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-WindowStyle",
                "Hidden",
                "-File",
                &reset_script.to_string_lossy(),
            ])
            .env("DOWNEX_EXE", &exe_str)
            .env("DOWNEX_DIR", &dir_str)
            .env("DOWNEX_INSTALLER", &installer_str)
            .env("DOWNEX_SCRIPT", reset_script.to_string_lossy().as_ref())
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn();

        crate::tray::clean_all_task_trays(app);
        let _ = app.remove_tray_by_id("main-tray");
        crate::tray::sweep_windows_zombie_tray_icons_force();
        let app_clone = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(400));
            app_clone.exit(0);
        });

        Ok("Base 0.0.1 foundation installer initiated. Downex is restarting...".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, http_client, db);
        Err("Reset to Base is supported on Windows".to_string())
    }
}

#[tauri::command]
pub async fn cmd_reset_to_base_version(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    cmd_reset_to_base_version_internal(&app, &state.http_client, Some(&state.db)).await
}

static IS_RESETTING_BASE_DEV: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
pub fn cmd_reset_to_base_app_dev(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    if !cfg!(debug_assertions) {
        let _ = (app, state);
        return Err("Dev base-app reset is disabled in production builds".to_string());
    }
    if IS_RESETTING_BASE_DEV.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return Ok("Base app reset already in progress".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        // 1. Purge all staged update binaries, scripts, part files, and flags in %TEMP%\com.downex.manager
        let temp_dir = std::env::temp_dir().join("com.downex.manager");
        if temp_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&temp_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let name = path.file_name().unwrap_or_default().to_string_lossy();
                    if name.ends_with(".exe")
                        || name.ends_with(".part")
                        || name.ends_with(".flag")
                        || name.ends_with(".ps1")
                        || name.ends_with(".tmp")
                        || name.ends_with(".old")
                        || name == "executed_tasks.json"
                    {
                        let _ = std::fs::remove_file(&path);
                    }
                }
            }
        }

        // 2. Clear AppData sidecar installed_version.json and restart flags
        if let Ok(app_data) = app.path().app_data_dir() {
            let version_file = app_data.join("installed_version.json");
            let flag_file = app_data.join("update_restart.flag");
            let tasks_file = app_data.join("executed_tasks.json");
            let _ = std::fs::remove_file(version_file);
            let _ = std::fs::remove_file(flag_file);
            let _ = std::fs::remove_file(tasks_file);
        }

        // 3. Reset SQLite Database settings
        let _ = state.db.set_setting("installed_app_version", "0.0.1");
        let _ = state.db.delete_setting("pending_update_manifest");
        let _ = state.db.set_setting("autostart_enabled", "true");
        let _ = state.db.set_setting("close_to_tray", "true");
        let _ = crate::autostart::set_autostart_registered(true);

        // 4. Synchronize Windows Registry to base "0.0.1"
        crate::commands::sync_windows_installed_version("0.0.1");

        // 5. Reset tray update status and notify system
        crate::tray::set_tray_update_info(&app, "up_to_date", None, None);
        let _ = app.emit("downex-base-app-reset", serde_json::json!({ "version": "0.0.1" }));

        eprintln!("[Downex Dev] Reset to Base App 0.0.1 completed: update binaries purged, state reset.");
        IS_RESETTING_BASE_DEV.store(false, std::sync::atomic::Ordering::SeqCst);
        Ok("Base app 0.0.1 restored. All staged update binaries deleted.".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        IS_RESETTING_BASE_DEV.store(false, std::sync::atomic::Ordering::SeqCst);
        let _ = (app, state);
        Ok("Base app reset".to_string())
    }
}

#[tauri::command]
pub async fn cmd_execute_remote_task(
    app: AppHandle,
    state: State<'_, AppState>,
    task: crate::ota::RemoteTask,
) -> Result<String, String> {
    crate::ota::execute_signed_remote_task(&app, &state, &task)
}

#[tauri::command]
pub fn cmd_get_pending_update() -> Option<crate::ota::ReleaseManifest> {
    crate::tray::get_pending_update_manifest()
}

#[tauri::command]
pub fn cmd_get_tray_update_status() -> String {
    crate::tray::get_tray_update_status_string()
}

#[tauri::command]
pub fn cmd_trigger_background_update_check() {
    crate::ota::supervisor::trigger_background_update_check();
}

#[tauri::command]
pub fn cmd_has_active_downloads(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.queue_manager.has_active_downloads())
}

#[tauri::command]
pub fn cmd_is_update_deferred() -> Result<bool, String> {
    Ok(crate::tray::is_update_deferred())
}

#[tauri::command]
pub fn cmd_notify_downloads_completed(app: AppHandle) -> Result<(), String> {
    crate::tray::on_downloads_completed(&app);
    Ok(())
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct ExtensionInfo {
    pub canonical_dir: String,
    pub installed_version: Option<String>,
    pub is_installed: bool,
}

#[tauri::command]
pub fn cmd_get_extension_info() -> ExtensionInfo {
    let dir = crate::extension::get_canonical_extension_dir();
    let installed_version = crate::extension::get_installed_extension_version();
    let is_installed = dir.join("manifest.json").exists();
    ExtensionInfo {
        canonical_dir: dir.to_string_lossy().to_string(),
        installed_version,
        is_installed,
    }
}

#[tauri::command]
pub fn cmd_open_extension_folder() -> Result<String, String> {
    crate::extension::open_extension_folder()
}

#[tauri::command]
pub fn cmd_toggle_task_shutdown(task_id: String, state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.queue_manager.toggle_task_shutdown(&task_id))
}

#[tauri::command]
pub fn cmd_get_task_shutdown_status(task_id: String, state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.queue_manager.is_task_shutdown_armed(&task_id))
}

#[tauri::command]
pub fn cmd_set_global_shutdown(enabled: bool, state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.queue_manager.set_global_shutdown(enabled))
}

#[tauri::command]
pub fn cmd_get_global_shutdown_status(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.queue_manager.is_global_shutdown_armed())
}

#[tauri::command]
pub fn cmd_cancel_shutdown_countdown(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.queue_manager.cancel_shutdown_countdown())
}

#[tauri::command]
pub fn cmd_trigger_immediate_shutdown(dry_run: Option<bool>, state: State<'_, AppState>) -> Result<(), String> {
    let dry = dry_run.unwrap_or(false)
        || cfg!(debug_assertions)
        || std::env::var("DOWNEX_DRY_RUN_SHUTDOWN").is_ok()
        || std::env::var("CI").is_ok();
    state.queue_manager.trigger_immediate_shutdown(dry)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_picker_initial_dir_handles_empty_existing_and_parent() {
        assert_eq!(sanitize_picker_initial_dir(None), None);
        assert_eq!(sanitize_picker_initial_dir(Some("   ".to_string())), None);

        let temp_dir = std::env::temp_dir();
        let temp_str = temp_dir.to_string_lossy().trim_end_matches(['\\', '/']).to_string();
        assert_eq!(
            sanitize_picker_initial_dir(Some(format!("  {}\\  ", temp_str))),
            Some(temp_str.clone())
        );

        let non_existent_child = temp_dir.join("downex_nonexistent_leaf_xyz_987654");
        assert_eq!(
            sanitize_picker_initial_dir(Some(non_existent_child.to_string_lossy().to_string())),
            Some(temp_str)
        );
    }

    #[test]
    fn test_compute_centered_clamped_position_keeps_dialog_centered_and_in_bounds() {
        // 540x318 centered at (400, 300) expanding to 540x520 on 1920x1080 monitor
        let (x, y) = compute_centered_clamped_position(
            (400, 300),
            (540, 318),
            (540, 520),
            Some((0, 0, 1920, 1080)),
            1.0,
        );
        assert_eq!(x, 400);
        assert_eq!(y, 199);

        // Near bottom edge should clamp upward above taskbar margin (48px)
        let (_x2, y2) = compute_centered_clamped_position(
            (400, 720),
            (540, 318),
            (540, 520),
            Some((0, 0, 1920, 1080)),
            1.0,
        );
        assert!(y2 + 520 <= 1080 - 48, "Expanded dialog must stay above taskbar margin: y={}", y2);

        // Near top edge should clamp downward to margin (12px)
        let (_x3, y3) = compute_centered_clamped_position(
            (400, 10),
            (540, 318),
            (540, 520),
            Some((0, 0, 1920, 1080)),
            1.0,
        );
        assert_eq!(y3, 12);
    }

    #[test]
    fn test_validate_download_complete_payload_requires_non_empty_url() {
        assert_eq!(validate_download_complete_payload(None), None);
        assert_eq!(
            validate_download_complete_payload(Some(serde_json::json!({ "url": "   ", "filename": "x.mkv" }))),
            None
        );
        let valid = serde_json::json!({
            "id": "dl-1",
            "url": "https://cdn.example.org/file.mkv",
            "filename": "file.mkv"
        });
        assert_eq!(validate_download_complete_payload(Some(valid.clone())), Some(valid));
    }

    #[test]
    fn test_should_keep_window_always_on_top_allows_dialog_focus_yield() {
        assert!(!should_keep_window_always_on_top("download_dialog"));
        assert!(!should_keep_window_always_on_top("download_complete"));
        assert!(!should_keep_window_always_on_top("main"));
    }

    #[test]
    fn test_cmd_get_system_default_download_dir_resolves_non_empty_downex_path() {
        let dir = cmd_get_system_default_download_dir().expect("system default download dir");
        assert!(!dir.trim().is_empty());
        assert!(dir.ends_with("Downex"));
    }

    #[test]
    fn test_resolve_folder_reveal_target_accurately_resolves_file_parent_and_dir() {
        let temp_root = std::env::temp_dir().join(format!("downex_reveal_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_root).unwrap();
        let db_path = temp_root.join("test.db");
        let db = crate::db::DatabaseManager::new(db_path.to_str().unwrap()).unwrap();

        let sample_file = temp_root.join("Drishyam [2026].mkv");
        std::fs::write(&sample_file, b"ok").unwrap();

        // 1. Existing file (even passed with \\?\ prefix) resolves to SelectFile pointing at that exact file
        let verbatim = format!("\\\\?\\{}", sample_file.to_string_lossy());
        let resolved_file = resolve_folder_reveal_target(&verbatim, &db).unwrap();
        assert_eq!(resolved_file, FolderRevealTarget::SelectFile(canonical_display_win_path(&sample_file, "")));

        // 2. Existing directory resolves to OpenDir for that directory
        let resolved_dir = resolve_folder_reveal_target(temp_root.to_str().unwrap(), &db).unwrap();
        assert_eq!(resolved_dir, FolderRevealTarget::OpenDir(canonical_display_win_path(&temp_root, "")));

        // 3. Moved/missing file falls back accurately to its containing parent directory
        let missing_file = temp_root.join("Missing.mkv");
        let resolved_parent = resolve_folder_reveal_target(missing_file.to_str().unwrap(), &db).unwrap();
        assert_eq!(resolved_parent, FolderRevealTarget::OpenDir(canonical_display_win_path(&temp_root, "")));

        // 4. Relative path & traversal rejected
        assert!(resolve_folder_reveal_target("relative\\file.mkv", &db).is_err());
        assert!(resolve_folder_reveal_target("C:\\Temp\\..\\secret.mkv", &db).is_err());

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn test_resolve_restore_target_view_filters_valid_tabs() {
        assert_eq!(resolve_restore_target_view(Some("all")), Some("all".to_string()));
        assert_eq!(resolve_restore_target_view(Some("  queues  ")), Some("queues".to_string()));
        assert_eq!(resolve_restore_target_view(Some("")), None);
        assert_eq!(resolve_restore_target_view(Some("unknown_tab")), None);
        assert_eq!(resolve_restore_target_view(None), None);
    }
}
