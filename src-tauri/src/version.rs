use std::path::Path;
use tauri::{AppHandle, Manager};

/// Extracts the PE VersionInfo (ProductVersion / FileVersion) from a Windows PE executable on disk.
/// Inspects the standard VS_FIXEDFILEINFO structure (signature 0xFEEF04BD in LE: [0xbd, 0x04, 0xef, 0xfe]).
/// This allows Downex to authoritatively determine if the physical binary running on disk
/// was upgraded via OTA NTFS atomic shadow swap (REA / GPN pattern).
pub fn extract_pe_version(exe_path: &Path) -> Option<String> {
    let bytes = std::fs::read(exe_path).ok()?;
    if bytes.len() < 1024 {
        return None;
    }

    // Anchor on UTF-16LE "VS_VERSION_INFO"
    let tag: [u8; 30] = [
        b'V', 0, b'S', 0, b'_', 0, b'V', 0, b'E', 0, b'R', 0, b'S', 0, b'I', 0, b'O', 0, b'N', 0,
        b'_', 0, b'I', 0, b'N', 0, b'F', 0, b'O', 0,
    ];

    let tag_pos = bytes.windows(tag.len()).position(|window| window == tag)?;
    let search_window = &bytes[tag_pos..std::cmp::min(tag_pos + 96, bytes.len())];

    let sig = [0xbd, 0x04, 0xef, 0xfe]; // 0xFEEF04BD
    let sig_offset = search_window.windows(sig.len()).position(|w| w == sig)?;
    let idx = tag_pos + sig_offset;

    if idx + 24 <= bytes.len() {
        let file_ver_ms = u32::from_le_bytes(bytes[idx + 8..idx + 12].try_into().ok()?);
        let file_ver_ls = u32::from_le_bytes(bytes[idx + 12..idx + 16].try_into().ok()?);
        let prod_ver_ms = u32::from_le_bytes(bytes[idx + 16..idx + 20].try_into().ok()?);
        let prod_ver_ls = u32::from_le_bytes(bytes[idx + 20..idx + 24].try_into().ok()?);

        let (ms, ls) = if prod_ver_ms != 0 || prod_ver_ls != 0 {
            (prod_ver_ms, prod_ver_ls)
        } else {
            (file_ver_ms, file_ver_ls)
        };

        let major = (ms >> 16) & 0xffff;
        let minor = ms & 0xffff;
        let patch = (ls >> 16) & 0xffff;

        return Some(format!("{}.{}.{}", major, minor, patch));
    }
    None
}

/// Compares two semantic version strings (e.g. "0.0.19" vs "0.0.1").
pub fn compare_semver(v1: &str, v2: &str) -> std::cmp::Ordering {
    let parse_parts = |v: &str| {
        v.trim()
            .trim_start_matches('v')
            .split('.')
            .map(|part| {
                part.split('-')
                    .next()
                    .unwrap_or("0")
                    .parse::<u64>()
                    .unwrap_or(0)
            })
            .collect::<Vec<u64>>()
    };

    let p1 = parse_parts(v1);
    let p2 = parse_parts(v2);

    let max_len = std::cmp::max(p1.len(), p2.len());
    for i in 0..max_len {
        let n1 = p1.get(i).copied().unwrap_or(0);
        let n2 = p2.get(i).copied().unwrap_or(0);
        if n1 != n2 {
            return n1.cmp(&n2);
        }
    }
    std::cmp::Ordering::Equal
}

#[cfg(target_os = "windows")]
pub fn read_registry_installed_version() -> Option<String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let subkeys = [
        r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Downex",
        r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Downex",
    ];

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    for subkey in &subkeys {
        if let Ok(key) = hkcu.open_subkey_with_flags(subkey, KEY_READ) {
            if let Ok(ver) = key.get_value::<String, _>("DisplayVersion") {
                let clean = ver.trim().trim_start_matches('v');
                if !clean.is_empty() && clean != "0.0.0" {
                    return Some(clean.to_string());
                }
            }
        }
    }

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    for subkey in &subkeys {
        if let Ok(key) = hklm.open_subkey_with_flags(subkey, KEY_READ) {
            if let Ok(ver) = key.get_value::<String, _>("DisplayVersion") {
                let clean = ver.trim().trim_start_matches('v');
                if !clean.is_empty() && clean != "0.0.0" {
                    return Some(clean.to_string());
                }
            }
        }
    }

    None
}

#[cfg(not(target_os = "windows"))]
pub fn read_registry_installed_version() -> Option<String> {
    None
}

pub fn read_db_installed_version(db: &crate::db::DatabaseManager) -> Option<String> {
    if let Ok(Some(val)) = db.get_setting("installed_app_version") {
        let clean = val.trim().trim_start_matches('v');
        if !clean.is_empty() && clean != "0.0.0" {
            return Some(clean.to_string());
        }
    }
    None
}

pub fn read_sidecar_version<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<String> {
    let app_data = app.path().app_data_dir().ok()?;
    let version_file = app_data.join("installed_version.json");
    if version_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&version_file) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(v) = json.get("installed_version").and_then(|v| v.as_str()) {
                    let clean = v.trim().trim_start_matches('v');
                    if !clean.is_empty() && clean != "0.0.0" {
                        return Some(clean.to_string());
                    }
                }
            }
        }
    }
    None
}

/// Synchronizes the dynamic installed version across all persistent stores
/// (SQLite DB, Windows Registry, and AppData sidecar) so state is permanently preserved.
pub fn write_persisted_version<R: tauri::Runtime>(
    app: &AppHandle<R>,
    db: Option<&crate::db::DatabaseManager>,
    version: &str,
) {
    let clean = version.trim().trim_start_matches('v');
    if clean.is_empty() {
        return;
    }

    // 1. Write to SQLite app_settings
    if let Some(db_mgr) = db {
        let _ = db_mgr.set_setting("installed_app_version", clean);
    } else if let Some(state) = app.try_state::<crate::AppState>() {
        let _ = state.db.set_setting("installed_app_version", clean);
    }

    // 2. Write to Windows Registry
    #[cfg(target_os = "windows")]
    {
        crate::commands::sync_windows_installed_version(clean);
    }

    // 3. Write to AppData sidecar
    if let Ok(app_data) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&app_data);
        let version_file = app_data.join("installed_version.json");
        let payload = serde_json::json!({
            "installed_version": clean,
            "updated_at": chrono::Utc::now().timestamp_millis()
        });
        let _ = std::fs::write(version_file, payload.to_string());
    }
}

/// Authoritative Dynamic Version Resolution (REA / GPN 1:1 Architecture)
/// Resolves the installed version by checking:
/// 1. In development builds (debug_assertions), strictly adheres to base package version ("0.0.0")
///    unless an OTA update was explicitly applied via the AppData sidecar.
/// 2. In production builds:
///    - PE Header of physical executable (detects physical binary replacement after NTFS atomic swap)
///    - AppData sidecar `installed_version.json` (written exclusively by update installer)
///    - SQLite Database `app_settings` (`installed_app_version`)
///    - Base package version ("0.0.0") fallback
///
/// Note: Windows Registry is strictly an OS display artifact and is NOT used as an input candidate.
pub fn resolve_installed_version<R: tauri::Runtime>(
    app: &AppHandle<R>,
    db: Option<&crate::db::DatabaseManager>,
) -> String {
    let base_version = app.package_info().version.to_string();

    #[cfg(debug_assertions)]
    {
        // In dev mode, check sidecar and SQLite DB before base version fallback
        if let Some(sidecar_ver) = read_sidecar_version(app) {
            if sidecar_ver != "0.0.0" {
                return sidecar_ver;
            }
        }
        if let Some(db_mgr) = db {
            if let Some(db_ver) = read_db_installed_version(db_mgr) {
                if db_ver != "0.0.0" {
                    return db_ver;
                }
            }
        } else if let Some(state) = app.try_state::<crate::AppState>() {
            if let Some(db_ver) = read_db_installed_version(&state.db) {
                if db_ver != "0.0.0" {
                    return db_ver;
                }
            }
        }
        return base_version;
    }

    #[cfg(not(debug_assertions))]
    {
        let mut candidates: Vec<String> = Vec::new();

        // 1. PE Header of currently executing binary
        if let Ok(current_exe) = std::env::current_exe() {
            if let Some(pe_ver) = extract_pe_version(&current_exe) {
                if pe_ver != "0.0.0" {
                    candidates.push(pe_ver);
                }
            }
        }

        // 2. AppData Sidecar (written exclusively by update installer)
        if let Some(sidecar_ver) = read_sidecar_version(app) {
            if sidecar_ver != "0.0.0" {
                candidates.push(sidecar_ver);
            }
        }

        // 3. SQLite Database app_settings (if updated)
        if let Some(db_mgr) = db {
            if let Some(db_ver) = read_db_installed_version(db_mgr) {
                if db_ver != "0.0.0" {
                    candidates.push(db_ver);
                }
            }
        } else if let Some(state) = app.try_state::<crate::AppState>() {
            if let Some(db_ver) = read_db_installed_version(&state.db) {
                if db_ver != "0.0.0" {
                    candidates.push(db_ver);
                }
            }
        }

        // 4. Windows Registry DisplayVersion (OS persistent record)
        #[cfg(target_os = "windows")]
        if let Some(reg_ver) = read_registry_installed_version() {
            if reg_ver != "0.0.0" {
                candidates.push(reg_ver);
            }
        }

        // Determine highest semantic version
        let mut resolved = base_version.clone();
        for cand in candidates {
            if compare_semver(&cand, &resolved) == std::cmp::Ordering::Greater {
                resolved = cand;
            }
        }

        if resolved != "0.0.0" {
            write_persisted_version(app, db, &resolved);
        }

        resolved
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compare_semver() {
        assert_eq!(compare_semver("0.0.1", "0.0.0"), std::cmp::Ordering::Greater);
        assert_eq!(compare_semver("0.0.19", "0.0.2"), std::cmp::Ordering::Greater);
        assert_eq!(compare_semver("0.1.0", "0.0.19"), std::cmp::Ordering::Greater);
        assert_eq!(compare_semver("v1.0.0", "1.0.0"), std::cmp::Ordering::Equal);
        assert_eq!(compare_semver("0.0.1-beta", "0.0.1"), std::cmp::Ordering::Equal);
        assert_eq!(compare_semver("0.0.0", "0.0.1"), std::cmp::Ordering::Less);
    }

    #[test]
    fn test_pe_version_extraction_synthetic() {
        let mut mock_pe = vec![0u8; 2048];
        let tag_offset = 256;
        let tag: [u8; 30] = [
            b'V', 0, b'S', 0, b'_', 0, b'V', 0, b'E', 0, b'R', 0, b'S', 0, b'I', 0, b'O', 0, b'N', 0,
            b'_', 0, b'I', 0, b'N', 0, b'F', 0, b'O', 0,
        ];
        mock_pe[tag_offset..tag_offset + 30].copy_from_slice(&tag);

        let offset = tag_offset + 40;
        // Signature 0xFEEF04BD in LE: [0xbd, 0x04, 0xef, 0xfe]
        mock_pe[offset..offset + 4].copy_from_slice(&[0xbd, 0x04, 0xef, 0xfe]);
        // file_ver_ms: 0.0 -> 0x00000000
        mock_pe[offset + 8..offset + 12].copy_from_slice(&0u32.to_le_bytes());
        // file_ver_ls: 1.0 -> 0x00010000 (patch: 1)
        mock_pe[offset + 12..offset + 16].copy_from_slice(&(1u32 << 16).to_le_bytes());
        // prod_ver_ms: 0.0 -> 0x00000000
        mock_pe[offset + 16..offset + 20].copy_from_slice(&0u32.to_le_bytes());
        // prod_ver_ls: 1.0 -> 0x00010000 (patch: 1)
        mock_pe[offset + 20..offset + 24].copy_from_slice(&(1u32 << 16).to_le_bytes());

        let temp_dir = std::env::temp_dir();
        let test_file = temp_dir.join("test_pe_synthetic.exe");
        std::fs::write(&test_file, &mock_pe).unwrap();

        let extracted = extract_pe_version(&test_file);
        let _ = std::fs::remove_file(&test_file);

        assert_eq!(extracted, Some("0.0.1".to_string()));
    }
}

