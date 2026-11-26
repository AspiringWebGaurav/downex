use std::path::{Component, Path, PathBuf};

static EMBEDDED_DOCS: &[(&str, &str)] = include!("embedded_docs.rs");

/// Resolves the true application installation directory ($INSTDIR),
/// skipping local Cargo target/debug and target/release directories.
pub fn resolve_install_root() -> Option<PathBuf> {
    let exe_path = std::env::current_exe().ok()?;
    let exe_dir = exe_path.parent()?;
    let dir_name = exe_dir.file_name().and_then(|n| n.to_str()).unwrap_or("");

    let root = if dir_name.eq_ignore_ascii_case("core")
        || dir_name.eq_ignore_ascii_case("engine")
        || dir_name.eq_ignore_ascii_case("updater")
    {
        exe_dir.parent()?
    } else {
        exe_dir
    };

    let lower = root.to_string_lossy().to_lowercase();
    if lower.contains("\\target\\debug")
        || lower.contains("\\target\\release")
        || lower.contains("/target/debug")
        || lower.contains("/target/release")
    {
        return None;
    }

    // Only write 36 documentation files when running inside a real Downex installation root
    // (never pollute Downloads/Desktop/Temp if a binary is launched standalone).
    let is_real_install = root.join("uninstall.exe").is_file()
        || root.join("core").is_dir()
        || root.join("updater").is_dir();
    if !is_real_install {
        return None;
    }

    Some(root.to_path_buf())
}

fn is_safe_relative_doc_path(rel: &str) -> bool {
    let trimmed = rel.trim();
    if trimmed.is_empty() || trimmed.contains('\\') || trimmed.contains(':') {
        return false;
    }
    let path = Path::new(trimmed);
    if path.is_absolute() {
        return false;
    }
    let mut parts = Vec::new();
    for comp in path.components() {
        match comp {
            Component::Normal(s) => parts.push(s.to_string_lossy().to_string()),
            _ => return false,
        }
    }
    match parts.as_slice() {
        [single] => single.eq_ignore_ascii_case("README.txt"),
        [dir, file] => {
            (dir == "license" || dir == "research_and_study")
                && file.to_ascii_lowercase().ends_with(".txt")
                && !file.is_empty()
        }
        _ => false,
    }
}

fn write_if_changed(dest: &Path, content: &str) -> bool {
    if let Ok(existing) = std::fs::read(dest) {
        if existing == content.as_bytes() {
            return false;
        }
    }
    if let Some(parent) = dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(dest, content.as_bytes()).is_ok()
}

/// Silently verifies and updates $INSTDIR README.txt, license/, and research_and_study/
/// against the documents embedded in the running executable.
pub fn sync_installed_docs_to_disk() -> usize {
    let Some(install_root) = resolve_install_root() else {
        return 0;
    };

    if !install_root.exists() {
        return 0;
    }

    let mut updated_count = 0usize;
    for (rel_path, expected) in EMBEDDED_DOCS {
        if !is_safe_relative_doc_path(rel_path) {
            continue;
        }
        let dest = install_root.join(rel_path);
        if write_if_changed(&dest, expected) {
            updated_count += 1;
        }
    }

    if updated_count > 0 {
        println!(
            "[Downex Docs] Synchronized {} documentation file(s) in {}",
            updated_count,
            install_root.display()
        );
    }

    updated_count
}

/// Applies embedded doc updates and optional remote payload file overrides ({ "files": { "README.txt": "..." } }).
pub fn apply_remote_doc_updates(payload: Option<&serde_json::Value>) -> Result<usize, String> {
    let mut updated = sync_installed_docs_to_disk();

    if let Some(install_root) = resolve_install_root() {
        if let Some(files_map) = payload
            .and_then(|p| p.get("files"))
            .and_then(|f| f.as_object())
        {
            for (rel_path, val) in files_map {
                if !is_safe_relative_doc_path(rel_path) {
                    continue;
                }
                if let Some(text) = val.as_str() {
                    let dest = install_root.join(rel_path);
                    if write_if_changed(&dest, text) {
                        updated += 1;
                    }
                }
            }
        }
    }

    Ok(updated)
}
