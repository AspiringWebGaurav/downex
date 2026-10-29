use crate::db::DatabaseManager;

#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

const RUN_SUBKEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const VALUE_NAME: &str = "Downex";

/// Checks if Downex is currently registered to launch on Windows startup in HKCU\...\Run.
#[cfg(target_os = "windows")]
pub fn is_autostart_registered() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(run_key) = hkcu.open_subkey_with_flags(RUN_SUBKEY, KEY_READ) {
        if let Ok(raw_cmd) = run_key.get_value::<String, _>(VALUE_NAME) {
            let trimmed = raw_cmd.trim();
            return !trimmed.is_empty();
        }
    }
    false
}

#[cfg(not(target_os = "windows"))]
pub fn is_autostart_registered() -> bool {
    false
}

/// Sets or removes Downex Windows startup registry entry.
/// Value Format: `"C:\path\to\Downex.exe" --autostart`
#[cfg(target_os = "windows")]
pub fn set_autostart_registered(enable: bool) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    if enable {
        let current_exe = std::env::current_exe()
            .map_err(|e| format!("Failed to determine current executable path: {}", e))?;
        
        let exe_str = current_exe.to_string_lossy().to_string();
        if exe_str.is_empty() {
            return Err("Resolved executable path is empty".to_string());
        }

        let cmd_value = format!("\"{}\" --autostart", exe_str);

        let (run_key, _disp) = hkcu
            .create_subkey_with_flags(RUN_SUBKEY, KEY_SET_VALUE | KEY_READ)
            .map_err(|e| format!("Failed to open HKCU\\{}: {}", RUN_SUBKEY, e))?;

        run_key
            .set_value(VALUE_NAME, &cmd_value)
            .map_err(|e| format!("Failed to write autostart registry value: {}", e))?;

        eprintln!(
            "[Downex Autostart] Registered Windows Startup: HKCU\\{}\\{} -> {}",
            RUN_SUBKEY, VALUE_NAME, cmd_value
        );
        Ok(())
    } else {
        if let Ok(run_key) = hkcu.open_subkey_with_flags(RUN_SUBKEY, KEY_SET_VALUE) {
            let _ = run_key.delete_value(VALUE_NAME);
            eprintln!(
                "[Downex Autostart] Removed Windows Startup entry: HKCU\\{}\\{}",
                RUN_SUBKEY, VALUE_NAME
            );
        }
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
pub fn set_autostart_registered(_enable: bool) -> Result<(), String> {
    Ok(())
}

/// Automatically synchronizes the Windows startup registry entry on application boot.
/// 
/// 1. Reads user preference from SQLite `app_settings` (key: `autostart_enabled`).
/// 2. If unset (first launch), defaults to `true` (standard for high-performance download managers
///    so browser companion extension can route downloads immediately upon system reboot).
/// 3. If enabled, refreshes registry path to `current_exe()` (ensuring path stays valid
///    across OTA atomic upgrades and folder relocations).
/// 4. If explicitly disabled by user, ensures registry value is deleted.
pub fn sync_autostart_on_boot(db: &DatabaseManager) {
    let setting = db.get_setting("autostart_enabled").ok().flatten();

    match setting.as_deref() {
        Some("false") => {
            eprintln!("[Downex Autostart] Startup setting is disabled by user preference.");
            let _ = set_autostart_registered(false);
        }
        Some("true") => {
            eprintln!("[Downex Autostart] Startup setting is enabled. Refreshing registry pointer...");
            let _ = set_autostart_registered(true);
        }
        _ => {
            // Unset (first run): Default to enabled (IDM / GPN pattern)
            eprintln!("[Downex Autostart] Startup setting unconfigured. Enabling by default...");
            let _ = db.set_setting("autostart_enabled", "true");
            let _ = set_autostart_registered(true);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(target_os = "windows")]
    fn test_autostart_registry_cycle() {
        // 1. Enable autostart
        let res = set_autostart_registered(true);
        assert!(res.is_ok(), "Failed to register autostart: {:?}", res);
        assert!(is_autostart_registered(), "Autostart should be registered");

        // 2. Verify registry value directly via winreg
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run_key = hkcu.open_subkey_with_flags(RUN_SUBKEY, KEY_READ).expect("Must open Run key");
        let val: String = run_key.get_value(VALUE_NAME).expect("Must get Downex value");
        assert!(val.ends_with("--autostart"), "Value must end with --autostart flag: {}", val);
        assert!(val.starts_with('"'), "Executable path must be double-quoted: {}", val);

        // 3. Disable autostart
        let res_off = set_autostart_registered(false);
        assert!(res_off.is_ok(), "Failed to unregister autostart: {:?}", res_off);
        assert!(!is_autostart_registered(), "Autostart should not be registered");

        // 4. Verify value is removed from registry
        let check_val = run_key.get_value::<String, _>(VALUE_NAME);
        assert!(check_val.is_err(), "Downex value must be deleted from Run key");
    }

    #[test]
    fn test_sync_autostart_on_boot() {
        let temp_dir = std::env::temp_dir().join(format!("downex_test_db_{}", uuid::Uuid::new_v4()));
        let _ = std::fs::create_dir_all(&temp_dir);
        let db_path = temp_dir.join("test.db");
        let db = DatabaseManager::new(&db_path).expect("Failed to create test db");

        // Test 1: Unset -> defaults to true
        sync_autostart_on_boot(&db);
        let s1 = db.get_setting("autostart_enabled").unwrap();
        assert_eq!(s1, Some("true".to_string()));

        // Test 2: Explicitly false
        db.set_setting("autostart_enabled", "false").unwrap();
        sync_autostart_on_boot(&db);
        let s2 = db.get_setting("autostart_enabled").unwrap();
        assert_eq!(s2, Some("false".to_string()));

        // Clean up
        let _ = set_autostart_registered(false);
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}

