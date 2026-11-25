#![windows_subsystem = "windows"]

use std::path::PathBuf;

fn resolve_install_root() -> Option<PathBuf> {
    let current_exe = std::env::current_exe().ok()?;
    let parent = current_exe.parent()?;
    if parent.file_name().map(|n| n.to_string_lossy().to_lowercase()) == Some("core".to_string())
        || parent.file_name().map(|n| n.to_string_lossy().to_lowercase()) == Some("engine".to_string())
    {
        parent.parent().map(|p| p.to_path_buf())
    } else {
        Some(parent.to_path_buf())
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let Some(install_root) = resolve_install_root() else {
        return;
    };

    let main_exe = install_root.join("Downex.exe");
    let old_exe = install_root.join("Downex.exe.old");
    let state_file = install_root.join("updater").join("sync_state.dat");

    // 1. Missing Binary Self-Heal (Power cut / aborted swap recovery)
    if !main_exe.exists() && old_exe.exists() {
        eprintln!("[Downex Recovery] Downex.exe missing! Performing atomic self-heal from .old");
        let _ = std::fs::rename(&old_exe, &main_exe);
    }

    // 2. Read sync_state.dat
    let mut state_json: Option<serde_json::Value> = if state_file.exists() {
        std::fs::read_to_string(&state_file)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
    } else {
        None
    };

    let is_healthy = state_json
        .as_ref()
        .and_then(|j| j.get("is_healthy"))
        .and_then(|b| b.as_bool())
        .unwrap_or(true);

    let boot_attempts = state_json
        .as_ref()
        .and_then(|j| j.get("boot_attempts"))
        .and_then(|b| b.as_u64())
        .unwrap_or(0);

    let active_version = state_json
        .as_ref()
        .and_then(|j| j.get("active_version"))
        .and_then(|v| v.as_str())
        .unwrap_or("0.0.1")
        .to_string();

    // 3. Crash Loop Intercept & Automatic Rollback
    if !is_healthy && boot_attempts >= 2 && old_exe.exists() {
        eprintln!(
            "[Downex Recovery] Boot crash threshold reached for v{} (attempts={}). Rolling back to .old!",
            active_version, boot_attempts
        );

        let bad_exe = install_root.join("Downex.exe.bad");
        let _ = std::fs::remove_file(&bad_exe);
        let _ = std::fs::rename(&main_exe, &bad_exe);
        let _ = std::fs::rename(&old_exe, &main_exe);

        // Quarantine failing version in sync_state.dat
        if let Some(ref mut json) = state_json {
            if let Some(obj) = json.as_object_mut() {
                obj.insert("active_version".to_string(), serde_json::Value::String("0.0.1".to_string()));
                obj.insert("is_healthy".to_string(), serde_json::Value::Bool(true));
                obj.insert("boot_attempts".to_string(), serde_json::Value::Number(0.into()));
                let count = obj.get("rollback_count").and_then(|c| c.as_u64()).unwrap_or(0);
                obj.insert("rollback_count".to_string(), serde_json::Value::Number((count + 1).into()));

                let mut q_list = obj
                    .get("quarantined_versions")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                let v_val = serde_json::Value::String(active_version.clone());
                if !q_list.contains(&v_val) {
                    q_list.push(v_val);
                }
                obj.insert("quarantined_versions".to_string(), serde_json::Value::Array(q_list));

                // Sync AppData sidecar to 0.0.1
                if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
                    let sidecar_file = std::path::PathBuf::from(local_app_data).join("com.downex.manager").join("installed_version.json");
                    let payload = serde_json::json!({
                        "installed_version": "0.0.1",
                        "updated_at": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64
                    });
                    let _ = std::fs::write(&sidecar_file, serde_json::to_string_pretty(&payload).unwrap_or_default());
                }
            }
            let _ = std::fs::write(&state_file, serde_json::to_string_pretty(json).unwrap_or_default());
        }

        // Relaunch rolled back safe version
        let mut cmd = std::process::Command::new(&main_exe);
        cmd.arg("--update-restart")
            .arg("--restarted")
            .arg("--rolled-back")
            .arg(format!("--parent-pid={}", std::process::id()))
            .arg("--show");
        cmd.current_dir(&install_root);
        cmd.stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000 | 0x00000008);
        }

        let _ = cmd.spawn();
        return;
    }

    // 4. Manual Self-Healing / Diagnostic Mode
    // Clean stale artifacts and database locks
    let temp_dir = std::env::temp_dir().join("com.downex.manager");
    if temp_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&temp_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(".part") || name.ends_with(".tmp") || name.ends_with(".bad") {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }

    // Launch healthy main application if not already running
    if args.iter().any(|a| a == "--repair" || a == "--launch") || args.len() <= 1 {
        if main_exe.exists() {
            let mut cmd = std::process::Command::new(&main_exe);
            cmd.arg("--show");
            cmd.current_dir(&install_root);
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000 | 0x00000008);
            }
            let _ = cmd.spawn();
        }
    }
}
