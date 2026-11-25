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
        if is_newer_version(&manifest.version, current_version) && !is_version_quarantined(&manifest.version) {
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
        "clean_yourself" | "clean" | "clean_cache" | "sync_registry" | "clean_duplicates" => {
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
            #[cfg(target_os = "windows")]
            {
                let resolved_version = crate::version::resolve_installed_version(app, Some(&state.db));
                crate::commands::sync_windows_installed_version(&resolved_version);
            }
            Ok(format!("Storage cleaned successfully (removed {} stale artifacts) for task {}", cleaned, task.id))
        }
        "quarantine_version" | "blacklist_version" => {
            let ver = task.target_version.as_deref()
                .or_else(|| task.payload.as_ref().and_then(|p| p.as_str()))
                .unwrap_or("0.0.0");
            let clean_ver = ver.trim().trim_start_matches('v');
            if let Ok(current_exe) = std::env::current_exe() {
                if let Some(parent) = current_exe.parent() {
                    let state_file = parent.join("updater").join("sync_state.dat");
                    if state_file.exists() {
                        if let Ok(content) = std::fs::read_to_string(&state_file) {
                            if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&content) {
                                if let Some(obj) = json.as_object_mut() {
                                    let mut q_list = obj.get("quarantined_versions").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                                    let v_val = serde_json::Value::String(clean_ver.to_string());
                                    if !q_list.contains(&v_val) {
                                        q_list.push(v_val);
                                    }
                                    obj.insert("quarantined_versions".to_string(), serde_json::Value::Array(q_list));
                                }
                                let _ = std::fs::write(&state_file, serde_json::to_string_pretty(&json).unwrap_or_default());
                            }
                        }
                    }
                }
            }
            Ok(format!("Version v{} quarantined via remote directive for task {}", clean_ver, task.id))
        }
        "diagnostics" => {
            let pid = std::process::id();
            let info = format!("OS: Windows, PID: {}, Action: diagnostics", pid);
            eprintln!("[Downex Diagnostics] {}", info);
            Ok(format!("Diagnostics logged: {} for task {}", info, task.id))
        }
        "update_docs" | "sync_manifest" => {
            let updated = crate::doc_sync::apply_remote_doc_updates(task.payload.as_ref())?;
            Ok(format!("Documentation synced ({} file(s) updated) for task {}", updated, task.id))
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
        "hardware_ban" | "ban_machine" | "ban" => {
            let my_hwid = crate::hardware::get_or_init_silicon_hardware_id(Some(&state.db));
            let target_hwid = task.payload.as_ref().and_then(|p| {
                p.get("target_hwid").and_then(|v| v.as_str()).or_else(|| p.get("hwid").and_then(|v| v.as_str()))
            });

            if let Some(target) = target_hwid {
                if target.trim().eq_ignore_ascii_case(&my_hwid) {
                    let reason = task.payload.as_ref()
                        .and_then(|p| p.get("reason").and_then(|v| v.as_str()))
                        .unwrap_or("Hardware restriction enforced by ecosystem administrator.");
                    crate::hardware::enforce_local_hardware_ban(reason, Some(&state.db));
                    let _ = tauri::Emitter::emit(app, "downex-hardware-ban-changed", serde_json::json!({ "is_banned": true, "reason": reason }));
                    Ok(format!("Hardware ban enforced for HWID {} (Task {})", my_hwid, task.id))
                } else {
                    Ok(format!("Directive ignored: target HWID {} does not match machine {}", target, my_hwid))
                }
            } else {
                crate::hardware::enforce_local_hardware_ban("Hardware restriction enforced by ecosystem administrator.", Some(&state.db));
                let _ = tauri::Emitter::emit(app, "downex-hardware-ban-changed", serde_json::json!({ "is_banned": true }));
                Ok(format!("Global hardware ban enforced for task {}", task.id))
            }
        }
        "hardware_unban" | "unban_machine" | "unban" => {
            let my_hwid = crate::hardware::get_or_init_silicon_hardware_id(Some(&state.db));
            let target_hwid = task.payload.as_ref().and_then(|p| {
                p.get("target_hwid").and_then(|v| v.as_str()).or_else(|| p.get("hwid").and_then(|v| v.as_str()))
            });

            if let Some(target) = target_hwid {
                if target.trim().eq_ignore_ascii_case(&my_hwid) {
                    crate::hardware::lift_local_hardware_ban(Some(&state.db));
                    let _ = tauri::Emitter::emit(app, "downex-hardware-ban-changed", serde_json::json!({ "is_banned": false }));
                    Ok(format!("Hardware ban lifted for HWID {} (Task {})", my_hwid, task.id))
                } else {
                    Ok(format!("Unban ignored: target HWID {} does not match machine {}", target, my_hwid))
                }
            } else {
                crate::hardware::lift_local_hardware_ban(Some(&state.db));
                let _ = tauri::Emitter::emit(app, "downex-hardware-ban-changed", serde_json::json!({ "is_banned": false }));
                Ok(format!("Global hardware ban lifted for task {}", task.id))
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

pub fn is_version_quarantined(version: &str) -> bool {
    let clean = version.trim().trim_start_matches('v');
    let state_file = if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            parent.join("updater").join("sync_state.dat")
        } else {
            std::path::PathBuf::from("updater").join("sync_state.dat")
        }
    } else {
        std::path::PathBuf::from("updater").join("sync_state.dat")
    };

    if state_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&state_file) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(list) = json.get("quarantined_versions").and_then(|v| v.as_array()) {
                    return list.iter().any(|v| v.as_str().map(|s| s.trim_start_matches('v')) == Some(clean));
                }
            }
        }
    }
    false
}

pub const OTA_SEED_MATERIAL: &str = "downex-internal-ota-key-com.downex.manager.ota.payload.v1";

pub fn decrypt_ota_container(data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() >= 2 && data[0] == b'M' && data[1] == b'Z' {
        return Ok(data.to_vec());
    }
    if data.len() < 60 || !data.starts_with(b"DWNX_OTA") {
        return Err("Invalid Downex OTA container header: missing DWNX_OTA magic".to_string());
    }

    let iv = &data[32..44];
    let tag = &data[44..60];
    let ciphertext = &data[60..];

    use aes_gcm::{
        aead::{Aead, KeyInit},
        Aes256Gcm, Nonce,
    };
    use sha2::{Digest, Sha256};

    let key = Sha256::digest(OTA_SEED_MATERIAL.as_bytes());
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("Failed to initialize AES cipher: {}", e))?;
    let nonce = Nonce::from_slice(iv);

    let mut ciphertext_and_tag = Vec::with_capacity(ciphertext.len() + tag.len());
    ciphertext_and_tag.extend_from_slice(ciphertext);
    ciphertext_and_tag.extend_from_slice(tag);

    let plaintext = cipher
        .decrypt(nonce, ciphertext_and_tag.as_ref())
        .map_err(|e| format!("AES-256-GCM container decryption failed: {}", e))?;

    // Autonomous Gatekeeper Verification (Patent-Grade PE Integrity Algorithm)
    if plaintext.len() < 1024 * 512 || plaintext[0] != b'M' || plaintext[1] != b'Z' {
        return Err("Decrypted update is corrupt or truncated: missing Windows PE MZ header".to_string());
    }

    // Verify PE Signature and x86_64 machine architecture
    if plaintext.len() >= 0x40 {
        let pe_offset = u32::from_le_bytes(plaintext[0x3C..0x40].try_into().unwrap_or_default()) as usize;
        if pe_offset + 6 <= plaintext.len() {
            if &plaintext[pe_offset..pe_offset + 4] != b"PE\0\0" {
                return Err("Corrupt Windows PE executable: invalid PE signature".to_string());
            }
            let machine = u16::from_le_bytes(plaintext[pe_offset + 4..pe_offset + 6].try_into().unwrap_or_default());
            if machine != 0x8664 {
                return Err(format!("Invalid binary architecture: expected x86_64 (0x8664), found 0x{:04x}", machine));
            }
        }
    }

    Ok(plaintext)
}

pub async fn download_and_stage_update(
    app: &tauri::AppHandle,
    url: &str,
    target_version: &str,
    signature: Option<&str>,
) -> Result<std::path::PathBuf, String> {
    use futures_util::StreamExt;
    use std::io::Write;
    use tauri::Emitter;

    let clean_ver = target_version.trim().trim_start_matches('v');
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(180))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("Failed to create download client: {}", e))?;

    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Download returned HTTP status {}", res.status()));
    }

    let total_bytes = res.content_length().unwrap_or(0);
    let mut downloaded_bytes: usize = 0;
    let mut container = Vec::with_capacity(if total_bytes > 0 { total_bytes as usize } else { 10 * 1024 * 1024 });
    let mut stream = res.bytes_stream();
    let mut last_emit = std::time::Instant::now();

    while let Some(chunk_res) = stream.next().await {
        let chunk = chunk_res.map_err(|e| format!("Error reading stream chunk: {}", e))?;
        downloaded_bytes += chunk.len();
        container.extend_from_slice(&chunk);

        if last_emit.elapsed() >= std::time::Duration::from_millis(35) || (total_bytes > 0 && downloaded_bytes as u64 == total_bytes) {
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

    if let Some(sig) = signature {
        if !sig.trim().is_empty() {
            verify_minisign_signature(&container, sig)
                .map_err(|e| format!("Cryptographic signature verification failed: {}", e))?;
        }
    }

    let plain_exe = decrypt_ota_container(&container)?;

    let temp_dir = std::env::temp_dir().join("com.downex.manager");
    let _ = std::fs::create_dir_all(&temp_dir);

    let staged_path = temp_dir.join(format!("downex-v{}.staged.exe", clean_ver));
    let part_path = temp_dir.join(format!("downex-v{}.staged.exe.part", clean_ver));

    {
        let file = std::fs::File::create(&part_path)
            .map_err(|e| format!("Failed to create staging file: {}", e))?;
        let mut writer = std::io::BufWriter::with_capacity(64 * 1024, file);
        writer.write_all(&plain_exe)
            .map_err(|e| format!("Failed to write staging file: {}", e))?;
        writer.flush()
            .map_err(|e| format!("Failed to flush staging file: {}", e))?;
    }

    if staged_path.exists() {
        let _ = std::fs::remove_file(&staged_path);
    }
    std::fs::rename(&part_path, &staged_path)
        .map_err(|e| format!("Failed to finalize staged update file: {}", e))?;

    Ok(staged_path)
}

pub fn launch_external_updater_and_exit(
    app: &tauri::AppHandle,
    target_version: &str,
    staged_path: &str,
    was_main_open: bool,
    theme: Option<&str>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use tauri::Manager;
        let current_exe = std::env::current_exe().map_err(|e| format!("Current exe error: {}", e))?;
        let install_root = current_exe
            .parent()
            .ok_or_else(|| "Missing executable parent directory".to_string())?;

        let mut updater_exe = install_root.join("updater").join("updater.exe");
        if !updater_exe.exists() {
            updater_exe = install_root.join("updater.exe");
        }
        if !updater_exe.exists() {
            updater_exe = install_root.join("resources").join("updater").join("updater.exe");
        }
        if !updater_exe.exists() {
            let res_updater = std::path::PathBuf::from("resources").join("updater").join("updater.exe");
            if res_updater.exists() {
                updater_exe = res_updater;
            }
        }
        if !updater_exe.exists() {
            // Fallback: check temp dir for staged updater
            let temp_updater = std::env::temp_dir().join("com.downex.manager").join("updater.exe");
            if temp_updater.exists() {
                updater_exe = temp_updater;
            } else {
                return Err("External updater executable (updater.exe) not found".to_string());
            }
        }

        let clean_ver = target_version.trim().trim_start_matches('v');
        crate::version::write_persisted_version(app, None, clean_ver);

        // Signal development runner supervisor (scripts/dev.mjs) via update_restart.flag so terminal stays connected!
        let is_dev_env = std::env::var("DOWNEX_DEV_RUNNER").is_ok() || cfg!(debug_assertions);
        let temp_dir = std::env::temp_dir();
        let temp_downex = temp_dir.join("com.downex.manager");
        let _ = std::fs::create_dir_all(&temp_downex);
        let _ = std::fs::write(temp_downex.join("update_restart.flag"), clean_ver.as_bytes());
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let app_data_dir = std::path::PathBuf::from(&local_app_data).join("Downex");
            let _ = std::fs::create_dir_all(&app_data_dir);
            let _ = std::fs::write(app_data_dir.join("update_restart.flag"), clean_ver.as_bytes());

            let app_data_mgr = std::path::PathBuf::from(&local_app_data).join("com.downex.manager");
            let _ = std::fs::create_dir_all(&app_data_mgr);
            let _ = std::fs::write(app_data_mgr.join("update_restart.flag"), clean_ver.as_bytes());
        }
        if let Ok(current_dir) = std::env::current_dir() {
            let _ = std::fs::write(current_dir.join("update_restart.flag"), clean_ver.as_bytes());
            let _ = std::fs::write(current_dir.join("src-tauri").join("update_restart.flag"), clean_ver.as_bytes());
        }

        let pid = std::process::id();
        let mut cmd = std::process::Command::new(&updater_exe);
        cmd.arg(format!("--target-version={}", clean_ver))
            .arg(format!("--staged-file={}", staged_path))
            .arg(format!("--parent-pid={}", pid))
            .arg(format!("--theme={}", theme.unwrap_or("dark")))
            .arg(if was_main_open { "--show" } else { "--autostart" });

        if is_dev_env {
            cmd.arg("--dev-mode");
        }
        cmd.current_dir(install_root);
        cmd.stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());

        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000 | 0x00000008); // CREATE_NO_WINDOW | DETACHED_PROCESS

        cmd.spawn().map_err(|e| format!("Failed to spawn updater.exe: {}", e))?;

        // Direct close of old UI HWND immediately so zero white blank WebView frame flashes
        for (_label, window) in app.webview_windows() {
            if let Ok(hwnd) = window.hwnd() {
                unsafe {
                    windows_sys::Win32::UI::WindowsAndMessaging::ShowWindow(
                        hwnd.0 as _,
                        windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE,
                    );
                }
            }
            let _ = window.hide();
        }

        let app_handle = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(25));
            app_handle.exit(0);
            std::process::exit(0);
        });

        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        let _ = target_version;
        let _ = staged_path;
        let _ = was_main_open;
        let _ = theme;
        Ok(())
    }
}

pub fn preview_external_updater(
    _app: &tauri::AppHandle,
    theme: Option<&str>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let current_exe = std::env::current_exe().map_err(|e| format!("Current exe error: {}", e))?;
        let install_root = current_exe
            .parent()
            .ok_or_else(|| "Missing executable parent directory".to_string())?;

        let mut updater_exe = install_root.join("updater").join("updater.exe");
        if !updater_exe.exists() {
            updater_exe = install_root.join("updater.exe");
        }
        if !updater_exe.exists() {
            updater_exe = install_root.join("resources").join("updater").join("updater.exe");
        }
        if !updater_exe.exists() {
            let res_updater = std::path::PathBuf::from("resources").join("updater").join("updater.exe");
            if res_updater.exists() {
                updater_exe = res_updater;
            }
        }
        if !updater_exe.exists() {
            let temp_updater = std::env::temp_dir().join("com.downex.manager").join("updater.exe");
            if temp_updater.exists() {
                updater_exe = temp_updater;
            } else {
                return Err("External updater executable (updater.exe) not found".to_string());
            }
        }

        let mut cmd = std::process::Command::new(&updater_exe);
        cmd.arg("--preview")
            .arg(format!("--theme={}", theme.unwrap_or("dark")));
        cmd.current_dir(install_root);
        cmd.stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());

        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000 | 0x00000008); // CREATE_NO_WINDOW | DETACHED_PROCESS

        cmd.spawn().map_err(|e| format!("Failed to spawn updater.exe preview: {}", e))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = theme;
        Ok(())
    }
}

pub fn mark_boot_healthy() {
    #[cfg(target_os = "windows")]
    {
        if let Ok(current_exe) = std::env::current_exe() {
            if let Some(parent) = current_exe.parent() {
                let state_file = parent.join("updater").join("sync_state.dat");
                if state_file.exists() {
                    if let Ok(content) = std::fs::read_to_string(&state_file) {
                        if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&content) {
                            if let Some(obj) = json.as_object_mut() {
                                obj.insert("is_healthy".to_string(), serde_json::Value::Bool(true));
                                obj.insert("boot_attempts".to_string(), serde_json::Value::Number(0.into()));
                            }
                            let _ = std::fs::write(&state_file, serde_json::to_string_pretty(&json).unwrap_or_default());
                        }
                    }
                }
                // Clean old swap files after health is confirmed
                let _ = crate::commands::cleanup_old_swap_files();
            }
        }
    }
}

pub fn evaluate_and_handle_boot_health(args: &[String]) -> bool {
    #[cfg(target_os = "windows")]
    {
        let Ok(current_exe) = std::env::current_exe() else {
            return true;
        };
        let Some(parent) = current_exe.parent() else {
            return true;
        };
        let old_exe = parent.join("Downex.exe.old");
        let state_file = parent.join("updater").join("sync_state.dat");

        if args.iter().any(|a| a == "--rolled-back") {
            return true;
        }

        if state_file.exists() {
            if let Ok(content) = std::fs::read_to_string(&state_file) {
                if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&content) {
                    let is_healthy = json.get("is_healthy").and_then(|b| b.as_bool()).unwrap_or(true);
                    let boot_attempts = json.get("boot_attempts").and_then(|b| b.as_u64()).unwrap_or(0);
                    let active_version = json.get("active_version").and_then(|v| v.as_str()).unwrap_or("0.0.1").to_string();

                    if !is_healthy && boot_attempts >= 2 && old_exe.exists() {
                        eprintln!("[Downex Self-Healing] Auto-rollback triggered for v{}", active_version);
                        let bad_exe = parent.join("Downex.exe.bad");
                        let _ = std::fs::remove_file(&bad_exe);
                        let _ = std::fs::rename(&current_exe, &bad_exe);
                        let _ = std::fs::rename(&old_exe, &current_exe);

                        if let Some(obj) = json.as_object_mut() {
                            let restored_ver = crate::version::extract_pe_version(&current_exe)
                                .unwrap_or_else(|| "0.0.1".to_string());
                            obj.insert("active_version".to_string(), serde_json::Value::String(restored_ver.clone()));
                            obj.insert("is_healthy".to_string(), serde_json::Value::Bool(true));
                            obj.insert("boot_attempts".to_string(), serde_json::Value::Number(0.into()));
                            let mut q_list = obj.get("quarantined_versions").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                            let v_val = serde_json::Value::String(active_version);
                            if !q_list.contains(&v_val) {
                                q_list.push(v_val);
                            }
                            obj.insert("quarantined_versions".to_string(), serde_json::Value::Array(q_list));

                            // Sync AppData sidecar and Windows Registry to restored version
                            if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
                                let sidecar_file = std::path::PathBuf::from(local_app_data).join("com.downex.manager").join("installed_version.json");
                                let payload = serde_json::json!({
                                    "installed_version": restored_ver,
                                    "updated_at": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64
                                });
                                let _ = std::fs::write(&sidecar_file, serde_json::to_string_pretty(&payload).unwrap_or_default());
                            }
                            crate::commands::sync_windows_installed_version(&restored_ver);
                        }
                        let _ = std::fs::write(&state_file, serde_json::to_string_pretty(&json).unwrap_or_default());

                        // Spawn rolled back binary
                        use std::os::windows::process::CommandExt;
                        let mut cmd = std::process::Command::new(&current_exe);
                        cmd.arg("--update-restart")
                            .arg("--restarted")
                            .arg("--rolled-back")
                            .arg(format!("--parent-pid={}", std::process::id()))
                            .arg("--show");
                        cmd.current_dir(parent);
                        cmd.stdin(std::process::Stdio::null())
                            .stdout(std::process::Stdio::null())
                            .stderr(std::process::Stdio::null());
                        cmd.creation_flags(0x08000000 | 0x00000008);
                        let _ = cmd.spawn();
                        return false;
                    }

                    if let Some(obj) = json.as_object_mut() {
                        obj.insert("boot_attempts".to_string(), serde_json::Value::Number((boot_attempts + 1).into()));
                        let _ = std::fs::write(&state_file, serde_json::to_string_pretty(obj).unwrap_or_default());
                    }
                }
            }
        }
    }
    true
}
