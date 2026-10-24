fn main() {
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_env == "gnu" {
        if let Ok(out_dir) = std::env::var("OUT_DIR") {
            let manifest_path = std::path::Path::new(&out_dir).join("default-manifest.o");
            if !manifest_path.exists() {
                let _ = std::process::Command::new("gcc")
                    .args(["-c", "-x", "c", "NUL", "-o"])
                    .arg(&manifest_path)
                    .status();
            }
            if manifest_path.exists() {
                println!("cargo:rustc-link-search=native={}", out_dir);
                println!("cargo:rustc-link-arg=-B{}", out_dir);
            }
        }
    }
    tauri_build::build();
}
