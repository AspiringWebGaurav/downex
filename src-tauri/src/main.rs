// Prevents console window on Windows across ALL build profiles (GPN architecture)
#![windows_subsystem = "windows"]

#[cfg(target_os = "windows")]
fn set_app_user_model_id() {
    unsafe {
        let app_id: Vec<u16> = "com.downex.manager\0".encode_utf16().collect();
        let _ = windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(app_id.as_ptr());
    }
}

fn main() {
    #[cfg(target_os = "windows")]
    set_app_user_model_id();

    let args: Vec<String> = std::env::args().collect();

    // 1. Chromium / Firefox Native Messaging Host Mode
    if args.iter().any(|arg| arg == "--native-messaging" || arg.starts_with("chrome-extension://")) {
        let _ = downex_lib::bridge::run_native_host();
        return;
    }

    // 2. Terminal CLI Commands: Attach to parent terminal if invoked from PowerShell/CMD
    let is_status = args.iter().any(|a| a == "--status" || a == "-s");
    let is_help = args.iter().any(|a| a == "--help" || a == "-h");
    let is_version = args.iter().any(|a| a == "--version" || a == "-v");
    let is_background = args.iter().any(|a| {
        a == "--background" || a == "-b" || a == "--silent" || a == "--minimized" || a == "--autostart"
    });

    let is_stop = args.iter().any(|a| a == "--stop" || a == "--quit");
    if is_stop {
        let stopped = match std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], 18888)),
            std::time::Duration::from_millis(600),
        ) {
            Ok(mut stream) => {
                use std::io::{Read, Write};
                let req = "POST /api/stop HTTP/1.1\r\nHost: 127.0.0.1:18888\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
                let _ = stream.write_all(req.as_bytes());
                let mut resp = String::new();
                let _ = stream.read_to_string(&mut resp);
                true
            }
            Err(_) => false,
        };

        if stopped {
            write_to_stdout("\r\n[Downex] Background service stopped successfully.\r\n\r\n");
        } else {
            write_to_stdout("\r\n[Downex] No active Downex background service found.\r\n\r\n");
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
            let ver_text = format!("Downex v{}\r\n", env!("CARGO_PKG_VERSION"));
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
            let body = format!(r#"{{"url":"{}"}}"#, url);
            let req = format!(
                "POST /api/download HTTP/1.1\r\nHost: 127.0.0.1:18888\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(req.as_bytes());
            let mut resp = String::new();
            let _ = stream.read_to_string(&mut resp);
            write_to_stdout(&format!("\r\n[Downex] Forwarded download URL to background engine: {}\r\n\r\n", url));
            return;
        }
    }

    // 4. Background Startup Mode
    if is_background {
        if let Ok(_) = std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], 18888)),
            std::time::Duration::from_millis(500),
        ) {
            write_to_stdout("\r\n[Downex] Background service is already running on 127.0.0.1:18888.\r\n\r\n");
            return;
        }
        write_to_stdout("\r\n[Downex] Starting background service in system tray (Port 18888)...\r\n[Downex] Optimized low-RAM background mode active.\r\n\r\n");
    } else {
        // 5. Foreground Startup Mode: If an instance is already running in background, bring its window to front!
        if let Ok(mut stream) = std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], 18888)),
            std::time::Duration::from_millis(500),
        ) {
            use std::io::{Read, Write};
            let req = "POST /api/bring_to_front HTTP/1.1\r\nHost: 127.0.0.1:18888\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
            let _ = stream.write_all(req.as_bytes());
            let mut resp = String::new();
            let _ = stream.read_to_string(&mut resp);
            write_to_stdout("\r\n[Downex] Activated running background instance.\r\n\r\n");
            return;
        }
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
