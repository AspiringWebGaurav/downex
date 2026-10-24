use crate::db::DownloadRecord;
use crate::ota::{check_latest_release, ReleaseManifest};
use crate::AppState;
use tauri::{AppHandle, Manager, State};

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
    url: String,
    destination_folder: Option<String>,
    queue_id: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
    start_immediately: Option<bool>,
    state: State<'_, AppState>,
) -> Result<DownloadRecord, String> {
    state
        .queue_manager
        .create_task(
            url,
            destination_folder,
            queue_id,
            headers,
            start_immediately.unwrap_or(true),
            None,
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_pause_download(id: String, state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.queue_manager.pause_task(&id))
}

#[tauri::command]
pub async fn cmd_start_queue(state: State<'_, AppState>) -> Result<usize, String> {
    Ok(state.queue_manager.start_queue().await)
}

#[tauri::command]
pub fn cmd_pause_queue(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.queue_manager.pause_queue())
}

#[tauri::command]
pub fn cmd_is_queue_running(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.queue_manager.is_queue_running())
}

#[tauri::command]
pub fn cmd_queue_download(id: String, state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.queue_manager.queue_download(&id))
}

#[tauri::command]
pub async fn cmd_resume_download(id: String, state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.queue_manager.resume_task(&id).await)
}

#[tauri::command]
pub async fn cmd_cancel_download(id: String, delete_file: bool, state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.queue_manager.cancel_task(&id, delete_file))
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
pub async fn cmd_check_updates(state: State<'_, AppState>) -> Result<Option<ReleaseManifest>, String> {
    let current_version = env!("CARGO_PKG_VERSION");
    check_latest_release(&state.http_client, current_version)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_get_resolved_version(app: AppHandle) -> Result<String, String> {
    Ok(app.package_info().version.to_string())
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

    // 1. Current User Registry (Standard for NSIS currentUser install mode)
    if let Ok((key, _disp)) = hkcu.create_subkey(canonical_subkey) {
        let _ = key.set_value("DisplayVersion", &clean_ver);
        let _ = key.set_value("Version", &clean_ver);
        let _ = key.set_value("VersionMajor", &major);
        let _ = key.set_value("VersionMinor", &minor);

        if key.get_value::<String, _>("DisplayName").is_err() {
            let _ = key.set_value("DisplayName", &"Downex");
            let _ = key.set_value("Publisher", &"Gaurav Patil");
            if let Some(ref exe) = current_exe_str {
                let _ = key.set_value("DisplayIcon", &format!("\"{}\",0", exe));
            }
            if let Some(ref dir) = current_dir {
                let _ = key.set_value("InstallLocation", dir);
            }
        }
        eprintln!("[Downex Registry] Synced HKCU\\{} DisplayVersion to {}", canonical_subkey, clean_ver);
    }

    // 2. App Paths: Register 'downex' for Windows Search and Win+R execution
    if let Some(ref exe) = current_exe_str {
        if let Ok((key, _)) = hkcu.create_subkey(r"Software\Microsoft\Windows\CurrentVersion\App Paths\downex.exe") {
            let _ = key.set_value("", exe);
            if let Some(ref dir) = current_dir {
                let _ = key.set_value("Path", dir);
            }
        }
    }

    // 3. Local Machine Registry (If elevated)
    if let Ok(key) = hklm.open_subkey_with_flags(canonical_subkey, KEY_WRITE) {
        let _ = key.set_value("DisplayVersion", &clean_ver);
        let _ = key.set_value("Version", &clean_ver);
        let _ = key.set_value("VersionMajor", &major);
        let _ = key.set_value("VersionMinor", &minor);
    }
}

#[cfg(not(target_os = "windows"))]
pub fn sync_windows_installed_version(_new_version: &str) {}

#[tauri::command]
pub fn cmd_sync_windows_installed_version(app: AppHandle, version: Option<String>) -> Result<String, String> {
    let ver = version.unwrap_or_else(|| app.package_info().version.to_string());
    sync_windows_installed_version(&ver);
    Ok(ver)
}

#[tauri::command]
pub fn cmd_write_update_staging_file(file_name: String, bytes: Vec<u8>) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use std::io::Write;
        let temp_dir = std::env::temp_dir().join("com.downex.manager");
        let _ = std::fs::create_dir_all(&temp_dir);
        let target_file = temp_dir.join(file_name);
        let mut file = std::fs::File::create(&target_file)
            .map_err(|e| format!("Could not create staging file: {}", e))?;
        file.write_all(&bytes)
            .map_err(|e| format!("Could not write staging file: {}", e))?;
        file.flush()
            .map_err(|e| format!("Could not flush staging file: {}", e))?;
        Ok(target_file.to_string_lossy().to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (file_name, bytes);
        Err("In-process staging is supported on Windows".to_string())
    }
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

        let bytes = if let Some(b) = binary_bytes {
            b
        } else if let Some(ref path_str) = staging_path {
            std::fs::read(path_str)
                .map_err(|e| format!("Could not read staged binary from '{}': {}", path_str, e))?
        } else {
            return Err("Neither binary_bytes nor staging_path was provided".to_string());
        };

        eprintln!("[Downex OTA] Starting in-process atomic shadow swap with {} bytes", bytes.len());

        // Pre-sync Windows Installed Apps registry DisplayVersion
        if let Some(ref ver) = target_version {
            sync_windows_installed_version(ver);
        }

        // 1. Sanity check: payload must not be trivial
        if bytes.len() < 1024 * 512 {
            return Err("Invalid update payload: binary size is unexpectedly small".to_string());
        }

        // 2. Validate Windows PE signature (MZ header)
        if bytes.len() < 2 || bytes[0] != b'M' || bytes[1] != b'Z' {
            return Err("Invalid update payload: missing Windows executable PE header (MZ)".to_string());
        }

        // 3. Resolve currently executing file path
        let current_exe = std::env::current_exe()
            .map_err(|e| format!("Could not resolve current executable path: {}", e))?;

        let parent_dir = current_exe
            .parent()
            .ok_or_else(|| "Could not resolve executable directory".to_string())?;

        let file_name = current_exe
            .file_name()
            .ok_or_else(|| "Could not determine executable name".to_string())?
            .to_string_lossy();

        let old_exe = parent_dir.join(format!("{}.old", file_name));
        let tmp_exe = parent_dir.join(format!("{}.tmp", file_name));

        // Clean any leftover tmp or old file
        if tmp_exe.exists() {
            let _ = std::fs::remove_file(&tmp_exe);
        }
        if old_exe.exists() {
            let _ = std::fs::remove_file(&old_exe);
        }

        // 4. Stage verified binary into temporary staging file first
        {
            let mut file = std::fs::File::create(&tmp_exe)
                .map_err(|e| format!("Could not create staging update file: {}", e))?;
            file.write_all(&bytes)
                .map_err(|e| format!("Could not write update payload: {}", e))?;
            file.flush()
                .map_err(|e| format!("Could not flush update payload to disk: {}", e))?;
        }

        // 5. In-Process NTFS Atomic Shadow Swap:
        // Rename running .exe -> .exe.old
        std::fs::rename(&current_exe, &old_exe)
            .map_err(|e| {
                let _ = std::fs::remove_file(&tmp_exe);
                format!("NTFS rename of running executable failed: {}", e)
            })?;

        // Rename staged .tmp -> .exe
        if let Err(e) = std::fs::rename(&tmp_exe, &current_exe) {
            // Automatic Rollback on failure
            let _ = std::fs::rename(&old_exe, &current_exe);
            let _ = std::fs::remove_file(&tmp_exe);
            return Err(format!("Could not place new executable in-place: {}. Restored existing version.", e));
        }

        // Clean staging file if provided
        if let Some(ref path_str) = staging_path {
            let _ = std::fs::remove_file(path_str);
        }

        eprintln!("[Downex OTA] NTFS Atomic Swap successful! Spawning detached watchdog...");

        // 6. Spawn clean detached Windows launcher:
        //    a) Waits 1s for the current PID to completely terminate (releasing the single-instance mutex)
        //    b) Starts the new executable with foreground flags
        let pid = std::process::id();
        let exe_path = current_exe.to_string_lossy().to_string();

        let restart_cmd = format!(
            "timeout /t 1 /nobreak >nul & start \"\" \"{}\" --restarted-after-update --foreground",
            exe_path
        );

        let spawn_result = std::process::Command::new("cmd.exe")
            .args(["/c", &restart_cmd])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn();

        match spawn_result {
            Ok(_) => {
                eprintln!("[Downex OTA] Restart launcher spawned for PID {}. Terminating current process.", pid);
                for (_label, window) in app.webview_windows() {
                    let _ = window.hide();
                }
                let app_clone = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(150));
                    app_clone.exit(0);
                    std::process::exit(0);
                });
                Ok(())
            }
            Err(e) => {
                // Rollback if detached launcher couldn't spawn
                let _ = std::fs::remove_file(&current_exe);
                let _ = std::fs::rename(&old_exe, &current_exe);
                Err(format!("Could not spawn restart watcher: {}. Restored previous version.", e))
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, binary_bytes, staging_path, target_version);
        Err("In-process atomic swap is supported on Windows".to_string())
    }
}

#[tauri::command]
pub fn cmd_clean_superseded_old_binaries() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        if let Ok(current_exe) = std::env::current_exe() {
            if let Some(parent) = current_exe.parent() {
                if let Some(file_name) = current_exe.file_name() {
                    let old_exe = parent.join(format!("{}.old", file_name.to_string_lossy()));
                    if old_exe.exists() {
                        let _ = std::fs::remove_file(old_exe);
                        return Ok(true);
                    }
                }
            }
        }
        Ok(false)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

#[tauri::command]
pub async fn cmd_minimize_to_background(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| e.to_string())?;
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

#[tauri::command]
pub fn cmd_restore_manager_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_size(tauri::LogicalSize::new(960.0, 640.0));
        let _ = window.center();
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = crate::tray::refresh_tray_menu(&app);
    }
    Ok(())
}

#[tauri::command]
pub fn cmd_hide_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_size(tauri::LogicalSize::new(960.0, 640.0));
        let _ = window.hide();
        let _ = crate::tray::refresh_tray_menu(&app);
    }
    Ok(())
}



