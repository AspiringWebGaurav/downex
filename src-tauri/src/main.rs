// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == "--native-messaging" || arg.starts_with("chrome-extension://")) {
        let _ = downex_lib::bridge::run_native_host();
    } else {
        downex_lib::run();
    }
}
