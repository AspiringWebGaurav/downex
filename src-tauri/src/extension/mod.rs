use std::path::{Path, PathBuf};

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

    // If already seeded and valid, return early
    if target_dir.join("manifest.json").exists() {
        return Ok(target_dir);
    }

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
        if candidate.join("manifest.json").exists() {
            if let Err(e) = copy_dir_recursive(candidate, &target_dir) {
                eprintln!("[Downex Extension Manager] Notice on copy from {:?}: {}", candidate, e);
            } else {
                eprintln!("[Downex Extension Manager] Seeded canonical extension from {:?}", candidate);
                return Ok(target_dir);
            }
        }
    }

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
