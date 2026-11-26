// Prevents console window on Windows across ALL build profiles (GPN architecture)
#![windows_subsystem = "windows"]

#[cfg(target_os = "windows")]
fn set_app_user_model_id() {
    unsafe {
        let app_id: Vec<u16> = "com.downex.manager\0".encode_utf16().collect();
        let _ = windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(app_id.as_ptr());
    }
}

#[cfg(target_os = "windows")]
fn wait_for_exiting_parent(args: &[String]) {
    let Some(pid_arg) = args.iter().find_map(|a| a.strip_prefix("--parent-pid=")) else {
        return;
    };
    let Ok(pid) = pid_arg.parse::<u32>() else {
        return;
    };
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};
    const PROCESS_SYNCHRONIZE: u32 = 0x0010_0000;
    unsafe {
        let handle = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
        if !handle.is_null() {
            let _ = WaitForSingleObject(handle, 5000);
            let _ = CloseHandle(handle);
        }
    }
}

fn main() {
    #[cfg(target_os = "windows")]
    set_app_user_model_id();

    let args: Vec<String> = std::env::args().collect();

    #[cfg(target_os = "windows")]
    if args.iter().any(|a| a == "--update-restart" || a == "--restarted-after-update" || a == "--restarted") {
        wait_for_exiting_parent(&args);
    }

    // 1. Chromium / Firefox Native Messaging Host Mode (bypass probation counter)
    if args.iter().any(|arg| arg == "--native-messaging" || arg.starts_with("chrome-extension://")) {
        let _ = downex_lib::bridge::run_native_host();
        return;
    }

    let read_bridge_token = || -> Option<String> {
        let mut candidates = Vec::new();
        if let Ok(app_data) = std::env::var("APPDATA") {
            candidates.push(
                std::path::PathBuf::from(app_data)
                    .join("com.downex.manager")
                    .join("bridge.token"),
            );
        }
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            candidates.push(
                std::path::PathBuf::from(local_app_data)
                    .join("com.downex.manager")
                    .join("bridge.token"),
            );
        }
        for token_path in candidates {
            if let Ok(token) = std::fs::read_to_string(&token_path) {
                let trimmed = token.trim();
                if trimmed.len() >= 32 {
                    return Some(trimmed.to_string());
                }
            }
        }
        None
    };

    // 2. Terminal CLI Commands: Attach to parent terminal if invoked from PowerShell/CMD
    let is_status = args.iter().any(|a| a == "--status" || a == "-s");
    let is_help = args.iter().any(|a| a == "--help" || a == "-h");
    let is_version = args.iter().any(|a| a == "--version" || a == "-v");
    let is_background = args.iter().any(|a| {
        a == "--background" || a == "-b" || a == "--silent" || a == "--minimized" || a == "--autostart"
    });

    let is_stop = args.iter().any(|a| a == "--stop" || a == "--quit");
    if is_stop {
        enum StopOutcome {
            Stopped,
            Unauthorized,
            NotRunning,
        }
        let outcome = match std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], 18888)),
            std::time::Duration::from_millis(600),
        ) {
            Ok(mut stream) => {
                use std::io::{Read, Write};
                let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));
                let auth_hdr = read_bridge_token()
                    .map(|t| format!("Authorization: Bearer {}\r\n", t))
                    .unwrap_or_default();
                let req = format!(
                    "POST /api/stop HTTP/1.1\r\nHost: 127.0.0.1:18888\r\n{}Connection: close\r\nContent-Length: 0\r\n\r\n",
                    auth_hdr
                );
                let _ = stream.write_all(req.as_bytes());
                let mut resp = String::new();
                let _ = stream.read_to_string(&mut resp);
                if resp.starts_with("HTTP/1.1 200") {
                    StopOutcome::Stopped
                } else if resp.starts_with("HTTP/1.1 401") {
                    StopOutcome::Unauthorized
                } else {
                    StopOutcome::NotRunning
                }
            }
            Err(_) => StopOutcome::NotRunning,
        };

        match outcome {
            StopOutcome::Stopped => write_to_stdout("\r\n[Downex] Background service stopped successfully.\r\n\r\n"),
            StopOutcome::Unauthorized => write_to_stdout("\r\n[Downex] Background service is running, but bridge token authorization failed (HTTP 401).\r\n\r\n"),
            StopOutcome::NotRunning => write_to_stdout("\r\n[Downex] No active Downex background service found.\r\n\r\n"),
        }
        return;
    }

    if is_status || is_help || is_version {
        if is_help {
            let help_text = format!(
                "\r\n========================================================\r\n\
                 Downex Download Manager - CLI & Background Engine\r\n\
                 ========================================================\r\n\
                 Usage: downex.exe [OPTIONS] [URL]\r\n\r\n\
                 Options:\r\n\
                   --background, -b, --silent   Run Downex silently in the background (system tray, low RAM)\r\n\
                   --status, -s                 Check if Downex background service is currently active\r\n\
                   --stop, --quit               Gracefully terminate running background Downex instance\r\n\
                   --version, -v                Print Downex version\r\n\
                   --native-messaging           Launch Chromium / WebExtension native host pipe\r\n\
                   --help, -h                   Show this help information\r\n\r\n\
                 Examples:\r\n\
                   downex.exe --background      # Start background engine with tray icon & loopback bridge\r\n\
                   downex.exe --status          # Check health of background engine\r\n\
                   downex.exe --stop            # Stop running background engine\r\n\
                   downex.exe https://url/f.zip # Send download URL to Downex\r\n\r\n"
            );
            write_to_stdout(&help_text);
            return;
        }

        if is_version {
            let resolved_ver = std::env::current_exe()
                .ok()
                .and_then(|p| downex_lib::version::extract_pe_version(&p))
                .filter(|v| v != "0.0.0")
                .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());
            let ver_text = format!("Downex v{}\r\n", resolved_ver);
            write_to_stdout(&ver_text);
            return;
        }

        if is_status {
            // Quick loopback check on bridge port 18888 (< 1ms TCP handshake)
            match std::net::TcpStream::connect_timeout(
                &std::net::SocketAddr::from(([127, 0, 0, 1], 18888)),
                std::time::Duration::from_millis(600),
            ) {
                Ok(_) => {
                    write_to_stdout("\r\n[Downex] Status: ACTIVE (Background engine is running on 127.0.0.1:18888)\r\n[Downex] System Tray: Running | Mode: Low-RAM background service\r\n\r\n");
                }
                Err(_) => {
                    write_to_stdout("\r\n[Downex] Status: INACTIVE (Downex is not currently running)\r\n[Downex] To start in background: downex.exe --background\r\n\r\n");
                }
            }
            return;
        }
    }

    // 3. Fast CLI URL Forwarding: If Downex background engine is already running, forward URL to it
    let url_arg = args.iter().skip(1).find(|a| a.starts_with("http://") || a.starts_with("https://"));
    if let Some(url) = url_arg {
        if let Ok(mut stream) = std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], 18888)),
            std::time::Duration::from_millis(500),
        ) {
            use std::io::{Read, Write};
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));
            let body = serde_json::json!({ "url": url }).to_string();
            let auth_hdr = read_bridge_token()
                .map(|t| format!("Authorization: Bearer {}\r\n", t))
                .unwrap_or_default();
            let req = format!(
                "POST /api/download HTTP/1.1\r\nHost: 127.0.0.1:18888\r\n{}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                auth_hdr,
                body.len(),
                body
            );
            let _ = stream.write_all(req.as_bytes());
            let mut resp = String::new();
            let _ = stream.read_to_string(&mut resp);
            if resp.starts_with("HTTP/1.1 200") {
                write_to_stdout(&format!("\r\n[Downex] Forwarded download URL to background engine: {}\r\n\r\n", url));
                return;
            }
        }
    }

    let is_restarted_after_update = args.iter().any(|a| a == "--restarted-after-update" || a == "--update-restart" || a == "--restarted");
    let is_rollback_recovery = args.iter().any(|a| a == "--rollback-recovery" || a == "--rolled-back");
    let is_update_handoff = is_restarted_after_update || is_rollback_recovery;

    if is_update_handoff {
        // We are resuming execution after an in-process OTA update or rollback recovery.
        // If an old instance is still responding on port 18888, instruct it to stop gracefully.
        if let Ok(mut stream) = std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], 18888)),
            std::time::Duration::from_millis(500),
        ) {
            use std::io::{Read, Write};
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));
            let auth_hdr = read_bridge_token()
                .map(|t| format!("Authorization: Bearer {}\r\n", t))
                .unwrap_or_default();
            let req = format!(
                "POST /api/stop HTTP/1.1\r\nHost: 127.0.0.1:18888\r\n{}Connection: close\r\nContent-Length: 0\r\n\r\n",
                auth_hdr
            );
            let _ = stream.write_all(req.as_bytes());
            let mut resp = String::new();
            let _ = stream.read_to_string(&mut resp);
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
        // Proceed directly to evaluate_and_handle_boot_health + downex_lib::run()
    } else if is_background {
        // 4. Background Startup Mode
        let running_downex = std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], 18888)),
            std::time::Duration::from_millis(500),
        )
        .ok()
        .and_then(|mut stream| {
            use std::io::{Read, Write};
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(600)));
            let _ = stream.write_all(b"GET /api/ping HTTP/1.1\r\nHost: 127.0.0.1:18888\r\nConnection: close\r\n\r\n");
            let mut resp = String::new();
            let _ = stream.read_to_string(&mut resp);
            if resp.contains("\"app\":\"Downex\"") { Some(()) } else { None }
        })
        .is_some();

        if running_downex {
            write_to_stdout("\r\n[Downex] Background service is already running on 127.0.0.1:18888.\r\n\r\n");
            return;
        }
        write_to_stdout("\r\n[Downex] Starting background service in system tray (Port 18888)...\r\n[Downex] Optimized low-RAM background mode active.\r\n\r\n");
    } else {
        // 5. Foreground Startup Mode
        let current_exe = std::env::current_exe().unwrap_or_default();
        let current_exe_lower = current_exe.to_string_lossy().to_lowercase();
        let is_current_dev = current_exe_lower.contains("target\\debug") || current_exe_lower.contains("target/debug");

        if let Ok(mut stream) = std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], 18888)),
            std::time::Duration::from_millis(500),
        ) {
            use std::io::{Read, Write};
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));

            // Query /api/ping to check whether the running instance is a development or older instance
            let ping_req = "GET /api/ping HTTP/1.1\r\nHost: 127.0.0.1:18888\r\nConnection: close\r\n\r\n";
            let _ = stream.write_all(ping_req.as_bytes());
            let mut ping_resp = String::new();
            let _ = stream.read_to_string(&mut ping_resp);

            let is_running_dev = ping_resp.contains("\"is_dev\":true")
                || ping_resp.to_lowercase().contains("target\\debug")
                || ping_resp.to_lowercase().contains("target/debug");

            let running_ver = ping_resp
                .split("\r\n\r\n")
                .nth(1)
                .and_then(|body| serde_json::from_str::<serde_json::Value>(body).ok())
                .and_then(|json| json.get("data")?.get("version")?.as_str().map(String::from));

            let current_exe_ver = downex_lib::version::extract_pe_version(&current_exe)
                .filter(|v| v != "0.0.0")
                .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());
            let is_version_outdated = running_ver
                .as_deref()
                .map(|rv| downex_lib::version::compare_semver(rv, &current_exe_ver) == std::cmp::Ordering::Less)
                .unwrap_or(false);

            let auth_hdr = read_bridge_token()
                .map(|t| format!("Authorization: Bearer {}\r\n", t))
                .unwrap_or_default();

            if is_current_dev || (!is_current_dev && is_running_dev) || is_version_outdated {
                // If an orphaned dev instance or an outdated background instance is running,
                // terminate it cleanly so this latest binary can take over and run authoritative!
                if let Ok(mut stop_stream) = std::net::TcpStream::connect_timeout(
                    &std::net::SocketAddr::from(([127, 0, 0, 1], 18888)),
                    std::time::Duration::from_millis(500),
                ) {
                    let stop_req = format!(
                        "POST /api/stop HTTP/1.1\r\nHost: 127.0.0.1:18888\r\n{}Connection: close\r\nContent-Length: 0\r\n\r\n",
                        auth_hdr
                    );
                    let _ = stop_stream.write_all(stop_req.as_bytes());
                }

                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::process::CommandExt;
                    let cur_pid = std::process::id();
                    let kill_cmd = format!(
                        "Get-Process -Name Downex,downex -ErrorAction SilentlyContinue | Where-Object {{ $_.Id -ne {} }} | Stop-Process -Force",
                        cur_pid
                    );
                    let _ = std::process::Command::new("powershell.exe")
                        .args(["-NoProfile", "-Command", &kill_cmd])
                        .creation_flags(0x08000000)
                        .output();
                }

                std::thread::sleep(std::time::Duration::from_millis(300));
                write_to_stdout("\r\n[Downex] Superseded outdated/stale background instance. Launching latest Downex application...\r\n\r\n");
                // Continue execution into downex_lib::run() as the updated app!
            } else {
                let req = format!(
                    "POST /api/bring_to_front HTTP/1.1\r\nHost: 127.0.0.1:18888\r\n{}Connection: close\r\nContent-Length: 0\r\n\r\n",
                    auth_hdr
                );
                if let Ok(mut front_stream) = std::net::TcpStream::connect_timeout(
                    &std::net::SocketAddr::from(([127, 0, 0, 1], 18888)),
                    std::time::Duration::from_millis(500),
                ) {
                    let _ = front_stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));
                    let _ = front_stream.write_all(req.as_bytes());
                    let mut resp = String::new();
                    let _ = front_stream.read_to_string(&mut resp);
                    if resp.starts_with("HTTP/1.1 200") {
                        write_to_stdout("\r\n[Downex] Activated running background instance.\r\n\r\n");
                        return;
                    }
                }
            }
        }
    }

    // Evaluate boot health and auto-rollback only when this process will actually start the runtime
    #[cfg(target_os = "windows")]
    if !downex_lib::ota::evaluate_and_handle_boot_health(&args) {
        return;
    }

    // Detach from any inherited console for completely silent windowless execution
    #[cfg(target_os = "windows")]
    unsafe {
        extern "system" {
            fn FreeConsole() -> i32;
        }
        let _ = FreeConsole();
    }

    downex_lib::run();
}

#[cfg(target_os = "windows")]
fn write_to_stdout(msg: &str) {
    unsafe {
        extern "system" {
            fn GetStdHandle(nStdHandle: u32) -> *mut std::ffi::c_void;
            fn AttachConsole(dwProcessId: u32) -> i32;
            fn WriteFile(
                hFile: *mut std::ffi::c_void,
                lpBuffer: *const u8,
                nNumberOfBytesToWrite: u32,
                lpNumberOfBytesWritten: *mut u32,
                lpOverlapped: *mut std::ffi::c_void,
            ) -> i32;
        }
        const STD_OUTPUT_HANDLE: u32 = 0xFFFFFFF5; // (DWORD)-11
        const ATTACH_PARENT_PROCESS: u32 = 0xFFFFFFFF;

        let mut handle = GetStdHandle(STD_OUTPUT_HANDLE);
        if handle.is_null() || handle as isize == -1 {
            let _ = AttachConsole(ATTACH_PARENT_PROCESS);
            handle = GetStdHandle(STD_OUTPUT_HANDLE);
        }

        if !handle.is_null() && handle as isize != -1 {
            let bytes = msg.as_bytes();
            let mut written = 0u32;
            let _ = WriteFile(
                handle,
                bytes.as_ptr(),
                bytes.len() as u32,
                &mut written,
                std::ptr::null_mut(),
            );
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn write_to_stdout(msg: &str) {
    use std::io::Write;
    let mut out = std::io::stdout();
    let _ = out.write_all(msg.as_bytes());
    let _ = out.flush();
}
