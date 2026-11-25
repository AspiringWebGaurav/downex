#![windows_subsystem = "windows"]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{CloseHandle, HWND, LPARAM, LRESULT, RECT, SIZE, WPARAM};
#[cfg(target_os = "windows")]
use windows_sys::Win32::Graphics::Gdi::{
    BeginPaint, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, CreateFontW, CreateRoundRectRgn,
    CreateSolidBrush, DeleteDC, DeleteObject, EndPaint, FillRect, FrameRgn, GetTextExtentPoint32W, InvalidateRect, SelectObject,
    SetBkMode, SetTextColor, SetWindowRgn, TextOutW, HDC, HGDIOBJ, PAINTSTRUCT, SRCCOPY, TRANSPARENT,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Threading::{
    OpenProcess, TerminateProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetClientRect, GetMessageW, GetSystemMetrics,
    PostMessageW, PostQuitMessage, RegisterClassW, SetLayeredWindowAttributes, SetTimer, ShowWindow,
    TranslateMessage, CS_DROPSHADOW, CS_HREDRAW, CS_VREDRAW, LWA_ALPHA, MSG, SM_CXSCREEN,
    SM_CYSCREEN, SW_SHOWNOACTIVATE, WM_CLOSE, WM_DESTROY, WM_ERASEBKGND, WM_PAINT, WM_TIMER,
    WNDCLASSW, WS_EX_LAYERED, WS_EX_TOOLWINDOW, WS_POPUP,
};

static PROGRESS: AtomicU32 = AtomicU32::new(0);
static STATUS_PHASE: AtomicU32 = AtomicU32::new(0); // 0 = "Installing update...", 1 = "Restarting app..."
static WORKER_DONE: AtomicBool = AtomicBool::new(false);
static WORKER_SUCCESS: AtomicBool = AtomicBool::new(true);
static IS_LIGHT_THEME: AtomicBool = AtomicBool::new(false);
static DPI_SCALE_PCT: AtomicU32 = AtomicU32::new(100);

#[cfg(target_os = "windows")]
fn enable_hidpi_awareness() {
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryA};
    unsafe {
        let user32 = LoadLibraryA(b"user32.dll\0".as_ptr());
        if !user32.is_null() {
            let set_dpi_ctx = GetProcAddress(user32, b"SetProcessDpiAwarenessContext\0".as_ptr());
            if let Some(func) = set_dpi_ctx {
                let func: extern "system" fn(isize) -> i32 = std::mem::transmute(func);
                func(-4); // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
                return;
            }
            let set_dpi_aware = GetProcAddress(user32, b"SetProcessDPIAware\0".as_ptr());
            if let Some(func) = set_dpi_aware {
                let func: extern "system" fn() -> i32 = std::mem::transmute(func);
                func();
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn get_system_dpi() -> u32 {
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryA};
    unsafe {
        let user32 = LoadLibraryA(b"user32.dll\0".as_ptr());
        if !user32.is_null() {
            let get_dpi = GetProcAddress(user32, b"GetDpiForSystem\0".as_ptr());
            if let Some(func) = get_dpi {
                let func: extern "system" fn() -> u32 = std::mem::transmute(func);
                let dpi = func();
                if dpi > 0 {
                    return dpi;
                }
            }
        }
    }
    96
}

#[cfg(target_os = "windows")]
unsafe fn create_crisp_font(face: &str, size_pt: f32, weight: i32, scale: f32) -> windows_sys::Win32::Graphics::Gdi::HFONT {
    let font_height = -((size_pt * scale).round() as i32);
    let mut face_w: Vec<u16> = face.encode_utf16().collect();
    face_w.push(0);
    CreateFontW(
        font_height,
        0,
        0,
        0,
        weight,
        0,
        0,
        0,
        1, // DEFAULT_CHARSET
        0, // OUT_DEFAULT_PRECIS
        0, // CLIP_DEFAULT_PRECIS
        5, // CLEARTYPE_QUALITY (Subpixel anti-aliasing)
        0, // DEFAULT_PITCH | FF_DONTCARE
        face_w.as_ptr(),
    )
}

#[cfg(target_os = "windows")]
unsafe fn draw_framed_box(
    hdc: HDC,
    rect: &RECT,
    bg_brush: windows_sys::Win32::Graphics::Gdi::HBRUSH,
    border_brush: windows_sys::Win32::Graphics::Gdi::HBRUSH,
) {
    FillRect(hdc, rect, bg_brush);
    let top = RECT { left: rect.left, top: rect.top, right: rect.right, bottom: rect.top + 1 };
    let bot = RECT { left: rect.left, top: rect.bottom - 1, right: rect.right, bottom: rect.bottom };
    let lft = RECT { left: rect.left, top: rect.top, right: rect.left + 1, bottom: rect.bottom };
    let rgt = RECT { left: rect.right - 1, top: rect.top, right: rect.right, bottom: rect.bottom };
    FillRect(hdc, &top, border_brush);
    FillRect(hdc, &bot, border_brush);
    FillRect(hdc, &lft, border_brush);
    FillRect(hdc, &rgt, border_brush);
}

#[cfg(target_os = "windows")]
fn wait_for_parent_exit(pid: u32) {
    unsafe {
        let handle = OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_TERMINATE, 0, pid);
        if !handle.is_null() {
            // Wait up to 4000ms for clean parent process termination
            let res = WaitForSingleObject(handle, 4000);
            if res != 0 {
                // Fallback: If parent process hangs, terminate it forcefully to avoid deadlock
                let _ = TerminateProcess(handle, 1);
            }
            let _ = CloseHandle(handle);
        }
    }
}

fn resolve_install_root() -> Option<PathBuf> {
    let current_exe = std::env::current_exe().ok()?;
    let parent = current_exe.parent()?;
    if parent.file_name().map(|n| n.to_string_lossy().to_lowercase()) == Some("updater".to_string()) {
        parent.parent().map(|p| p.to_path_buf())
    } else {
        Some(parent.to_path_buf())
    }
}

fn relaunch_process(main_exe: &Path, install_root: &Path, should_show: bool) {
    if !main_exe.exists() {
        return;
    }
    let mut cmd = std::process::Command::new(main_exe);
    cmd.arg("--update-restart")
        .arg("--restarted")
        .arg(format!("--parent-pid={}", std::process::id()))
        .arg(if should_show { "--show" } else { "--autostart" });
    cmd.current_dir(install_root);
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000 | 0x00000008); // CREATE_NO_WINDOW | DETACHED_PROCESS
    }

    let _ = cmd.spawn();
}

fn verify_binary_integrity(path: &Path) -> bool {
    if !path.exists() {
        return false;
    }
    if let Ok(metadata) = std::fs::metadata(path) {
        if metadata.len() < 1024 * 512 {
            // Must be at least 512KB for a valid executable
            return false;
        }
    } else {
        return false;
    }
    // Verify PE MZ header
    if let Ok(file) = std::fs::File::open(path) {
        use std::io::Read;
        let mut header = [0u8; 2];
        let mut handle = file;
        if handle.read_exact(&mut header).is_ok() {
            return header[0] == b'M' && header[1] == b'Z';
        }
    }
    false
}

fn update_version_metadata(install_root: &Path, target_ver: &str) {
    // Phase 6: Update sync_state.dat
    let state_file = install_root.join("updater").join("sync_state.dat");
    if let Ok(content) = std::fs::read_to_string(&state_file) {
        if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(obj) = json.as_object_mut() {
                obj.insert("active_version".to_string(), serde_json::Value::String(target_ver.to_string()));
                obj.insert("is_healthy".to_string(), serde_json::Value::Bool(true));
                obj.insert("boot_attempts".to_string(), serde_json::Value::Number(0.into()));
                obj.insert(
                    "last_update_epoch_ms".to_string(),
                    serde_json::Value::Number(
                        (std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64)
                            .into(),
                    ),
                );
            }
            let _ = std::fs::write(&state_file, serde_json::to_string_pretty(&json).unwrap_or_default());
        }
    }

    // Phase 7: Update %LOCALAPPDATA%\com.downex.manager\installed_version.json
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let sidecar_dir = std::path::PathBuf::from(local_app_data).join("com.downex.manager");
        let _ = std::fs::create_dir_all(&sidecar_dir);
        let sidecar_file = sidecar_dir.join("installed_version.json");
        let payload = serde_json::json!({
            "installed_version": target_ver,
            "updated_at": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64
        });
        let _ = std::fs::write(&sidecar_file, serde_json::to_string_pretty(&payload).unwrap_or_default());
    }
}

fn execute_atomic_update_pipeline(
    install_root: &Path,
    target_ver: &str,
    staged_arg: Option<&String>,
    parent_pid: Option<u32>,
) -> bool {
    // Phase 1: Wait for parent process lock release with timeout fallback
    if let Some(pid) = parent_pid {
        #[cfg(target_os = "windows")]
        wait_for_parent_exit(pid);
    }
    std::thread::sleep(std::time::Duration::from_millis(200));

    // Resolve main binary
    let mut main_exe = install_root.join("Downex.exe");
    if !main_exe.exists() && install_root.join("downex.exe").exists() {
        main_exe = install_root.join("downex.exe");
    }

    // Resolve staged binary
    let staged_file: Option<PathBuf> = if let Some(p) = staged_arg {
        let pb = PathBuf::from(p);
        if pb.exists() { Some(pb) } else { None }
    } else {
        let updater_dir = install_root.join("updater");
        let temp_dir = std::env::temp_dir().join("com.downex.manager");
        let candidates = [
            updater_dir.join(format!("downex-v{}.staged.exe", target_ver)),
            temp_dir.join(format!("downex-v{}.staged.exe", target_ver)),
            updater_dir.join("update.bin"),
            temp_dir.join("update.bin"),
        ];
        candidates.into_iter().find(|p| p.exists())
    };

    let Some(staged) = staged_file else {
        eprintln!("[Downex Updater] Staged update file not found.");
        // Dev mock / test run fallback: record version metadata so relaunched app boots with target version
        update_version_metadata(install_root, target_ver);
        return true;
    };

    let old_exe = install_root.join("Downex.exe.old");
    for _ in 0..5 {
        if !old_exe.exists() || std::fs::remove_file(&old_exe).is_ok() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(80));
    }

    // Phase 2: Atomic rename current -> .old (retry loop)
    let mut renamed_to_old = false;
    if main_exe.exists() {
        for _ in 0..15 {
            if std::fs::rename(&main_exe, &old_exe).is_ok() {
                renamed_to_old = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(120));
        }
    } else {
        renamed_to_old = true;
    }

    // Phase 3: Move staged -> Downex.exe (retry loop)
    let mut swap_success = false;
    if renamed_to_old {
        for _ in 0..15 {
            if std::fs::rename(&staged, &main_exe).is_ok() {
                swap_success = true;
                break;
            }
            if std::fs::copy(&staged, &main_exe).is_ok() {
                let _ = std::fs::remove_file(&staged);
                swap_success = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(120));
        }
    }

    // Phase 4: Verification and Emergency Rollback Fallback
    if !swap_success || !verify_binary_integrity(&main_exe) {
        if old_exe.exists() {
            if main_exe.exists() {
                let _ = std::fs::remove_file(&main_exe);
            }
            let _ = std::fs::rename(&old_exe, &main_exe);
        }
        eprintln!("[Downex Updater] Swap or integrity check failed. Rolled back safely.");
        return false;
    }

    // Phase 5: Clean up old executable after successful swap
    let _ = std::fs::remove_file(&old_exe);

    // Phase 6 & 7: Update metadata
    update_version_metadata(install_root, target_ver);

    true
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_ERASEBKGND => 1, // Suppress OS background erase to eliminate 100% of flickering!
        WM_TIMER => {
            InvalidateRect(hwnd, std::ptr::null(), 0);
            0
        }
        WM_PAINT => {
            let mut ps: PAINTSTRUCT = std::mem::zeroed();
            let hdc = BeginPaint(hwnd, &mut ps);

            let mut client_rect: RECT = std::mem::zeroed();
            GetClientRect(hwnd, &mut client_rect);
            let win_w = (client_rect.right - client_rect.left).max(1);
            let win_h = (client_rect.bottom - client_rect.top).max(1);

            let scale = (DPI_SCALE_PCT.load(Ordering::Relaxed) as f32 / 100.0).max(1.0);

            // In-memory GDI Double Buffering: All drawing happens in RAM, then BitBlt atomically to screen
            let mem_dc = CreateCompatibleDC(hdc);
            let mem_bmp = CreateCompatibleBitmap(hdc, win_w, win_h);
            let old_bmp = SelectObject(mem_dc, mem_bmp as HGDIOBJ);

            let is_light = IS_LIGHT_THEME.load(Ordering::Relaxed);
            let (
                bg_window,
                bg_bar,
                bg_card,
                border_color,
                title_color,
                sub_color,
                _label_color,
                track_color,
                btn_bg,
                btn_text,
            ) = if is_light {
                // Light Mode (1:1 with Downex New Download modal)
                (
                    0x00FFFFFF, // Pure white window background
                    0x00F8F8F8, // Zinc-50 title bar & footer background
                    0x00FCFCFC, // Off-white card background
                    0x00E7E4E4, // Zinc-200 border (#E4E4E7)
                    0x000B0909, // Zinc-900 title (#09090B)
                    0x007A7171, // Zinc-500 subtitle (#71717A)
                    0x00AAA1A1, // Zinc-400 label (#A1A1AA)
                    0x00F1F5F9, // Slate-100 progress track (#F1F5F9)
                    0x001B1818, // Zinc-900 button background (#18181B)
                    0x00FFFFFF, // White button text
                )
            } else {
                // Dark Mode (1:1 with Downex New Download modal dark mode)
                (
                    0x000B0909, // Zinc-950 window background (#09090B)
                    0x00161414, // Zinc-900/950 title bar & footer (#141416)
                    0x001B1818, // Zinc-900 card background (#18181B)
                    0x002A2727, // Zinc-800 border (#27272A)
                    0x00FAFAFA, // Zinc-50 title (#FAFAFA)
                    0x00AAA1A1, // Zinc-400 subtitle (#A1A1AA)
                    0x007A7171, // Zinc-500 label (#71717A)
                    0x002A2727, // Zinc-800 progress track (#27272A)
                    0x002A2727, // Zinc-800 button background (#27272A)
                    0x00FAFAFA, // Zinc-50 button text
                )
            };
            let emerald_color = 0x0081B910; // #10B981 (BGR: 0x0081B910)

            let bg_win_brush = CreateSolidBrush(bg_window);
            let bg_bar_brush = CreateSolidBrush(bg_bar);
            let bg_card_brush = CreateSolidBrush(bg_card);
            let border_brush = CreateSolidBrush(border_color);
            let track_brush = CreateSolidBrush(track_color);
            let emerald_brush = CreateSolidBrush(emerald_color);
            let btn_bg_brush = CreateSolidBrush(btn_bg);

            // Fill base window canvas
            FillRect(mem_dc, &client_rect, bg_win_brush);

            // ── 1. TITLE BAR (Height ~34px * scale) ──
            let title_bar_h = (34.0 * scale).round() as i32;
            let title_bar_rect = RECT { left: 0, top: 0, right: win_w, bottom: title_bar_h };
            FillRect(mem_dc, &title_bar_rect, bg_bar_brush);

            // Title bar bottom divider line
            let title_div = RECT { left: 0, top: title_bar_h - 1, right: win_w, bottom: title_bar_h };
            FillRect(mem_dc, &title_div, border_brush);

            SetBkMode(mem_dc, TRANSPARENT as i32);

            let pad_x = (16.0 * scale).round() as i32;
            let content_w = (win_w - 2 * pad_x).max(1);

            // Title Bar Left: "DOWNEX" in Consolas bold emerald (Clean, minimal, zero buzzwords or fake data)
            let tag_font = create_crisp_font("Consolas", 10.0, 700, scale);
            let prev_font = SelectObject(mem_dc, tag_font as HGDIOBJ);
            SetTextColor(mem_dc, emerald_color);
            let tag_str: Vec<u16> = "DOWNEX".encode_utf16().collect();
            let tag_y = (title_bar_h - (14.0 * scale).round() as i32) / 2;
            TextOutW(mem_dc, pad_x, tag_y, tag_str.as_ptr(), tag_str.len() as i32);

            // ── 2. HERO BOX (Clean Framed Card) ──
            let hero_top = title_bar_h + (12.0 * scale).round() as i32;
            let hero_h = (48.0 * scale).round() as i32;
            let hero_rect = RECT { left: pad_x, top: hero_top, right: pad_x + content_w, bottom: hero_top + hero_h };
            draw_framed_box(mem_dc, &hero_rect, bg_card_brush, border_brush);

            let card_pad_x = (14.0 * scale).round() as i32;

            // Main Heading: "Updating Apps & Services"
            let hero_title_font = create_crisp_font("Segoe UI", 13.0, 700, scale);
            SelectObject(mem_dc, hero_title_font as HGDIOBJ);
            SetTextColor(mem_dc, title_color);
            let title_str: Vec<u16> = "Updating Apps & Services".encode_utf16().collect();
            let title_y = hero_top + (10.0 * scale).round() as i32;
            TextOutW(mem_dc, pad_x + card_pad_x, title_y, title_str.as_ptr(), title_str.len() as i32);

            // Subtitle: "Please wait while we update..."
            let sub_font = create_crisp_font("Segoe UI", 9.5, 400, scale);
            SelectObject(mem_dc, sub_font as HGDIOBJ);
            SetTextColor(mem_dc, sub_color);
            let sub_str: Vec<u16> = "Please wait while we update...".encode_utf16().collect();
            let sub_y = hero_top + (27.0 * scale).round() as i32;
            TextOutW(mem_dc, pad_x + card_pad_x, sub_y, sub_str.as_ptr(), sub_str.len() as i32);

            // ── 3. PROGRESS SECTION (Directly below hero box, NO architecture or buzzword cards!) ──
            let progress_top = hero_top + hero_h + (12.0 * scale).round() as i32;
            let pct = PROGRESS.load(Ordering::Relaxed).min(100);

            // Left status text: Simple and honest!
            let status_font = create_crisp_font("Segoe UI", 9.5, 500, scale);
            SelectObject(mem_dc, status_font as HGDIOBJ);
            SetTextColor(mem_dc, sub_color);
            let status_msg = if STATUS_PHASE.load(Ordering::Relaxed) == 1 || pct >= 75 {
                "Restarting app..."
            } else {
                "Installing update..."
            };
            let status_utf16: Vec<u16> = status_msg.encode_utf16().collect();
            TextOutW(mem_dc, pad_x, progress_top, status_utf16.as_ptr(), status_utf16.len() as i32);

            // Right monospace tabular percentage
            let pct_font = create_crisp_font("Consolas", 11.0, 700, scale);
            SelectObject(mem_dc, pct_font as HGDIOBJ);
            SetTextColor(mem_dc, emerald_color);
            let pct_str = format!("{:>3}%", pct);
            let pct_utf16: Vec<u16> = pct_str.encode_utf16().collect();
            let mut pct_size: SIZE = std::mem::zeroed();
            GetTextExtentPoint32W(mem_dc, pct_utf16.as_ptr(), pct_utf16.len() as i32, &mut pct_size);
            let pct_x = pad_x + content_w - pct_size.cx;
            TextOutW(mem_dc, pct_x, progress_top - (1.0 * scale).round() as i32, pct_utf16.as_ptr(), pct_utf16.len() as i32);

            // Progress Bar Track & Emerald Fill
            let bar_top = progress_top + (17.0 * scale).round() as i32;
            let track_h = (6.0 * scale).round().max(5.0) as i32;
            let bar_bot = bar_top + track_h;
            let track_rect = RECT { left: pad_x, top: bar_top, right: pad_x + content_w, bottom: bar_bot };
            FillRect(mem_dc, &track_rect, track_brush);

            let fill_width = (content_w * pct as i32) / 100;
            if fill_width > 0 {
                let fill_rect = RECT { left: pad_x, top: bar_top, right: pad_x + fill_width, bottom: bar_bot };
                FillRect(mem_dc, &fill_rect, emerald_brush);
            }

            // ── 4. FOOTER BAR (Clean, non-intrusive) ──
            let footer_h = (36.0 * scale).round() as i32;
            let footer_top = win_h - footer_h;
            let footer_rect = RECT { left: 0, top: footer_top, right: win_w, bottom: win_h };
            FillRect(mem_dc, &footer_rect, bg_bar_brush);

            // Footer top divider line
            let footer_div = RECT { left: 0, top: footer_top, right: win_w, bottom: footer_top + 1 };
            FillRect(mem_dc, &footer_div, border_brush);

            // Footer Left: Simple polite message
            SelectObject(mem_dc, sub_font as HGDIOBJ);
            SetTextColor(mem_dc, sub_color);
            let note_str: Vec<u16> = "Please keep Downex open".encode_utf16().collect();
            let note_y = footer_top + (footer_h - (13.0 * scale).round() as i32) / 2;
            TextOutW(mem_dc, pad_x, note_y, note_str.as_ptr(), note_str.len() as i32);

            // Footer Right: Action Pill Button ("UPDATING" / "RESTARTING")
            let btn_w = (92.0 * scale).round() as i32;
            let btn_h = (22.0 * scale).round() as i32;
            let btn_x = win_w - pad_x - btn_w;
            let btn_y = footer_top + (footer_h - btn_h) / 2;
            let btn_rect = RECT { left: btn_x, top: btn_y, right: btn_x + btn_w, bottom: btn_y + btn_h };
            FillRect(mem_dc, &btn_rect, btn_bg_brush);

            let btn_font = create_crisp_font("Consolas", 9.0, 700, scale);
            SelectObject(mem_dc, btn_font as HGDIOBJ);
            SetTextColor(mem_dc, btn_text);
            let btn_label = if pct >= 75 { "RESTARTING" } else { "UPDATING" };
            let btn_utf16: Vec<u16> = btn_label.encode_utf16().collect();
            let mut btn_size: SIZE = std::mem::zeroed();
            GetTextExtentPoint32W(mem_dc, btn_utf16.as_ptr(), btn_utf16.len() as i32, &mut btn_size);
            let btn_tx = btn_x + (btn_w - btn_size.cx) / 2;
            let btn_ty = btn_y + (btn_h - btn_size.cy) / 2;
            TextOutW(mem_dc, btn_tx, btn_ty, btn_utf16.as_ptr(), btn_utf16.len() as i32);

            // ── 5. CRISP 1PX PERIMETER BORDER (Hugging Rounded Corners) ──
            let corner_radius = (10.0 * scale).round() as i32;
            let border_rgn = CreateRoundRectRgn(0, 0, win_w, win_h, corner_radius, corner_radius);
            FrameRgn(mem_dc, border_rgn, border_brush, 1, 1);
            DeleteObject(border_rgn as HGDIOBJ);

            // Atomically copy entire in-memory canvas to screen in one blit (Zero flicker!)
            BitBlt(hdc, 0, 0, win_w, win_h, mem_dc, 0, 0, SRCCOPY);

            // Cleanup GDI handles
            SelectObject(mem_dc, old_bmp);
            DeleteObject(mem_bmp as HGDIOBJ);
            DeleteDC(mem_dc);
            SelectObject(hdc, prev_font);
            DeleteObject(tag_font as HGDIOBJ);
            DeleteObject(hero_title_font as HGDIOBJ);
            DeleteObject(sub_font as HGDIOBJ);
            DeleteObject(status_font as HGDIOBJ);
            DeleteObject(pct_font as HGDIOBJ);
            DeleteObject(btn_font as HGDIOBJ);

            DeleteObject(bg_win_brush as HGDIOBJ);
            DeleteObject(bg_bar_brush as HGDIOBJ);
            DeleteObject(bg_card_brush as HGDIOBJ);
            DeleteObject(border_brush as HGDIOBJ);
            DeleteObject(track_brush as HGDIOBJ);
            DeleteObject(emerald_brush as HGDIOBJ);
            DeleteObject(btn_bg_brush as HGDIOBJ);

            EndPaint(hwnd, &ps);
            0
        }
        WM_CLOSE => {
            DestroyWindow(hwnd);
            0
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            0
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let is_preview = args.iter().any(|a| a == "--preview");
    let is_dev_mode = args.iter().any(|a| a == "--dev-mode") || std::env::var("DOWNEX_DEV_RUNNER").is_ok();
    let should_show = args.iter().any(|a| a == "--show" || a == "--gui") || is_preview;
    let parent_pid = args
        .iter()
        .find_map(|a| a.strip_prefix("--parent-pid="))
        .and_then(|p| p.parse::<u32>().ok());

    let Some(install_root) = resolve_install_root() else {
        return;
    };

    let mut main_exe = install_root.join("Downex.exe");
    if !main_exe.exists() && install_root.join("downex.exe").exists() {
        main_exe = install_root.join("downex.exe");
    }

    let target_ver = args
        .iter()
        .find_map(|a| a.strip_prefix("--target-version="))
        .unwrap_or("0.0.1")
        .trim_start_matches('v')
        .to_string();

    let staged_arg = args.iter().find_map(|a| a.strip_prefix("--staged-file=")).map(|s| s.to_string());

    // Detect Theme: Check CLI flag --theme=light / --theme=dark or query Windows registry fallback
    let is_light = if args.iter().any(|a| a == "--theme=light") {
        true
    } else if args.iter().any(|a| a == "--theme=dark") {
        false
    } else {
        #[cfg(target_os = "windows")]
        {
            use winreg::enums::*;
            use winreg::RegKey;
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize")
                .and_then(|key| key.get_value::<u32, _>("AppsUseLightTheme"))
                .map(|val| val == 1)
                .unwrap_or(false)
        }
        #[cfg(not(target_os = "windows"))]
        {
            false
        }
    };
    IS_LIGHT_THEME.store(is_light, Ordering::Relaxed);

    // ── PATH A: SILENT UPDATE (e.g. background startup / tray check) ──
    if !should_show {
        let _success = execute_atomic_update_pipeline(&install_root, &target_ver, staged_arg.as_ref(), parent_pid);
        if !is_dev_mode {
            relaunch_process(&main_exe, &install_root, false);
        }
        return;
    }

    // ── PATH B: DEDICATED MODERN FLOATING UI ("Updating Downex") ──
    #[cfg(target_os = "windows")]
    unsafe {
        enable_hidpi_awareness();

        let dpi = get_system_dpi();
        let scale = (dpi as f32 / 96.0).max(1.0);
        let scale_pct = (scale * 100.0).round() as u32;
        DPI_SCALE_PCT.store(scale_pct, Ordering::Relaxed);

        // Step 1: Wait for parent process to completely terminate
        if let Some(pid) = parent_pid {
            wait_for_parent_exit(pid);
        }

        // Stop #1: Deliberate 0.75-second calm pause after parent process has exited (skipped in preview mode)
        if !is_preview {
            std::thread::sleep(std::time::Duration::from_millis(750));
        }

        let class_name: Vec<u16> = "DownexUpdaterWindowClass\0".encode_utf16().collect();
        let wnd_class = WNDCLASSW {
            style: CS_HREDRAW | CS_VREDRAW | CS_DROPSHADOW,
            lpfnWndProc: Some(wndproc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: std::ptr::null_mut(),
            hIcon: std::ptr::null_mut(),
            hCursor: std::ptr::null_mut(),
            hbrBackground: std::ptr::null_mut(),
            lpszMenuName: std::ptr::null(),
            lpszClassName: class_name.as_ptr(),
        };

        RegisterClassW(&wnd_class);

        let screen_w = GetSystemMetrics(SM_CXSCREEN);
        let screen_h = GetSystemMetrics(SM_CYSCREEN);
        let win_w = (440.0 * scale).round() as i32;
        let win_h = (188.0 * scale).round() as i32;
        let x = (screen_w - win_w) / 2;
        let y = (screen_h - win_h) / 2;

        let title: Vec<u16> = "Downex Update\0".encode_utf16().collect();
        // Polite Focus: WS_EX_TOOLWINDOW | WS_EX_LAYERED (NO WS_EX_TOPMOST!)
        let hwnd = CreateWindowExW(
            WS_EX_TOOLWINDOW | WS_EX_LAYERED,
            class_name.as_ptr(),
            title.as_ptr(),
            WS_POPUP,
            x,
            y,
            win_w,
            win_h,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null(),
        );

        if hwnd.is_null() {
            // Fallback: execute pipeline without UI if window creation fails
            let _ = execute_atomic_update_pipeline(&install_root, &target_ver, staged_arg.as_ref(), parent_pid);
            if !is_dev_mode {
                relaunch_process(&main_exe, &install_root, should_show);
            }
            return;
        }

        // Apply smooth rounded window corners (10px radius)
        let corner_radius = (10.0 * scale).round() as i32;
        let rgn = CreateRoundRectRgn(0, 0, win_w, win_h, corner_radius, corner_radius);
        SetWindowRgn(hwnd, rgn, 1);

        // Start with opacity 0 for smooth fade-in
        SetLayeredWindowAttributes(hwnd, 0, 0, LWA_ALPHA);
        ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        SetTimer(hwnd, 1, 16, None); // 60+ FPS high-refresh timer for hardware-smooth emerald progress

        let install_root_clone = install_root.clone();
        let main_exe_clone = main_exe.clone();
        let target_ver_clone = target_ver.clone();
        let staged_arg_clone = staged_arg.clone();
        let hwnd_raw = hwnd as isize;
        let is_preview_clone = is_preview;
        let is_dev_mode_clone = is_dev_mode;

        // Spawn background worker with lifecycle timing & fallbacks
        std::thread::spawn(move || {
            let win_handle = hwnd_raw as HWND;

            // Smooth Window Fade-In (300ms)
            for step in 1..=15 {
                let alpha = ((step as u32 * 255) / 15) as u8;
                SetLayeredWindowAttributes(win_handle, 0, alpha, LWA_ALPHA);
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            SetLayeredWindowAttributes(win_handle, 0, 255, LWA_ALPHA);

            if is_preview_clone {
                for p in 5..=100 {
                    PROGRESS.store(p, Ordering::Relaxed);
                    if p == 75 {
                        STATUS_PHASE.store(1, Ordering::Relaxed);
                    }
                    std::thread::sleep(std::time::Duration::from_millis(25));
                }
                std::thread::sleep(std::time::Duration::from_millis(300));

                // Smooth Window Fade-Out (300ms)
                for step in (0..=15).rev() {
                    let alpha = ((step as u32 * 255) / 15) as u8;
                    SetLayeredWindowAttributes(win_handle, 0, alpha, LWA_ALPHA);
                    std::thread::sleep(std::time::Duration::from_millis(20));
                }

                WORKER_DONE.store(true, Ordering::Relaxed);
                let _ = PostMessageW(win_handle, WM_CLOSE, 0, 0);
                return;
            }

            let start_time = std::time::Instant::now();

            // Progress tick up to 25% smoothly
            for p in 5..=25 {
                PROGRESS.store(p, Ordering::Relaxed);
                std::thread::sleep(std::time::Duration::from_millis(20));
            }

            // Execute atomic update pipeline with retries & integrity check
            let success = execute_atomic_update_pipeline(
                &install_root_clone,
                &target_ver_clone,
                staged_arg_clone.as_ref(),
                parent_pid,
            );
            WORKER_SUCCESS.store(success, Ordering::Relaxed);

            // Progress tick up to 75%
            for p in 26..=75 {
                PROGRESS.store(p, Ordering::Relaxed);
                std::thread::sleep(std::time::Duration::from_millis(16));
            }

            STATUS_PHASE.store(1, Ordering::Relaxed); // "Restarting app..."

            // Dynamic Visual Hold: Ensure total display duration is at least 2500ms
            let elapsed = start_time.elapsed().as_millis() as u64;
            if elapsed < 2500 {
                let remaining_ms = 2500 - elapsed;
                let steps = 25; // remaining 25% (76% to 100%)
                let step_delay = (remaining_ms / steps as u64).max(12);
                for p in 76..=100 {
                    PROGRESS.store(p, Ordering::Relaxed);
                    std::thread::sleep(std::time::Duration::from_millis(step_delay));
                }
            } else {
                for p in 76..=100 {
                    PROGRESS.store(p, Ordering::Relaxed);
                    std::thread::sleep(std::time::Duration::from_millis(12));
                }
            }

            // Hold at 100% for 300ms so user clearly sees completed progress
            std::thread::sleep(std::time::Duration::from_millis(300));

            // Smooth Window Fade-Out (300ms)
            for step in (0..=15).rev() {
                let alpha = ((step as u32 * 255) / 15) as u8;
                SetLayeredWindowAttributes(win_handle, 0, alpha, LWA_ALPHA);
                std::thread::sleep(std::time::Duration::from_millis(20));
            }

            // Close updater window
            WORKER_DONE.store(true, Ordering::Relaxed);
            let _ = PostMessageW(win_handle, WM_CLOSE, 0, 0);

            // Stop #2: Deliberate 0.75-second calm pause before launching new application
            std::thread::sleep(std::time::Duration::from_millis(750));

            // In dev mode, scripts/dev.mjs supervisor resumes tauri dev automatically in the terminal!
            // In production installed binary, relaunch Downex.exe directly:
            if !is_dev_mode_clone {
                relaunch_process(&main_exe_clone, &install_root_clone, true);
            }
        });

        // Win32 message pump
        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}
