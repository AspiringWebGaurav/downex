use crate::db::DownloadRecord;
use crate::ota::{check_latest_release, ReleaseManifest};
use crate::AppState;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

static LAST_DOWNLOAD_DIALOG_PAYLOAD: Mutex<Option<serde_json::Value>> = Mutex::new(None);
static LAST_DOWNLOAD_COMPLETE_PAYLOAD: Mutex<Option<serde_json::Value>> = Mutex::new(None);

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
    let res = state.queue_manager.pause_task(&id);
    let _ = crate::tray::refresh_tray_menu(&app);
    Ok(res)
}

#[tauri::command]
pub async fn cmd_start_queue(app: AppHandle, state: State<'_, AppState>) -> Result<usize, String> {
    let res = state.queue_manager.start_queue().await;
    let _ = crate::tray::refresh_tray_menu(&app);
    Ok(res)
}

#[tauri::command]
pub fn cmd_pause_queue(app: AppHandle, state: State<'_, AppState>) -> Result<bool, String> {
    let res = state.queue_manager.pause_queue();
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
    let _ = crate::tray::refresh_tray_menu(&app);
    Ok(res)
}

#[tauri::command]
pub async fn cmd_resume_download(app: AppHandle, id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let res = state.queue_manager.resume_task(&id).await;
    let _ = crate::tray::refresh_tray_menu(&app);
    Ok(res)
}

#[tauri::command]
pub async fn cmd_cancel_download(app: AppHandle, id: String, delete_file: bool, state: State<'_, AppState>) -> Result<bool, String> {
    let res = state.queue_manager.cancel_task(&id, delete_file);
    let _ = crate::tray::refresh_tray_menu(&app);
    Ok(res)
}

#[tauri::command]
pub async fn cmd_get_downloads(state: State<'_, AppState>) -> Result<Vec<DownloadRecord>, String> {
    state.db.get_all_downloads().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_get_default_download_dir(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.queue_manager.get_default_download_directory())
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
        return Ok(val == "true");
    }
    // Fall back to actual registry status if not recorded in SQLite yet
    Ok(crate::autostart::is_autostart_registered())
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

#[tauri::command]
pub fn cmd_open_folder_picker() -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        use std::os::windows::process::CommandExt;

        let output = Command::new("powershell")
            .args(&[
                "-NoProfile",
                "-Command",
                "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select Downex Download Folder'; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }",
            ])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output()
            .map_err(|e| e.to_string())?;

        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if path.is_empty() {
            Ok(None)
        } else {
            Ok(Some(path))
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(None)
    }
}

#[tauri::command]
pub async fn cmd_fetch_update_manifest(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
        .connect_timeout(std::time::Duration::from_secs(8))
        .timeout(std::time::Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get(&url)
        .header("Cache-Control", "no-cache")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch update manifest: {}", e))?;

    if res.status() == reqwest::StatusCode::NOT_FOUND || res.status() == reqwest::StatusCode::NO_CONTENT {
        return Ok(r#"{"no_release":true}"#.to_string());
    }

    if !res.status().is_success() {
        return Err(format!("Update server returned HTTP {}", res.status()));
    }

    res.text()
        .await
        .map_err(|e| format!("Failed to read manifest text: {}", e))
}

#[tauri::command]
pub async fn cmd_download_update_binary(app: AppHandle, url: String) -> Result<Vec<u8>, String> {
    use futures_util::StreamExt;

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to download update binary: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Update download returned HTTP {}", res.status()));
    }

    let total_bytes = res.content_length().unwrap_or(12 * 1024 * 1024);
    let mut downloaded_bytes: usize = 0;
    let mut buffer = Vec::with_capacity(total_bytes as usize);
    let mut stream = res.bytes_stream();
    let mut last_emit = std::time::Instant::now();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Failed to read stream chunk: {}", e))?;
        downloaded_bytes += chunk.len();
        buffer.extend_from_slice(&chunk);

        if downloaded_bytes == total_bytes as usize || last_emit.elapsed() >= std::time::Duration::from_millis(35) {
            let pct = if total_bytes > 0 {
                ((downloaded_bytes as f64 / total_bytes as f64) * 100.0).floor() as u32
            } else {
                0
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
pub async fn cmd_download_update_container(app: AppHandle, url: String) -> Result<Vec<u8>, String> {
    cmd_download_update_binary(app, url).await
}

#[tauri::command]
pub async fn cmd_check_updates(app: AppHandle, state: State<'_, AppState>) -> Result<Option<ReleaseManifest>, String> {
    let current_version = crate::version::resolve_installed_version(&app, Some(&state.db));
    check_latest_release(&state.http_client, &current_version)
        .await
        .map_err(|e| e.to_string())
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
            let mut len = 0;
            while *ptr.add(len) != 0 {
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

    // 1. Purge any duplicate bundle-ID uninstall keys created by previous builds (GPN 1:1 REA pattern)
    // This permanently prevents duplicate "Downex" entries in Windows Settings Installed Apps
    let obsolete_subkeys = [
        r"Software\Microsoft\Windows\CurrentVersion\Uninstall\com.downex.manager",
        r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\com.downex.manager",
    ];
    for obsolete in &obsolete_subkeys {
        let _ = hkcu.delete_subkey(obsolete);
        let _ = hklm.delete_subkey(obsolete);
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
        // Clean up any development/debug uninstall keys so they never pollute Windows Settings "Installed apps"
        let _ = hkcu.delete_subkey(canonical_subkey);
        let _ = hkcu.delete_subkey(r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Downex");
        let _ = hkcu.delete_subkey(r"Software\Microsoft\Windows\CurrentVersion\App Paths\downex.exe");
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
    Ok(ver)
}

#[tauri::command]
pub fn cmd_write_update_staging_file(file_name: String, bytes: Vec<u8>) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use std::io::Write;
        let temp_dir = std::env::temp_dir().join("com.downex.manager");
        let _ = std::fs::create_dir_all(&temp_dir);
        let target_file = temp_dir.join(&file_name);
        let part_file = temp_dir.join(format!("{}.part", file_name));

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
        use std::io::Read;
        let clean_ver = target_version.trim().trim_start_matches('v');
        let temp_dir = std::env::temp_dir().join("com.downex.manager");
        let target_file = temp_dir.join(format!("downex-v{}.staged.exe", clean_ver));
        if target_file.exists() {
            if let Ok(metadata) = std::fs::metadata(&target_file) {
                // Verified update binaries are complete PE executables (> 512KB)
                if metadata.len() > 1024 * 512 {
                    if let Ok(mut f) = std::fs::File::open(&target_file) {
                        let mut magic = [0u8; 2];
                        if f.read_exact(&mut magic).is_ok() && magic == [b'M', b'Z'] {
                            return Ok(Some(target_file.to_string_lossy().to_string()));
                        }
                    }
                }
            }
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
        use std::io::Write;
        use std::os::windows::process::CommandExt;

        // Atomic guard so we never attempt duplicate swap
        static UPDATE_APPLIED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
        if UPDATE_APPLIED.swap(true, std::sync::atomic::Ordering::SeqCst) {
            eprintln!("[Downex OTA] Update swap already in progress or completed, ignoring duplicate call");
            return Ok(());
        }

        let effective_staging_path = staging_path.clone()
            .or_else(|| {
                // Fallback: look in temp directory for any staged Downex binary
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
            b
        } else if let Some(ref path_str) = effective_staging_path {
            match std::fs::read(path_str) {
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

        eprintln!("[Downex OTA] Starting in-process atomic shadow swap with {} bytes", bytes.len());

        // 2. Pre-sync Windows Installed Apps registry, SQLite app_settings, and AppData sidecar
        if let Some(ref ver) = target_version {
            crate::version::write_persisted_version(&app, None, ver);
        }

        // 3. Sanity check: payload must not be trivial
        if bytes.len() < 1024 * 512 {
            UPDATE_APPLIED.store(false, std::sync::atomic::Ordering::SeqCst);
            return Err("Invalid update payload: binary size is unexpectedly small".to_string());
        }

        // 4. Validate Windows PE signature (MZ header)
        if bytes.len() < 2 || bytes[0] != b'M' || bytes[1] != b'Z' {
            UPDATE_APPLIED.store(false, std::sync::atomic::Ordering::SeqCst);
            return Err("Invalid update payload: missing Windows executable PE header (MZ)".to_string());
        }

        // 5. Resolve currently executing file path
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
        let tmp_exe = parent_dir.join(format!("{}.tmp", file_name));

        // Clean any leftover tmp or old file
        if tmp_exe.exists() {
            let _ = std::fs::remove_file(&tmp_exe);
        }
        if old_exe.exists() {
            let _ = std::fs::remove_file(&old_exe);
        }

        // 6. Stage verified binary into temporary staging file first
        let stage_write_ok = (|| -> Result<(), std::io::Error> {
            let mut file = std::fs::File::create(&tmp_exe)?;
            file.write_all(&bytes)?;
            file.flush()?;
            Ok(())
        })().is_ok();

        // If local parent_dir write failed (e.g. Program Files permission boundary), use temp staging
        let active_staged_file = if stage_write_ok {
            tmp_exe.clone()
        } else if let Some(ref path_str) = effective_staging_path {
            std::path::PathBuf::from(path_str)
        } else {
            let fallback = std::env::temp_dir().join("com.downex.manager").join("downex_handoff.staged.exe");
            let _ = std::fs::write(&fallback, &bytes);
            fallback
        };

        // 7. Atomic Swap with Self-Healing Supervisor Fallback
        // Try in-process NTFS rename first (fastest path if executable has FILE_SHARE_DELETE and no external lock)
        let in_process_swap_ok = match std::fs::rename(&current_exe, &old_exe) {
            Ok(_) => {
                if let Err(e) = std::fs::rename(&active_staged_file, &current_exe) {
                    eprintln!("[Downex OTA] Could not move staged file to current exe: {}. Reverting...", e);
                    let _ = std::fs::rename(&old_exe, &current_exe);
                    false
                } else {
                    true
                }
            }
            Err(e) => {
                eprintln!("[Downex OTA] In-process rename skipped/locked: {}. Watchdog supervisor will perform swap post-exit.", e);
                false
            }
        };

        eprintln!("[Downex OTA] In-process swap status: {}. Spawning self-healing supervisor...", in_process_swap_ok);

        // 8. Spawn Resilient Self-Healing Watchdog Supervisor from clean staged script file:
        let pid = std::process::id();
        let exe_str = current_exe.to_string_lossy().to_string();
        let old_str = old_exe.to_string_lossy().to_string();
        let staged_str = active_staged_file.to_string_lossy().to_string();
        let dir_str = parent_dir.to_string_lossy().to_string();

        let temp_dir = std::env::temp_dir().join("com.downex.manager");
        let _ = std::fs::create_dir_all(&temp_dir);
        let watchdog_file = temp_dir.join(format!("watchdog_{}.ps1", pid));

        let in_process_str = if in_process_swap_ok { "$true" } else { "$false" };

        let watchdog_content = format!(
            r#"# Downex Self-Healing Watchdog Supervisor
$oldPid = {pid}
$exe = '{exe}'
$old = '{old}'
$staged = '{staged}'
$dir = '{dir}'
$inProcessOk = {in_process_flag}
$log = Join-Path $env:TEMP 'com.downex.manager\watchdog.log'

function Write-Log($msg) {{
    $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss.fff')
    Add-Content -Path $log -Value "[$ts] $msg" -ErrorAction SilentlyContinue
}}

Write-Log "Watchdog started for PID $oldPid. Target exe: $exe (InProcessSwap: $inProcessOk)"

# 1. Wait for old parent process to exit completely (up to 4s)
$terminated = $false
for ($i = 0; $i -lt 40; $i++) {{
    if (-not (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {{
        $terminated = $true
        break
    }}
    Start-Sleep -Milliseconds 100
}}
if (-not $terminated) {{
    Write-Log "Old PID $oldPid did not exit within 4s. Force terminating..."
    Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 400
}}
Write-Log "Old PID $oldPid terminated."

# 2. Terminate any lingering background Downex instances so file locks and single-instance pipes are clean
Get-Process -Name "Downex","downex" -ErrorAction SilentlyContinue | Where-Object {{ $_.Id -ne $PID }} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400

# 3. If in-process swap didn't happen, complete swap now that all handles are closed!
if (-not $inProcessOk -and (Test-Path $staged)) {{
    Write-Log "Completing binary placement from $staged to $exe..."
    $placed = $false
    try {{
        if (Test-Path $exe) {{
            Move-Item -Path $exe -Destination $old -Force -ErrorAction Stop
        }}
        Move-Item -Path $staged -Destination $exe -Force -ErrorAction Stop
        $placed = $true
        Write-Log "Binary placed successfully."
    }} catch {{
        Write-Log "Standard placement failed ($($_.Exception.Message)). Attempting elevated UAC handoff..."
        try {{
            # Request Administrator elevation via UAC (-Verb RunAs) to update protected folder
            $uacCmd = "if (Test-Path '$exe') {{ Move-Item -Path '$exe' -Destination '$old' -Force }}; Move-Item -Path '$staged' -Destination '$exe' -Force; Start-Process -FilePath '$exe' -WorkingDirectory '$dir' -ArgumentList '--restarted-after-update'"
            $elevatedProc = Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile", "-WindowStyle", "Hidden", "-Command", $uacCmd -PassThru -Wait
            if ($elevatedProc.ExitCode -eq 0) {{
                Write-Log "Elevated placement succeeded."
                exit
            }}
        }} catch {{
            Write-Log "Elevated placement failed or was declined: $($_.Exception.Message)"
        }}
    }}
}}

# 4. Clean temporary staging file (preserve $old until stability is proven!)
if (Test-Path $staged) {{
    Remove-Item -Path $staged -Force -ErrorAction SilentlyContinue
}}

# 5. Launch updated application binary (with resilient health check & automatic self-healing rollback)
$launchedSuccessfully = $false
for ($attempt = 1; $attempt -le 4; $attempt++) {{
    Write-Log "Launch attempt $attempt for $exe..."
    $p = Start-Process -FilePath $exe -WorkingDirectory $dir -ArgumentList "--restarted-after-update" -PassThru
    Start-Sleep -Milliseconds 2000
    if ($p) {{
        $proc = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
        if ($proc -and (-not $proc.HasExited)) {{
            Write-Log "Application launched and running stably with PID $($p.Id)."
            $launchedSuccessfully = $true
            break
        }} else {{
            $exitCode = if ($proc) {{ $proc.ExitCode }} else {{ "Unknown" }}
            Write-Log "Attempt $attempt process terminated prematurely (ExitCode: $exitCode)."
        }}
    }}
    Start-Sleep -Milliseconds 1000
}}

# 6. Self-Healing Rollback Protection: If new binary repeatedly crashes on boot, restore previous binary!
if (-not $launchedSuccessfully -and (Test-Path $old)) {{
    Write-Log "New binary failed to boot stably after 4 attempts! Initiating self-healing rollback to previous binary..."
    try {{
        if (Test-Path $exe) {{
            Remove-Item -Path $exe -Force -ErrorAction SilentlyContinue
        }}
        Move-Item -Path $old -Destination $exe -Force -ErrorAction Stop
        Write-Log "Restored previous operational binary from $old to $exe."
        Start-Process -FilePath $exe -WorkingDirectory $dir -ArgumentList "--rollback-recovery"
        Write-Log "Previous operational binary launched in recovery mode."
    }} catch {{
        Write-Log "Rollback failed: $($_.Exception.Message)"
    }}
}}

Write-Log "Update supervisor successfully finalized."
"#,
            pid = pid,
            exe = exe_str,
            old = old_str,
            staged = staged_str,
            dir = dir_str,
            in_process_flag = in_process_str
        );

        if let Err(e) = std::fs::write(&watchdog_file, &watchdog_content) {
            eprintln!("[Downex OTA] Could not write watchdog script: {}", e);
        }

        let watchdog_file_str = watchdog_file.to_string_lossy().to_string();

        let spawn_result = std::process::Command::new("cmd.exe")
            .args([
                "/c",
                "start",
                "",
                "/b",
                "powershell.exe",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-WindowStyle",
                "Hidden",
                "-File",
                &watchdog_file_str,
            ])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn();

        match spawn_result {
            Ok(_) => {
                eprintln!("[Downex OTA] Self-healing watchdog spawned for PID {}. Terminating current process.", pid);
                for (_label, window) in app.webview_windows() {
                    let _ = window.destroy();
                }
                let app_clone = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(400));
                    app_clone.exit(0);
                    std::process::exit(0);
                });
                Ok(())
            }
            Err(e) => {
                UPDATE_APPLIED.store(false, std::sync::atomic::Ordering::SeqCst);
                // Rollback if detached supervisor couldn't spawn
                if in_process_swap_ok {
                    let _ = std::fs::remove_file(&current_exe);
                    let _ = std::fs::rename(&old_exe, &current_exe);
                }
                Err(format!("Could not spawn restart supervisor: {}. Restored previous version.", e))
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, binary_bytes, staging_path, target_version);
        Err("In-process atomic swap is supported on Windows".to_string())
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
                    if name.starts_with("watchdog_") && name.ends_with(".ps1") {
                        let _ = std::fs::remove_file(&path);
                        cleaned = true;
                    } else if name.ends_with(".part") {
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

#[tauri::command]
pub fn cmd_notify_dom_ready(app: AppHandle) {
    let is_background_boot = std::env::args().any(|arg| {
        arg == "--background" || arg == "--silent" || arg == "--minimized" || arg == "--autostart" || arg == "-b"
    });
    if !is_background_boot {
        if let Some(w) = app.get_webview_window("main") {
            if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../../icons/128x128.png")) {
                let _ = w.set_icon(icon);
            }
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
        #[cfg(target_os = "windows")]
        set_process_priority_background(false);
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
        let _ = crate::tray::refresh_tray_menu(&app);
    }
    Ok(())
}

#[tauri::command]
pub fn cmd_quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn cmd_set_tray_icon(app: AppHandle, state: String) -> Result<(), String> {
    crate::tray::set_tray_icon_state(&app, &state).map_err(|e| e.to_string())
}

pub fn show_download_dialog<R: tauri::Runtime>(app: &tauri::AppHandle<R>, payload: Option<serde_json::Value>) {
    if let Some(ref p) = payload {
        if let Ok(mut lock) = LAST_DOWNLOAD_DIALOG_PAYLOAD.lock() {
            *lock = Some(p.clone());
        }
    }

    if let Some(window) = app.get_webview_window("download_dialog") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.center();
        let _ = window.set_always_on_top(true);
        let _ = window.set_focus();
    } else {
        let builder = tauri::WebviewWindowBuilder::new(
            app,
            "download_dialog",
            tauri::WebviewUrl::default(),
        )
        .title("Downex - Download File Info")
        .inner_size(580.0, 440.0)
        .decorations(false)
        .transparent(false)
        .shadow(true)
        .center()
        .resizable(false)
        .always_on_top(true)
        .visible(true);

        let _ = builder.build();
    }
    if let Some(p) = payload {
        let _ = app.emit("open-download-info-modal", p);
    }
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

#[tauri::command]
pub fn cmd_close_download_dialog(app: AppHandle) -> Result<(), String> {
    if let Ok(mut lock) = LAST_DOWNLOAD_DIALOG_PAYLOAD.lock() {
        *lock = None;
    }
    if let Some(window) = app.get_webview_window("download_dialog") {
        let _ = window.set_always_on_top(false);
        let _ = window.hide();
    }
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
        let mut wide: Vec<u16> = OsStr::new(&clean_path).encode_wide().collect();
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

#[tauri::command]
pub fn cmd_restore_manager_window(app: AppHandle) -> Result<(), String> {
    let window = if let Some(w) = app.get_webview_window("main") {
        w
    } else {
        crate::tray::create_or_show_main_window(&app).map_err(|e| e.to_string())?
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    let _ = crate::tray::refresh_tray_menu(&app);
    let _ = app.emit("refresh-downloads", ());
    Ok(())
}

#[tauri::command]
pub fn cmd_hide_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
        let _ = crate::tray::refresh_tray_menu(&app);
    }
    Ok(())
}

#[tauri::command]
pub fn cmd_open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let clean_path = path.replace('/', "\\");
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &clean_path])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = opener::open(&path);
    }
    Ok(())
}

#[tauri::command]
pub fn cmd_open_file_with(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let clean_path = path.replace('/', "\\");
        std::process::Command::new("rundll32.exe")
            .args(["shell32.dll,OpenAs_RunDLL", &clean_path])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn cmd_open_file_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let clean_path = path.replace('/', "\\");
        std::process::Command::new("explorer.exe")
            .arg(format!("/select,{}", clean_path))
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn show_download_complete<R: tauri::Runtime>(app: &tauri::AppHandle<R>, payload: Option<serde_json::Value>) {
    // Only open dialog if a valid, non-empty download payload exists
    let valid_payload = match payload {
        Some(ref p) => {
            let url = p.get("url").and_then(|u| u.as_str()).unwrap_or("").trim();
            if url.is_empty() {
                return;
            }
            p.clone()
        }
        None => return,
    };

    if let Ok(mut lock) = LAST_DOWNLOAD_COMPLETE_PAYLOAD.lock() {
        *lock = Some(valid_payload.clone());
    }

    if let Some(window) = app.get_webview_window("download_complete") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.center();
        let _ = window.set_always_on_top(true);
        let _ = window.set_focus();
    } else {
        let builder = tauri::WebviewWindowBuilder::new(
            app,
            "download_complete",
            tauri::WebviewUrl::default(),
        )
        .title("Download complete")
        .inner_size(580.0, 320.0)
        .decorations(false)
        .transparent(false)
        .shadow(true)
        .center()
        .resizable(false)
        .always_on_top(true)
        .visible(true);

        let _ = builder.build();
    }
    let _ = app.emit("open-download-complete-modal", &valid_payload);
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
    if let Some(window) = app.get_webview_window("download_complete") {
        let _ = window.set_always_on_top(false);
        let _ = window.hide();
    }
    Ok(())
}

#[tauri::command]
pub async fn cmd_get_patch_notes(state: State<'_, AppState>) -> Result<Vec<crate::db::PatchNoteRecord>, String> {
    state.db.get_all_patch_notes().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_save_patch_note(note: crate::db::PatchNoteRecord, state: State<'_, AppState>) -> Result<(), String> {
    state.db.save_patch_note(&note).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_delete_patch_note(version: String, state: State<'_, AppState>) -> Result<(), String> {
    state.db.delete_patch_note(&version).map_err(|e| e.to_string())
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
        Err("Uninstaller is only available on Windows installations".to_string())
    }
}

#[tauri::command]
pub fn cmd_repair_application(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        let _ = cmd_clean_superseded_old_binaries();

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
$exe = '{exe}'
$dir = '{dir}'

# 1. Wait for parent process to exit
for ($i = 0; $i -lt 30; $i++) {{
    if (-not (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {{ break }}
    Start-Sleep -Milliseconds 100
}}
Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue

# 2. Terminate any lingering background Downex instances
Get-Process -Name "Downex","downex" -ErrorAction SilentlyContinue | Where-Object {{ $_.Id -ne $PID }} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300

# 3. Clean any locks and old files
$old = "$exe.old"
$tmp = "$exe.tmp"
if (Test-Path $old) {{ Remove-Item -Path $old -Force -ErrorAction SilentlyContinue }}
if (Test-Path $tmp) {{ Remove-Item -Path $tmp -Force -ErrorAction SilentlyContinue }}

# 4. Launch clean application
Start-Process -FilePath $exe -WorkingDirectory $dir -ArgumentList "--restarted-after-repair"
"#,
            pid = pid,
            exe = exe_str,
            dir = dir_str
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
        use std::io::Write;
        use std::os::windows::process::CommandExt;

        let base_url = "https://gphost.eu.cc/raw/downex-desktop";
        eprintln!("[Downex Reset] Fetching Base 0.0.0 installer from {}", base_url);

        let response = http_client.get(base_url)
            .send()
            .await
            .map_err(|e| format!("Could not download Base 0.0.0 installer: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Base installer server returned HTTP {}", response.status()));
        }

        let bytes = response.bytes().await.map_err(|e| format!("Failed to read installer payload: {}", e))?;

        if bytes.len() < 1024 * 512 || bytes[0] != b'M' || bytes[1] != b'Z' {
            return Err("Invalid Base installer: missing PE MZ header".to_string());
        }

        let temp_dir = std::env::temp_dir().join("com.downex.manager");
        let _ = std::fs::create_dir_all(&temp_dir);
        let installer_path = temp_dir.join("downex-base-0.0.0-setup.exe");

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
$exe = '{exe}'
$dir = '{dir}'
$installer = '{installer}'

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

# 4. Run Base 0.0.0 Installer in silent mode (/S)
Start-Process -FilePath $installer -ArgumentList "/S" -Wait
Start-Sleep -Milliseconds 1000

# 5. Launch fresh Base 0.0.0 application
Start-Process -FilePath $exe -WorkingDirectory $dir -ArgumentList "--restarted-to-base"
"#,
            pid = pid,
            exe = exe_str,
            dir = dir_str,
            installer = installer_str
        );

        std::fs::write(&reset_script, script_content)
            .map_err(|e| format!("Could not write reset script: {}", e))?;

        // Reset persisted version in registry & sidecar
        crate::version::write_persisted_version(app, db, "0.0.0");

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
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn();

        let app_clone = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(400));
            app_clone.exit(0);
            std::process::exit(0);
        });

        Ok("Base 0.0.0 foundation installer initiated. Downex is restarting...".to_string())
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
