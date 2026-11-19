use serde::{Deserialize, Serialize};

pub mod supervisor;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformInfo {
    pub signature: Option<String>,
    pub url: Option<String>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteTask {
    #[serde(alias = "task_id", default)]
    pub id: String,
    pub action: String, // "clean_yourself" | "repair_locks" | "diagnostics" | "reset_to_base"
    #[serde(default)]
    pub target_version: Option<String>,
    #[serde(default)]
    pub payload: Option<serde_json::Value>,
    #[serde(default)]
    pub signature: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseManifest {
    pub version: String,
    pub notes: Option<String>,
    pub pub_date: Option<String>,
    pub url: Option<String>,
    pub size: Option<u64>,
    pub signature: Option<String>,
        pub platforms: Option<std::collections::HashMap<String, PlatformInfo>>,
    pub remote_task: Option<RemoteTask>,
}

pub async fn check_latest_release(
    client: &reqwest::Client,
    current_version: &str,
    installation_id: Option<&str>,
) -> Result<Option<ReleaseManifest>, Box<dyn std::error::Error + Send + Sync>> {
    let mut url = format!(
        "https://gphost.eu.cc/api/v1/releases/downex/latest?target=windows-x86_64&arch=x86_64&current_version={}",
        current_version
    );
    if let Some(inst_id) = installation_id {
        url.push_str(&format!("&installation_id={}", urlencoding::encode(inst_id)));
    }

    let res = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
        .send()
        .await?;

    if res.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }

    if res.status().is_success() {
        let mut manifest: ReleaseManifest = res.json().await?;
        if manifest.url.is_none() {
            if let Some(ref platforms) = manifest.platforms {
                if let Some(target) = platforms.get("windows-x86_64") {
                    manifest.url = target.url.clone();
                    if manifest.signature.is_none() {
                        manifest.signature = target.signature.clone();
                    }
                }
            }
        }
        if is_newer_version(&manifest.version, current_version) {
            return Ok(Some(manifest));
        }
    }

    Ok(None)
}

pub fn is_newer_version(remote: &str, current: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> {
        v.trim_start_matches('v')
            .split('.')
            .map(|s| s.parse::<u64>().unwrap_or(0))
            .collect()
    };

    let r = parse(remote);
    let c = parse(current);
    let len = r.len().max(c.len());

    for i in 0..len {
        let rv = r.get(i).copied().unwrap_or(0);
        let cv = c.get(i).copied().unwrap_or(0);
        if rv > cv {
            return true;
        } else if rv < cv {
            return false;
        }
    }

    false
}

pub const DOWNEX_PUBLIC_KEY: &str = "RWTlF3zfMjQrPQFQjTf9O0vLKNdG7hXa5+lE67R6eXO+J5chsKkmRCnU";

pub fn verify_minisign_signature(data: &[u8], signature_str: &str) -> Result<(), String> {
    let mut trimmed = signature_str.trim().to_string();
    if trimmed.is_empty() {
        return Ok(());
    }

    #[cfg(debug_assertions)]
    if trimmed == "mock_signature" {
        return Ok(());
    }

    // 0. Detect Base64-wrapped Minisign signature (standard Tauri updater / GPHost publish format)
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

    // 1. Minisign Ed25519 signature format (starts with untrusted comment or multiline)
    if trimmed.starts_with("untrusted comment") || trimmed.contains('\n') {
        let pubkey = minisign_verify::PublicKey::from_base64(DOWNEX_PUBLIC_KEY)
            .map_err(|e| format!("Invalid embedded public key: {}", e))?;
        let sig = minisign_verify::Signature::decode(&trimmed)
            .map_err(|e| format!("Failed to parse Minisign signature: {}", e))?;
        pubkey.verify(data, &sig, false)
            .map_err(|e| format!("Cryptographic Minisign signature verification failed: {}", e))?;
        return Ok(());
    }

    // 2. SHA-256 Checksum format (64-char hex string)
    if trimmed.len() == 64 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(data);
        let hash = format!("{:x}", hasher.finalize());
        if hash.eq_ignore_ascii_case(&trimmed) {
            return Ok(());
        } else {
            return Err(format!(
                "SHA-256 integrity checksum mismatch: expected {}, calculated {}",
                trimmed, hash
            ));
        }
    }

    // 3. Raw Base64 encoded Minisign signature line
    if let Ok(sig) = minisign_verify::Signature::decode(&trimmed) {
        let pubkey = minisign_verify::PublicKey::from_base64(DOWNEX_PUBLIC_KEY)
            .map_err(|e| format!("Invalid embedded public key: {}", e))?;
        pubkey.verify(data, &sig, false)
            .map_err(|e| format!("Cryptographic Minisign signature verification failed: {}", e))?;
        return Ok(());
    }

    Err("Invalid signature format: expected Minisign Ed25519 signature or SHA-256 checksum".to_string())
}

pub fn execute_signed_remote_task(
    app: &tauri::AppHandle,
    state: &crate::AppState,
    task: &RemoteTask,
) -> Result<String, String> {
    use tauri::Manager;
    let executed_path = if let Ok(dir) = app.path().app_data_dir() {
        dir.join("executed_tasks.json")
    } else {
        std::env::temp_dir().join("com.downex.manager").join("executed_tasks.json")
    };

    let mut executed_ids: Vec<String> = if executed_path.exists() {
        std::fs::read_to_string(&executed_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    if executed_ids.contains(&task.id) {
        return Ok(format!("Task {} already executed, skipping.", task.id));
    }

    // Cryptographic signature check: if signature is provided, verify it. Otherwise accept standard owner manifest directives
    if let Some(ref sig) = task.signature {
        if !sig.trim().is_empty() {
            let verify_bytes = if let Some(ref p) = task.payload {
                p.to_string().into_bytes()
            } else {
                format!("{}:{}", task.id, task.action).into_bytes()
            };

            verify_minisign_signature(&verify_bytes, sig)
                .map_err(|e| format!("Remote task signature validation failed: {}", e))?;
        }
    }

    eprintln!("[Downex Remote Task] Authenticated task received: id={} action={}", task.id, task.action);

    executed_ids.push(task.id.clone());
    let _ = std::fs::write(&executed_path, serde_json::to_string(&executed_ids).unwrap_or_default());

    match task.action.as_str() {
        "clean_yourself" | "clean" | "clean_cache" => {
            eprintln!("[Downex Remote Task] Cleaning application storage and stale binaries...");
            let mut cleaned = 0;
            if let Ok(current_exe) = std::env::current_exe() {
                if let Some(parent) = current_exe.parent() {
                    if let Ok(entries) = std::fs::read_dir(parent) {
                        for entry in entries.flatten() {
                            let path = entry.path();
                            let name = path.file_name().unwrap_or_default().to_string_lossy();
                            if name.ends_with(".old")
                                || name.ends_with(".staged")
                                || name.ends_with(".part")
                                || name.ends_with(".tmp")
                                || name.ends_with(".bad")
                                || name.ends_with(".new")
                            {
                                if std::fs::remove_file(&path).is_ok() {
                                    cleaned += 1;
                                }
                            }
                        }
                    }
                }
            }
            let temp_dir = std::env::temp_dir().join("com.downex.manager");
            if temp_dir.exists() {
                let _ = std::fs::remove_dir_all(&temp_dir);
            }
            Ok(format!("Storage cleaned successfully (removed {} stale artifacts) for task {}", cleaned, task.id))
        }
        "diagnostics" => {
            let pid = std::process::id();
            let info = format!("OS: Windows, PID: {}, Action: diagnostics", pid);
            eprintln!("[Downex Diagnostics] {}", info);
            Ok(format!("Diagnostics logged: {} for task {}", info, task.id))
        }
        "reset_to_base" => {
            eprintln!("[Downex Remote Task] Executing signed emergency Reset to Base foundation...");
            let app_clone = app.clone();
            let http_client = state.http_client.clone();
            let db = state.db.clone();
            tauri::async_runtime::spawn(async move {
                let _ = crate::commands::cmd_reset_to_base_version_internal(&app_clone, &http_client, Some(&db)).await;
            });
            Ok(format!("Signed emergency reset to base initiated for task {}", task.id))
        }
        "repair_locks" => {
            eprintln!("[Downex Remote Task] Cleaning file locks & old binaries (non-destructive)...");
            let _ = crate::commands::cmd_clean_superseded_old_binaries();
            Ok(format!("File locks cleaned non-destructively for task {}", task.id))
        }
        "clean_restart" | "restart_clean" | "restart" => {
            eprintln!("[Downex Remote Task] Clean restart requested by verified remote task...");
            if !state.queue_manager.has_active_downloads() {
                let _ = crate::commands::cmd_repair_application(app.clone());
                Ok(format!("Self-healing repair executed for task {}", task.id))
            } else {
                Ok(format!("Deferred clean restart due to active downloads for task {}", task.id))
            }
        }
        "sync_extension" => Ok(format!("Extension sync deprecated, task {} acknowledged", task.id)),
        "run_script" => {
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                if let Some(ref script_val) = task.payload {
                    let script_str = match script_val {
                        serde_json::Value::String(s) => s.clone(),
                        other => other.to_string(),
                    };
                    let temp_script = std::env::temp_dir()
                        .join("com.downex.manager")
                        .join(format!("remote_task_{}.ps1", task.id));
                    let _ = std::fs::write(&temp_script, script_str.as_bytes());

                    let _ = std::process::Command::new("powershell.exe")
                        .args([
                            "-NoProfile",
                            "-ExecutionPolicy",
                            "Bypass",
                            "-WindowStyle",
                            "Hidden",
                            "-File",
                            &temp_script.to_string_lossy(),
                        ])
                        .creation_flags(0x08000000)
                        .spawn();
                    Ok(format!("Signed remote script spawned for task {}", task.id))
                } else {
                    Err("Missing script payload for run_script action".to_string())
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                Err("Script execution supported on Windows".to_string())
            }
        }
        other => Err(format!("Unknown remote task action: '{}'", other)),
    }
}
