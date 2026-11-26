use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// Queries SMBIOS firmware tables on Windows via kernel32!GetSystemFirmwareTable
#[cfg(target_os = "windows")]
fn get_smbios_raw_bytes() -> Option<Vec<u8>> {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetSystemFirmwareTable(
            firmware_table_provider_signature: u32,
            firmware_table_id: u32,
            p_firmware_table_buffer: *mut u8,
            buffer_size: u32,
        ) -> u32;
    }

    unsafe {
        // 'RSMB' in little-endian ASCII: 0x52534D42
        let sig: u32 = 0x52534D42;
        let size = GetSystemFirmwareTable(sig, 0, std::ptr::null_mut(), 0);
        if size == 0 {
            return None;
        }

        let mut buf = vec![0u8; size as usize];
        let bytes_read = GetSystemFirmwareTable(sig, 0, buf.as_mut_ptr(), size);
        if bytes_read == 0 || bytes_read > size {
            return None;
        }
        Some(buf)
    }
}

/// Retrieves Windows MachineGuid from HKLM\SOFTWARE\Microsoft\Cryptography
#[cfg(target_os = "windows")]
fn get_machine_guid() -> Option<String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let crypto_key = hklm.open_subkey("SOFTWARE\\Microsoft\\Cryptography").ok()?;
    crypto_key.get_value("MachineGuid").ok()
}

/// Computes the persistent Silicon Hardware Fingerprint (Format: DWNX-XXXX-XXXX-XXXX)
pub fn derive_silicon_hardware_id() -> String {
    let mut hasher = Sha256::new();

    // 1. SMBIOS table
    #[cfg(target_os = "windows")]
    if let Some(smbios) = get_smbios_raw_bytes() {
        hasher.update(&smbios);
    }

    // 2. Windows Registry MachineGuid
    #[cfg(target_os = "windows")]
    if let Some(guid) = get_machine_guid() {
        hasher.update(guid.as_bytes());
    }

    // 3. Environment/Architecture Salt
    let arch = std::env::consts::ARCH;
    let os = std::env::consts::OS;
    let proc_id = std::env::var("PROCESSOR_IDENTIFIER").unwrap_or_default();
    let num_procs = std::env::var("NUMBER_OF_PROCESSORS").unwrap_or_default();
    hasher.update(arch.as_bytes());
    hasher.update(os.as_bytes());
    hasher.update(proc_id.as_bytes());
    hasher.update(num_procs.as_bytes());

    let result = hasher.finalize();
    let hex_hash = format!("{:x}", result);

    // Format as 16-character grouped identifier: DWNX-XXXX-XXXX-XXXX
    let chunk1 = &hex_hash[0..4];
    let chunk2 = &hex_hash[4..8];
    let chunk3 = &hex_hash[8..12];
    let chunk4 = &hex_hash[12..16];

    format!("DWNX-{}-{}-{}-{}", chunk1, chunk2, chunk3, chunk4).to_uppercase()
}

/// Resolves installation directory
pub fn get_app_install_dir() -> Option<PathBuf> {
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            if parent.file_name().and_then(|n| n.to_str()) == Some("core") {
                return parent.parent().map(|p| p.to_path_buf());
            }
            return Some(parent.to_path_buf());
        }
    }
    None
}

/// Path to the local installation hardware ID file ($INSTDIR/security/hardware_id.dat)
pub fn get_install_hardware_id_path() -> Option<PathBuf> {
    get_app_install_dir().map(|dir| dir.join("security").join("hardware_id.dat"))
}

/// Path to local installation hardware ban file ($INSTDIR/security/hardware_ban.dat)
pub fn get_install_ban_file_path() -> Option<PathBuf> {
    get_app_install_dir().map(|dir| dir.join("security").join("hardware_ban.dat"))
}

/// Path to AppData sidecar hardware ban file (%LOCALAPPDATA%/com.downex.manager/hardware_ban.dat)
pub fn get_appdata_ban_file_path() -> Option<PathBuf> {
    if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
        Some(PathBuf::from(local_app).join("com.downex.manager").join("hardware_ban.dat"))
    } else {
        None
    }
}

/// Path to ProgramData shared hardware ban file (%ALLUSERSPROFILE%/Downex/hardware_ban.dat)
pub fn get_programdata_ban_file_path() -> Option<PathBuf> {
    if let Ok(prog_data) = std::env::var("ALLUSERSPROFILE") {
        Some(PathBuf::from(prog_data).join("Downex").join("hardware_ban.dat"))
    } else {
        None
    }
}

/// Resolves or initializes the Silicon Hardware ID across files and database
pub fn get_or_init_silicon_hardware_id(db: Option<&crate::db::DatabaseManager>) -> String {
    // 1. Check install directory: $INSTDIR/security/hardware_id.dat
    if let Some(p) = get_install_hardware_id_path() {
        if p.exists() {
            if let Ok(content) = std::fs::read_to_string(&p) {
                let trimmed = content.trim();
                if trimmed.starts_with("DWNX-") && trimmed.len() >= 16 {
                    return trimmed.to_string();
                }
            }
        }
    }

    // 2. Check SQLite setting
    if let Some(db) = db {
        if let Ok(Some(saved)) = db.get_setting("silicon_hardware_id") {
            let trimmed = saved.trim();
            if trimmed.starts_with("DWNX-") && trimmed.len() >= 16 {
                return trimmed.to_string();
            }
        }
    }

    // 3. Derive directly from silicon / hardware
    let hwid = derive_silicon_hardware_id();

    // 4. Save to files of install
    if let Some(p) = get_install_hardware_id_path() {
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&p, hwid.as_bytes());
    }

    // 5. Save to AppData
    if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
        let sidecar = PathBuf::from(local_app).join("com.downex.manager").join("hardware_id.json");
        if let Some(parent) = sidecar.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let payload = serde_json::json!({
            "hardware_id": &hwid,
            "created_at": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()
        });
        let _ = std::fs::write(&sidecar, serde_json::to_string_pretty(&payload).unwrap_or_default());
    }

    // 6. Save to SQLite
    if let Some(db) = db {
        let _ = db.set_setting("silicon_hardware_id", &hwid);
        let _ = db.set_setting("installation_id", &hwid);
    }

    hwid
}

/// Checks whether this machine is actively hardware banned across the 3 self-healing anchors
pub fn check_is_hardware_banned(db: Option<&crate::db::DatabaseManager>) -> bool {
    let mut is_banned = false;
    let mut ban_reason = String::from("Hardware restriction enforced by ecosystem administrator.");

    // Anchor 1: $INSTDIR/security/hardware_ban.dat
    if let Some(p) = get_install_ban_file_path() {
        if p.exists() {
            is_banned = true;
            if let Ok(r) = std::fs::read_to_string(&p) {
                if !r.trim().is_empty() { ban_reason = r.trim().to_string(); }
            }
        }
    }

    // Anchor 2: %ALLUSERSPROFILE%/Downex/hardware_ban.dat
    if let Some(p) = get_programdata_ban_file_path() {
        if p.exists() {
            is_banned = true;
            if let Ok(r) = std::fs::read_to_string(&p) {
                if !r.trim().is_empty() { ban_reason = r.trim().to_string(); }
            }
        }
    }

    // Anchor 3: %LOCALAPPDATA%/com.downex.manager/hardware_ban.dat
    if let Some(p) = get_appdata_ban_file_path() {
        if p.exists() {
            is_banned = true;
        }
    }

    // Anchor 4: SQLite Database setting
    if let Some(db) = db {
        if let Ok(Some(val)) = db.get_setting("is_hardware_banned") {
            if val.trim().eq_ignore_ascii_case("true") {
                is_banned = true;
            }
        }
    }

    // Self-Healing: Only re-sync anchors once per boot when ban is detected
    static SELF_HEALED_THIS_BOOT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if is_banned && !SELF_HEALED_THIS_BOOT.swap(true, std::sync::atomic::Ordering::Relaxed) {
        enforce_local_hardware_ban(&ban_reason, db);
    }

    is_banned
}

/// Enforces the hardware ban locally, writing locked files across all anchors
pub fn enforce_local_hardware_ban(reason: &str, db: Option<&crate::db::DatabaseManager>) {
    let reason_payload = if reason.trim().is_empty() {
        "Hardware restriction enforced by ecosystem administrator."
    } else {
        reason.trim()
    };

    // 1. Write Anchor 1: $INSTDIR/security/hardware_ban.dat
    if let Some(p) = get_install_ban_file_path() {
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&p, reason_payload.as_bytes());
        #[cfg(target_os = "windows")]
        set_file_readonly_system(&p);
    }

    // 2. Write Anchor 2: %ALLUSERSPROFILE%/Downex/hardware_ban.dat
    if let Some(p) = get_programdata_ban_file_path() {
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&p, reason_payload.as_bytes());
        #[cfg(target_os = "windows")]
        set_file_readonly_system(&p);
    }

    // 3. Write Anchor 3: %LOCALAPPDATA%/com.downex.manager/hardware_ban.dat
    if let Some(p) = get_appdata_ban_file_path() {
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&p, reason_payload.as_bytes());
        #[cfg(target_os = "windows")]
        set_file_readonly_system(&p);
    }

    // 4. Update SQLite
    if let Some(db) = db {
        let _ = db.set_setting("is_hardware_banned", "true");
        let _ = db.set_setting("hardware_ban_reason", reason_payload);
    }
}

/// Removes the ban markers across all anchors when an authenticated UNBAN arrives
pub fn lift_local_hardware_ban(db: Option<&crate::db::DatabaseManager>) {
    // 1. Remove Anchor 1
    if let Some(p) = get_install_ban_file_path() {
        #[cfg(target_os = "windows")]
        clear_file_readonly_system(&p);
        let _ = std::fs::remove_file(&p);
    }

    // 2. Remove Anchor 2
    if let Some(p) = get_programdata_ban_file_path() {
        #[cfg(target_os = "windows")]
        clear_file_readonly_system(&p);
        let _ = std::fs::remove_file(&p);
    }

    // 3. Remove Anchor 3
    if let Some(p) = get_appdata_ban_file_path() {
        #[cfg(target_os = "windows")]
        clear_file_readonly_system(&p);
        let _ = std::fs::remove_file(&p);
    }

    // 4. Update SQLite
    if let Some(db) = db {
        let _ = db.set_setting("is_hardware_banned", "false");
        let _ = db.delete_setting("hardware_ban_reason");
    }
}

#[cfg(target_os = "windows")]
fn set_file_readonly_system(path: &Path) {
    use std::os::windows::ffi::OsStrExt;
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    unsafe {
        windows_sys::Win32::Storage::FileSystem::SetFileAttributesW(
            wide.as_ptr(),
            windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_READONLY
                | windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_SYSTEM
                | windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_HIDDEN,
        );
    }
}

#[cfg(target_os = "windows")]
fn clear_file_readonly_system(path: &Path) {
    use std::os::windows::ffi::OsStrExt;
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    unsafe {
        windows_sys::Win32::Storage::FileSystem::SetFileAttributesW(
            wide.as_ptr(),
            windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_NORMAL,
        );
    }
}
