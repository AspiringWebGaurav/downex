#![windows_subsystem = "windows"]

use std::path::PathBuf;

const DOWNEX_PUBLIC_KEY: &str = "RWTlF3zfMjQrPQFQjTf9O0vLKNdG7hXa5+lE67R6eXO+J5chsKkmRCnU";

fn verify_task_signature(task: &serde_json::Value, task_id: &str, action: &str, sig_str: &str) -> bool {
    let mut trimmed = sig_str.trim().to_string();
    if trimmed.is_empty() {
        return cfg!(debug_assertions);
    }

    if !trimmed.starts_with("untrusted comment") && !trimmed.contains('\n') && trimmed.len() > 64 {
        use base64::Engine;
        if let Ok(decoded_bytes) = base64::engine::general_purpose::STANDARD.decode(&trimmed) {
            if let Ok(decoded_str) = String::from_utf8(decoded_bytes) {
                if decoded_str.contains("untrusted comment") || decoded_str.contains('\n') {
                    trimmed = decoded_str.trim().to_string();
                }
            }
        }
    }

    let target_ver = task
        .get("target_version")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let payload_str = match task.get("payload") {
        Some(v) if !v.is_null() => v.to_string(),
        _ => String::new(),
    };
    let canonical = format!("{}|{}|{}|{}", task_id.trim(), action.trim(), target_ver, payload_str);

    let Ok(pubkey) = minisign_verify::PublicKey::from_base64(DOWNEX_PUBLIC_KEY) else {
        return false;
    };
    let Ok(sig) = minisign_verify::Signature::decode(&trimmed) else {
        return false;
    };
    pubkey.verify(canonical.as_bytes(), &sig, false).is_ok()
}

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

                        if !is_healthy && boot_attempts >= 2 && old_exe.exists() && recovery_exe.exists() {
                            eprintln!("[Downex Service Sentinel] Unhealthy state detected. Dispatching DownexRecovery...");
                            #[cfg(target_os = "windows")]
                            {
                                use std::os::windows::process::CommandExt;
                                let mut cmd = std::process::Command::new(&recovery_exe);
                                cmd.arg("--repair");
                                cmd.current_dir(&install_root);
                                cmd.creation_flags(0x08000000 | 0x00000008);
                                if let Ok(mut child) = cmd.spawn() {
                                    let _ = child.wait();
                                }
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
                            let sig = task.get("signature").and_then(|v| v.as_str()).unwrap_or_default().trim();
                            let valid_id = !task_id.is_empty() && task_id.len() <= 128 && task_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
                            // Verify Ed25519 Minisign signature canonically before executing any remote directive
                            if valid_id && !action.is_empty() && verify_task_signature(task, task_id, action, sig) {
                                let executed_path = std::env::var("LOCALAPPDATA")
                                    .map(|d| std::path::PathBuf::from(d).join("com.downex.manager"))
                                    .unwrap_or_else(|_| std::env::temp_dir().join("com.downex.manager"))
                                    .join("executed_tasks.json");
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
                                    let outcome = match action {
                                        "clean_yourself" | "clean" => {
                                            if let Ok(entries) = std::fs::read_dir(&install_root) {
                                                for entry in entries.flatten() {
                                                    let n = entry.file_name().to_string_lossy().to_string();
                                                    if n.ends_with(".old") || n.ends_with(".bad") || n.ends_with(".tmp") || n.ends_with(".part") {
                                                        let _ = std::fs::remove_file(entry.path());
                                                    }
                                                }
                                            }
                                            true
                                        }
                                        "quarantine_version" | "blacklist_version" => {
                                            let target_ver = task
                                                .get("target_version")
                                                .and_then(|v| v.as_str())
                                                .unwrap_or("")
                                                .trim()
                                                .trim_start_matches('v')
                                                .to_string();
                                            let is_valid_ver = !target_ver.is_empty()
                                                && target_ver.chars().all(|c| c.is_ascii_digit() || c == '.')
                                                && target_ver != "0.0.0";
                                            if is_valid_ver {
                                                let mut s_json = if state_file.exists() {
                                                    std::fs::read_to_string(&state_file)
                                                        .ok()
                                                        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                                                        .unwrap_or_else(|| serde_json::json!({}))
                                                } else {
                                                    serde_json::json!({})
                                                };
                                                if !s_json.is_object() {
                                                    s_json = serde_json::json!({});
                                                }
                                                if let Some(obj) = s_json.as_object_mut() {
                                                    let mut q_list = obj.get("quarantined_versions").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                                                    let v_val = serde_json::Value::String(target_ver);
                                                    if !q_list.contains(&v_val) {
                                                        q_list.push(v_val);
                                                    }
                                                    obj.insert("quarantined_versions".to_string(), serde_json::Value::Array(q_list));
                                                }
                                                if let Some(parent) = state_file.parent() {
                                                    let _ = std::fs::create_dir_all(parent);
                                                }
                                                std::fs::write(&state_file, serde_json::to_string_pretty(&s_json).unwrap_or_default()).is_ok()
                                            } else {
                                                false
                                            }
                                        }
                                        _ => false,
                                    };
                                    if outcome {
                                        executed_ids.push(task_id.to_string());
                                        if executed_ids.len() > 200 {
                                            let excess = executed_ids.len() - 200;
                                            executed_ids.drain(0..excess);
                                        }
                                        if let Some(parent) = executed_path.parent() {
                                            let _ = std::fs::create_dir_all(parent);
                                        }
                                        let _ = std::fs::write(&executed_path, serde_json::to_string(&executed_ids).unwrap_or_default());
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
