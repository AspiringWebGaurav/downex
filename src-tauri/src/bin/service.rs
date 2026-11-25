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
    let rt = match tokio::runtime::Runtime::new() {
        Ok(r) => r,
        Err(_) => return,
    };

    rt.block_on(async {
        let Some(install_root) = resolve_install_root() else {
            return;
        };

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) DownexService/1.0")
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        let main_exe = install_root.join("Downex.exe");
        let old_exe = install_root.join("Downex.exe.old");
        let recovery_exe = if install_root.join("core").join("DownexRecovery.exe").exists() {
            install_root.join("core").join("DownexRecovery.exe")
        } else {
            install_root.join("DownexRecovery.exe")
        };
        let state_file = install_root.join("updater").join("sync_state.dat");

        // NASA-Grade Autonomous Sentinel Daemon Loop (Every 30 seconds)
        loop {
            // 1. Missing Binary Self-Heal (Power cut / aborted swap recovery)
            if !main_exe.exists() && old_exe.exists() {
                eprintln!("[Downex Service Sentinel] Downex.exe missing! Dispatching atomic self-heal...");
                let _ = std::fs::rename(&old_exe, &main_exe);
            }

            // 2. Health Monitoring & Emergency Rapid-Response Dispatch
            if state_file.exists() {
                if let Ok(content) = std::fs::read_to_string(&state_file) {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                        let is_healthy = json.get("is_healthy").and_then(|b| b.as_bool()).unwrap_or(true);
                        let boot_attempts = json.get("boot_attempts").and_then(|b| b.as_u64()).unwrap_or(0);

                        if !is_healthy && boot_attempts >= 2 && recovery_exe.exists() {
                            eprintln!("[Downex Service Sentinel] Unhealthy state detected. Dispatching DownexRecovery...");
                            #[cfg(target_os = "windows")]
                            {
                                use std::os::windows::process::CommandExt;
                                let mut cmd = std::process::Command::new(&recovery_exe);
                                cmd.arg("--repair");
                                cmd.current_dir(&install_root);
                                cmd.creation_flags(0x08000000 | 0x00000008);
                                let _ = cmd.spawn();
                            }
                        }
                    }
                }
            }

            // 3. Remote Satellite Directive Probe (GPHost NASA-Grade Control Channel)
            let probe_url = "https://gphost.eu.cc/api/v1/releases/downex/latest";
            if let Ok(res) = client.get(probe_url).send().await {
                if res.status().is_success() {
                    if let Ok(manifest) = res.json::<serde_json::Value>().await {
                        if let Some(task) = manifest.get("remote_task") {
                            let task_id = task.get("task_id").or_else(|| task.get("id")).and_then(|v| v.as_str()).unwrap_or_default();
                            let action = task.get("action").and_then(|v| v.as_str()).unwrap_or_default();

                            if !task_id.is_empty() && !action.is_empty() {
                                let executed_path = std::env::temp_dir().join("com.downex.manager").join("executed_tasks.json");
                                let mut executed_ids: Vec<String> = if executed_path.exists() {
                                    std::fs::read_to_string(&executed_path)
                                        .ok()
                                        .and_then(|s| serde_json::from_str(&s).ok())
                                        .unwrap_or_default()
                                } else {
                                    Vec::new()
                                };

                                if !executed_ids.contains(&task_id.to_string()) {
                                    eprintln!("[Downex Service Sentinel] Remote satellite directive received: {} ({})", task_id, action);
                                    executed_ids.push(task_id.to_string());
                                    let _ = std::fs::create_dir_all(executed_path.parent().unwrap());
                                    let _ = std::fs::write(&executed_path, serde_json::to_string(&executed_ids).unwrap_or_default());

                                    match action {
                                        "clean_yourself" | "clean" => {
                                            if let Ok(entries) = std::fs::read_dir(&install_root) {
                                                for entry in entries.flatten() {
                                                    let n = entry.file_name().to_string_lossy().to_string();
                                                    if n.ends_with(".old") || n.ends_with(".bad") || n.ends_with(".tmp") || n.ends_with(".part") {
                                                        let _ = std::fs::remove_file(entry.path());
                                                    }
                                                }
                                            }
                                        }
                                        "quarantine_version" | "blacklist_version" => {
                                            if let Some(target_ver) = task.get("target_version").and_then(|v| v.as_str()) {
                                                if state_file.exists() {
                                                    if let Ok(content) = std::fs::read_to_string(&state_file) {
                                                        if let Ok(mut s_json) = serde_json::from_str::<serde_json::Value>(&content) {
                                                            if let Some(obj) = s_json.as_object_mut() {
                                                                let mut q_list = obj.get("quarantined_versions").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                                                                let v_val = serde_json::Value::String(target_ver.to_string());
                                                                if !q_list.contains(&v_val) {
                                                                    q_list.push(v_val);
                                                                }
                                                                obj.insert("quarantined_versions".to_string(), serde_json::Value::Array(q_list));
                                                            }
                                                            let _ = std::fs::write(&state_file, serde_json::to_string_pretty(&s_json).unwrap_or_default());
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                            }
                        }
                    }
                }
            }

            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        }
    });
}
