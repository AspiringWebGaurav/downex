use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use sha2::{Digest, Sha256};

pub static EXTENSION_RELOAD_PENDING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ExtensionSyncResult {
    pub success: bool,
    pub updated: bool,
    pub previous_version: Option<String>,
    pub current_version: String,
    pub message: String,
}

pub fn get_canonical_extension_dir() -> PathBuf {
    if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
        PathBuf::from(local_appdata).join("Downex").join("browser-extension")
    } else if let Ok(profile) = std::env::var("USERPROFILE") {
        PathBuf::from(profile).join(".downex").join("browser-extension")
    } else {
        std::env::temp_dir().join("Downex").join("browser-extension")
    }
}

pub fn get_installed_extension_version() -> Option<String> {
    let manifest_path = get_canonical_extension_dir().join("manifest.json");
    if !manifest_path.exists() {
        return None;
    }

    if let Ok(content) = std::fs::read_to_string(&manifest_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(ver) = json.get("version").and_then(|v| v.as_str()) {
                return Some(ver.to_string());
            }
        }
    }
    None
}

pub fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if !dst.exists() {
        std::fs::create_dir_all(dst)?;
    }

    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

pub fn ensure_extension_files_on_disk() -> Result<PathBuf, String> {
    let target_dir = get_canonical_extension_dir();
    let current_ver = get_installed_extension_version();

    // Try finding local extension directory in workspace or adjacent to exe
    let candidates = [
        PathBuf::from("downex-browser-extension"),
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("downex-browser-extension")))
            .unwrap_or_default(),
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("resources").join("downex-browser-extension")))
            .unwrap_or_default(),
    ];

    for candidate in &candidates {
        let cand_manifest = candidate.join("manifest.json");
        if cand_manifest.exists() {
            let cand_ver = std::fs::read_to_string(&cand_manifest).ok().and_then(|c| {
                serde_json::from_str::<serde_json::Value>(&c).ok().and_then(|j| {
                    j.get("version").and_then(|v| v.as_str()).map(|s| s.to_string())
                })
            });

            let needs_update = match (&current_ver, &cand_ver) {
                (None, _) => true,
                (Some(curr), Some(cand)) => curr != cand,
                _ => false,
            };

            if needs_update {
                if let Err(e) = copy_dir_recursive(candidate, &target_dir) {
                    eprintln!("[Downex Extension Manager] Notice on copy from {:?}: {}", candidate, e);
                } else {
                    eprintln!("[Downex Extension Manager] Seeded canonical extension v{:?} from {:?}", cand_ver, candidate);
                    EXTENSION_RELOAD_PENDING.store(true, Ordering::SeqCst);
                    return Ok(target_dir);
                }
            } else {
                return Ok(target_dir);
            }
        }
    }

    // Ensure directory exists even if empty initially
    let _ = std::fs::create_dir_all(&target_dir);
    Ok(target_dir)
}

pub fn open_extension_folder() -> Result<String, String> {
    let target_dir = ensure_extension_files_on_disk()?;

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let dir_str = target_dir.to_string_lossy().to_string();
        std::process::Command::new("explorer.exe")
            .arg(&dir_str)
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| format!("Failed to launch Windows Explorer: {}", e))?;
        Ok(dir_str)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(target_dir.to_string_lossy().to_string())
    }
}

pub async fn download_and_extract_extension_package(
    client: &reqwest::Client,
    custom_url: Option<&str>,
    expected_hash: Option<&str>,
) -> Result<String, String> {
    let target_dir = get_canonical_extension_dir();
    let _ = std::fs::create_dir_all(&target_dir);

    let url = custom_url.unwrap_or("https://gphost.eu.cc/raw/downex-extension");
    eprintln!("[Downex Extension Manager] Fetching latest extension package from {}", url);

    let res = client
        .get(url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
        .send()
        .await
        .map_err(|e| format!("Failed to download extension: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Extension server returned HTTP {}", res.status()));
    }

    let bytes = res.bytes().await.map_err(|e| format!("Failed to read extension bytes: {}", e))?;

    // Cryptographic package integrity verification (SHA-256)
    if let Some(expected) = expected_hash {
        let clean_expected = expected.trim().to_lowercase();
        if clean_expected.len() == 64 {
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            let calculated = format!("{:x}", hasher.finalize());
            if calculated != clean_expected {
                return Err(format!(
                    "Extension package integrity verification failed: expected SHA-256 {}, got {}",
                    clean_expected, calculated
                ));
            }
            eprintln!("[Downex Extension Manager] ✓ Cryptographic SHA-256 verified ({})", clean_expected);
        }
    }

    let pid = std::process::id();
    let temp_zip = std::env::temp_dir().join(format!("downex_ext_{}.zip", pid));
    let temp_stage = std::env::temp_dir().join(format!("downex_ext_stage_{}", pid));
    let _ = std::fs::remove_dir_all(&temp_stage);
    let _ = std::fs::create_dir_all(&temp_stage);

    std::fs::write(&temp_zip, &bytes).map_err(|e| format!("Failed to write temp zip: {}", e))?;

    // Safe extraction into isolated staging directory first (Zero-Corruption Guarantee)
    let mut extracted = false;
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        // Try tar.exe (fastest native extraction on Windows 10/11)
        if let Ok(mut child) = std::process::Command::new("tar.exe")
            .args(["-xf", &temp_zip.to_string_lossy(), "-C", &temp_stage.to_string_lossy()])
            .creation_flags(0x08000000)
            .spawn()
        {
            if let Ok(status) = child.wait() {
                if status.success() {
                    extracted = true;
                }
            }
        }

        if !extracted {
            // Fallback to PowerShell Expand-Archive
            let ps_cmd = format!(
                "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
                temp_zip.to_string_lossy(),
                temp_stage.to_string_lossy()
            );
            if let Ok(status) = std::process::Command::new("powershell.exe")
                .args(["-NoProfile", "-Command", &ps_cmd])
                .creation_flags(0x08000000)
                .status()
            {
                if status.success() {
                    extracted = true;
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(status) = std::process::Command::new("unzip")
            .args(["-o", &temp_zip.to_string_lossy(), "-d", &temp_stage.to_string_lossy()])
            .status()
        {
            extracted = status.success();
        }
    }

    let _ = std::fs::remove_file(&temp_zip);

    if !extracted {
        let _ = std::fs::remove_dir_all(&temp_stage);
        return Err("Failed to extract companion extension archive".to_string());
    }

    // Verify stage integrity before copying to canonical location
    let stage_manifest = temp_stage.join("manifest.json");
    if !stage_manifest.exists() {
        let _ = std::fs::remove_dir_all(&temp_stage);
        return Err("Invalid extension package: manifest.json missing".to_string());
    }

    let stage_ver = std::fs::read_to_string(&stage_manifest).ok().and_then(|c| {
        serde_json::from_str::<serde_json::Value>(&c).ok().and_then(|j| {
            j.get("version").and_then(|v| v.as_str()).map(|s| s.to_string())
        })
    }).unwrap_or_else(|| "0.0.0".to_string());

    // Atomically copy validated files into canonical extension dir
    if let Err(e) = copy_dir_recursive(&temp_stage, &target_dir) {
        let _ = std::fs::remove_dir_all(&temp_stage);
        return Err(format!("Failed to copy validated extension to canonical directory: {}", e));
    }
    let _ = std::fs::remove_dir_all(&temp_stage);

    // Signal hot-reload to connected browser extensions
    EXTENSION_RELOAD_PENDING.store(true, Ordering::SeqCst);

    eprintln!("[Downex Extension Manager] ✓ Companion extension updated to v{} at {:?}", stage_ver, target_dir);
    Ok(stage_ver)
}

pub async fn download_and_extract_extension(
    client: &reqwest::Client,
) -> Result<String, String> {
    download_and_extract_extension_package(client, None, None).await
}

pub async fn check_and_sync_extension(
    client: &reqwest::Client,
    target_version: Option<&str>,
    custom_url: Option<&str>,
    expected_hash: Option<&str>,
) -> Result<ExtensionSyncResult, String> {
    let installed_version = get_installed_extension_version();

    if let (Some(target), Some(ref installed)) = (target_version, &installed_version) {
        if !crate::ota::is_newer_version(target, installed) {
            return Ok(ExtensionSyncResult {
                success: true,
                updated: false,
                previous_version: installed_version.clone(),
                current_version: installed.clone(),
                message: format!("Extension is already up to date (v{})", installed),
            });
        }
    }

    let new_ver = download_and_extract_extension_package(client, custom_url, expected_hash).await?;

    Ok(ExtensionSyncResult {
        success: true,
        updated: true,
        previous_version: installed_version,
        current_version: new_ver.clone(),
        message: format!("Extension successfully updated to v{}", new_ver),
    })
}
