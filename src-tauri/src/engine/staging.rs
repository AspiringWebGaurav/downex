use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

static CLAIMED_TARGET_PATHS: Mutex<Option<HashMap<String, usize>>> = Mutex::new(None);
static CLAIMED_STAGING_PATHS: Mutex<Option<HashSet<String>>> = Mutex::new(None);
static STAGING_COUNTER: AtomicU64 = AtomicU64::new(1);

fn normalize_path_key(path: &Path) -> String {
    path.to_string_lossy().replace('/', "\\").to_lowercase()
}

pub fn claim_target_path(path: &Path) {
    let key = normalize_path_key(path);
    let mut lock = CLAIMED_TARGET_PATHS.lock().unwrap_or_else(|e| e.into_inner());
    let map = lock.get_or_insert_with(HashMap::new);
    *map.entry(key).or_insert(0) += 1;
}

pub fn release_target_path(path: &Path) {
    let key = normalize_path_key(path);
    if let Ok(mut lock) = CLAIMED_TARGET_PATHS.lock() {
        if let Some(map) = lock.as_mut() {
            if let Some(count) = map.get_mut(&key) {
                if *count <= 1 {
                    map.remove(&key);
                } else {
                    *count -= 1;
                }
            }
        }
    }
}

pub fn is_target_path_claimed(path: &Path) -> bool {
    let key = normalize_path_key(path);
    if let Ok(lock) = CLAIMED_TARGET_PATHS.lock() {
        if let Some(map) = lock.as_ref() {
            return map.contains_key(&key);
        }
    }
    false
}

pub fn try_claim_staging_path(path: &Path) -> bool {
    let key = normalize_path_key(path);
    let mut lock = CLAIMED_STAGING_PATHS.lock().unwrap_or_else(|e| e.into_inner());
    let set = lock.get_or_insert_with(HashSet::new);
    set.insert(key)
}

pub fn release_staging_path(path: &Path) {
    let key = normalize_path_key(path);
    if let Ok(mut lock) = CLAIMED_STAGING_PATHS.lock() {
        if let Some(set) = lock.as_mut() {
            set.remove(&key);
        }
    }
}

pub fn is_staging_path_claimed(path: &Path) -> bool {
    let key = normalize_path_key(path);
    if let Ok(lock) = CLAIMED_STAGING_PATHS.lock() {
        if let Some(set) = lock.as_ref() {
            return set.contains(&key);
        }
    }
    false
}

/// RAII guard that reserves a destination path across concurrent downloads.
pub struct TargetClaimGuard {
    path: PathBuf,
}

impl TargetClaimGuard {
    pub fn new(path: PathBuf) -> Self {
        claim_target_path(&path);
        Self { path }
    }
}

impl Drop for TargetClaimGuard {
    fn drop(&mut self) {
        release_target_path(&self.path);
    }
}

/// RAII guard that reserves an active `unconfirmed.*.downex` staging file in memory.
pub struct StagingClaimGuard {
    path: PathBuf,
}

impl StagingClaimGuard {
    pub fn new(path: PathBuf) -> Self {
        let _ = try_claim_staging_path(&path);
        Self { path }
    }
}

impl Drop for StagingClaimGuard {
    fn drop(&mut self) {
        release_staging_path(&self.path);
    }
}

fn short_hash_8(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    let digest = hasher.finalize();
    format!(
        "{:02x}{:02x}{:02x}{:02x}",
        digest[0], digest[1], digest[2], digest[3]
    )
}

fn truncate_to_utf16_limit(s: &str, max_units: usize) -> String {
    let mut out = String::new();
    let mut units = 0usize;
    for ch in s.chars() {
        let ch_len = ch.len_utf16();
        if units + ch_len > max_units {
            break;
        }
        out.push(ch);
        units += ch_len;
    }
    out
}

/// Extended-length path (`\\?\`) fallback for paths approaching or exceeding Windows MAX_PATH (240+ UTF-16 units).
pub fn to_win_io_path(path: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let s = path.to_string_lossy().replace('/', "\\");
        if s.starts_with(r"\\?\") {
            return PathBuf::from(s);
        }
        if s.encode_utf16().count() < 240 {
            return path.to_path_buf();
        }
        if let Some(rest) = s.strip_prefix(r"\\") {
            return PathBuf::from(format!(r"\\?\UNC\{}", rest));
        }
        if s.len() >= 3 && s.as_bytes()[1] == b':' && s.as_bytes()[2] == b'\\' {
            return PathBuf::from(format!(r"\\?\{}", s));
        }
        if let Ok(cwd) = std::env::current_dir() {
            let abs = cwd.join(&s).to_string_lossy().replace('/', "\\");
            if abs.len() >= 3 && abs.as_bytes()[1] == b':' {
                return PathBuf::from(format!(r"\\?\{}", abs));
            }
        }
    }
    path.to_path_buf()
}

fn tag_or_empty(tag: Option<&str>) -> String {
    match tag {
        Some(t) if !t.is_empty() => format!("{}.", t),
        _ => String::new(),
    }
}

/// Formats `unconfirmed.{og_name}.downex` (or tagged / hash-shortened fallback near Windows MAX_PATH).
pub fn format_unconfirmed_filename(
    og_name: &str,
    unique_tag: Option<&str>,
    parent_len_utf16: usize,
) -> String {
    let prefix = match unique_tag {
        Some(tag) if !tag.is_empty() => format!("unconfirmed.{}.", tag),
        _ => "unconfirmed.".to_string(),
    };
    let suffix = ".downex";
    let candidate = format!("{}{}{}", prefix, og_name, suffix);
    let max_total_utf16 = 240usize;
    let candidate_units = candidate.encode_utf16().count();

    if parent_len_utf16 + 1 + candidate_units <= max_total_utf16 {
        return candidate;
    }

    // Long-path fallback: preserve `unconfirmed.` prefix, truncated stem, deterministic 8-hex hash, and `.downex`.
    let hash = short_hash_8(og_name);
    let fixed_units = parent_len_utf16
        + 1
        + prefix.encode_utf16().count()
        + 1
        + hash.len()
        + suffix.len();
    let available_og = max_total_utf16.saturating_sub(fixed_units);

    if available_og >= 8 {
        let trimmed = truncate_to_utf16_limit(og_name, available_og);
        let clean_trimmed = trimmed.trim_end_matches(|c: char| c == ' ' || c == '.');
        format!("{}{}~{}{}", prefix, clean_trimmed, hash, suffix)
    } else {
        format!("unconfirmed.{}{}{}", tag_or_empty(unique_tag), hash, suffix)
    }
}

/// Derives the primary `unconfirmed.{og_name}.downex` companion path without mutating claim state.
pub fn derive_primary_unconfirmed_path(dst: &Path) -> PathBuf {
    let og_name = dst
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "download".to_string());
    let parent = dst.parent().unwrap_or_else(|| Path::new("."));
    let parent_utf16_len = parent.to_string_lossy().encode_utf16().count();
    let name = format_unconfirmed_filename(&og_name, None, parent_utf16_len);
    parent.join(name)
}

/// Returns true if the filename represents a Downex unconfirmed staging artifact (`unconfirmed.*.downex`).
pub fn is_unconfirmed_staging_path(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    name.starts_with("unconfirmed.") && name.ends_with(".downex")
}

/// Resolves and atomically claims a unique `unconfirmed.{og_name}.downex` path in the destination directory.
/// Fallbacks:
/// 1. Reclaims persisted `existing_staging` when resuming an existing task (if not claimed by another live worker).
/// 2. Uses `unconfirmed.{og_name}.downex` when free on disk and unclaimed.
/// 3. Falls back to `unconfirmed.<task_tag>.<og_name>.downex` or sequential `unconfirmed.uN.<og_name>.downex` on collision.
/// 4. Shortens cleanly via UTF-16 budget + SHA-256 tag near Windows MAX_PATH.
pub fn resolve_unconfirmed_staging_path(
    dst: &Path,
    unique_hint: Option<&str>,
    existing_staging: Option<&Path>,
) -> PathBuf {
    if let Some(existing) = existing_staging {
        if !existing.as_os_str().is_empty()
            && !is_staging_path_claimed(existing)
            && try_claim_staging_path(existing)
        {
            return existing.to_path_buf();
        }
    }

    let og_name = dst
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "download".to_string());
    let parent = dst.parent().unwrap_or_else(|| Path::new("."));
    let parent_utf16_len = parent.to_string_lossy().encode_utf16().count();

    let primary_name = format_unconfirmed_filename(&og_name, None, parent_utf16_len);
    let primary_candidate = parent.join(&primary_name);
    let primary_io = to_win_io_path(&primary_candidate);

    if !is_staging_path_claimed(&primary_candidate)
        && !primary_io.exists()
        && try_claim_staging_path(&primary_candidate)
    {
        return primary_candidate;
    }

    // Collision fallback 1: unique deterministic task hint (`unconfirmed.<tag>.<og_name>.downex`)
    let hint_tag = unique_hint
        .map(|h| {
            let clean: String = h.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
            if clean.len() > 8 {
                clean[clean.len() - 8..].to_string()
            } else {
                clean
            }
        })
        .filter(|s| !s.is_empty());

    if let Some(ref tag) = hint_tag {
        let tagged_name = format_unconfirmed_filename(&og_name, Some(tag), parent_utf16_len);
        let tagged_candidate = parent.join(tagged_name);
        if !to_win_io_path(&tagged_candidate).exists()
            && !is_staging_path_claimed(&tagged_candidate)
            && try_claim_staging_path(&tagged_candidate)
        {
            return tagged_candidate;
        }
    }

    // Collision fallback 2: monotonic counter tag (`unconfirmed.uN.<og_name>.downex`)
    loop {
        let seq = STAGING_COUNTER.fetch_add(1, Ordering::SeqCst);
        let tag = format!("u{}", seq);
        let candidate_name = format_unconfirmed_filename(&og_name, Some(&tag), parent_utf16_len);
        let candidate = parent.join(candidate_name);
        if !to_win_io_path(&candidate).exists()
            && !is_staging_path_claimed(&candidate)
            && try_claim_staging_path(&candidate)
        {
            return candidate;
        }
    }
}

/// Prepares the staging path prior to opening `PositionalWriter`.
/// Returns `effective_is_resume`:
/// - `true` when resuming from an existing `unconfirmed.*.downex` file (or migrated legacy file).
/// - `false` if no partial file exists on disk (prevents corrupt sparse-zero resume if file was externally deleted).
pub fn prepare_staging_for_download(
    staging_path: &Path,
    final_dst: &Path,
    requested_resume: bool,
) -> bool {
    if let Some(parent) = staging_path.parent() {
        let _ = fs::create_dir_all(to_win_io_path(parent));
    }

    let staging_io = to_win_io_path(staging_path);
    if !requested_resume {
        return false;
    }

    if staging_io.exists() {
        return true;
    }

    // Fallback layer: migrate legacy pre-staging partial file at `final_dst` into `unconfirmed.*.downex`.
    let dst_io = to_win_io_path(final_dst);
    if dst_io.exists() {
        if try_move_file_once(&dst_io, &staging_io, false).is_ok()
            || fs::rename(&dst_io, &staging_io).is_ok()
        {
            eprintln!(
                "[Downex Staging] Migrated legacy partial file '{}' -> '{}'",
                final_dst.display(),
                staging_path.display()
            );
            return true;
        }
    }

    // Neither staging nor legacy file exists on disk -> force clean fresh download from byte 0.
    false
}

/// Verifies physical disk integrity on `unconfirmed.*.downex` AFTER all writer handles are closed.
pub fn verify_staged_file_integrity(
    staging_path: &Path,
    expected_total: Option<u64>,
    verified_downloaded: u64,
) -> Result<u64, String> {
    let staging_io = to_win_io_path(staging_path);
    let meta = fs::metadata(&staging_io).map_err(|e| {
        format!(
            "Cannot inspect staging file '{}' before finalization: {}",
            staging_path.display(),
            e
        )
    })?;
    let actual_len = meta.len();

    if let Some(expected) = expected_total {
        if expected > 0 && actual_len != expected {
            return Err(format!(
                "Staging size mismatch on '{}': expected {} bytes, got {} bytes",
                staging_path.display(),
                expected,
                actual_len
            ));
        }
    } else if verified_downloaded > 0 && actual_len < verified_downloaded {
        return Err(format!(
            "Staging file '{}' truncated on disk: expected at least {} bytes, got {} bytes",
            staging_path.display(),
            verified_downloaded,
            actual_len
        ));
    }

    Ok(actual_len)
}

fn clear_readonly_if_exists(path: &Path) {
    let io_path = to_win_io_path(path);
    if let Ok(meta) = fs::metadata(&io_path) {
        let mut permissions = meta.permissions();
        if permissions.readonly() {
            #[allow(clippy::permissions_set_readonly_false)]
            permissions.set_readonly(false);
            let _ = fs::set_permissions(&io_path, permissions);
        }
    }
}

fn try_move_file_once(from: &Path, to: &Path, replace_existing: bool) -> std::io::Result<()> {
    let from_io = to_win_io_path(from);
    let to_io = to_win_io_path(to);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        let wide_from: Vec<u16> = from_io
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let wide_to: Vec<u16> = to_io
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let flags = if replace_existing {
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH
        } else {
            MOVEFILE_WRITE_THROUGH
        };
        let success = unsafe { MoveFileExW(wide_from.as_ptr(), wide_to.as_ptr(), flags) };
        if success != 0 {
            Ok(())
        } else {
            Err(std::io::Error::last_os_error())
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = replace_existing;
        fs::rename(from_io, to_io)
    }
}

/// Resolves a non-colliding final target path if another unrelated file appeared at `target` mid-download.
pub fn resolve_non_colliding_final_target(target: &Path) -> PathBuf {
    let target_io = to_win_io_path(target);
    if !target_io.exists() {
        return target.to_path_buf();
    }

    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let file_name = target
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "download".to_string());
    let stem = target
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| file_name.clone());
    let ext = target.extension().map(|e| e.to_string_lossy().to_string());

    let mut counter = 1u32;
    loop {
        let candidate_name = match &ext {
            Some(e) if !e.is_empty() => format!("{} ({}).{}", stem, counter, e),
            _ => format!("{} ({})", stem, counter),
        };
        let candidate = parent.join(candidate_name);
        if !to_win_io_path(&candidate).exists() && !is_target_path_claimed(&candidate) {
            return candidate;
        }
        counter += 1;
    }
}

fn copy_verify_delete_promote(
    from_io: &Path,
    to_io: &Path,
    expected_len: u64,
) -> std::io::Result<()> {
    // Safety guard: never overwrite an existing file during copy fallback
    if to_io.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "Final target already exists during copy-verify-delete fallback",
        ));
    }

    let mut src = OpenOptions::new().read(true).open(from_io)?;
    let mut dst = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(to_io)?;

    let copy_res = std::io::copy(&mut src, &mut dst);
    if let Err(e) = copy_res {
        drop(dst);
        let _ = fs::remove_file(to_io);
        return Err(e);
    }

    if let Err(e) = dst.sync_all() {
        drop(dst);
        let _ = fs::remove_file(to_io);
        return Err(e);
    }
    drop(dst);
    drop(src);

    let actual_len = fs::metadata(to_io)?.len();
    if actual_len != expected_len {
        let _ = fs::remove_file(to_io);
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!(
                "Copied destination length mismatch: expected {}, got {}",
                expected_len, actual_len
            ),
        ));
    }

    let _ = robust_delete_path_checked(from_io);
    Ok(())
}

/// Multi-tier atomic promotion (`unconfirmed.{og_name}.downex` -> `{og_name}`) with AV/Explorer lock retry and verification fallbacks.
/// Returns the actual finalized `PathBuf` (same as `target_dst` unless an unrelated file appeared there mid-download).
pub fn promote_unconfirmed_to_final(
    staging_path: &Path,
    target_dst: &Path,
    expected_len: u64,
) -> Result<PathBuf, String> {
    let staging_io = to_win_io_path(staging_path);
    if !staging_io.exists() {
        return Err(format!(
            "Staging file '{}' missing before promotion",
            staging_path.display()
        ));
    }

    // Collision guard: never overwrite an unrelated file created at `target_dst` mid-download
    let final_dst = resolve_non_colliding_final_target(target_dst);
    let final_io = to_win_io_path(&final_dst);

    if let Some(parent) = final_dst.parent() {
        let _ = fs::create_dir_all(to_win_io_path(parent));
    }

    // Tier 1: Direct Win32 MoveFileExW with progressive retry backoff (survives brief Windows Defender / Explorer handle locks)
    let mut last_err: Option<std::io::Error> = None;
    for attempt in 0..12u64 {
        match try_move_file_once(&staging_io, &final_io, false) {
            Ok(()) => {
                verify_final_promoted_file(&final_io, expected_len)?;
                notify_explorer_rename(staging_path, &final_dst);
                return Ok(final_dst);
            }
            Err(e) => {
                if attempt == 2 {
                    clear_readonly_if_exists(staging_path);
                }
                last_err = Some(e);
                std::thread::sleep(Duration::from_millis(20 + attempt * 20));
            }
        }
    }

    // Tier 2: Standard std::fs::rename fallback (after ensuring destination does not exist)
    clear_readonly_if_exists(staging_path);
    let retry_dst = if final_io.exists() {
        resolve_non_colliding_final_target(target_dst)
    } else {
        final_dst.clone()
    };
    let retry_io = to_win_io_path(&retry_dst);

    if fs::rename(&staging_io, &retry_io).is_ok() {
        verify_final_promoted_file(&retry_io, expected_len)?;
        notify_explorer_rename(staging_path, &retry_dst);
        return Ok(retry_dst);
    }

    // Tier 3: Verified copy + fsync + byte-length verification + staging delete fallback
    // (Handles filter drivers / cross-volume / virtualized folders where rename is blocked)
    let copy_dst = if retry_io.exists() {
        resolve_non_colliding_final_target(target_dst)
    } else {
        retry_dst
    };
    let copy_io = to_win_io_path(&copy_dst);

    match copy_verify_delete_promote(&staging_io, &copy_io, expected_len) {
        Ok(()) => {
            notify_explorer_rename(staging_path, &copy_dst);
            Ok(copy_dst)
        }
        Err(copy_err) => {
            // Tier 4: Preserve `unconfirmed.*.downex` intact on disk so user can resume/retry without losing data
            let tier1_msg = last_err
                .map(|e| e.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            Err(format!(
                "Unable to finalize '{}' from '{}' (locked by another program or antivirus). Preserved staging file safely. Rename err: {}; Fallback err: {}",
                copy_dst.display(),
                staging_path.display(),
                tier1_msg,
                copy_err
            ))
        }
    }
}

fn verify_final_promoted_file(final_io: &Path, expected_len: u64) -> Result<(), String> {
    let meta = fs::metadata(final_io).map_err(|e| {
        format!(
            "Finalized file '{}' missing after promotion: {}",
            final_io.display(),
            e
        )
    })?;
    if expected_len > 0 && meta.len() != expected_len {
        return Err(format!(
            "Finalized file '{}' size mismatch: expected {} bytes, got {} bytes",
            final_io.display(),
            expected_len,
            meta.len()
        ));
    }
    Ok(())
}

pub fn notify_explorer_rename(from: &Path, to: &Path) {
    #[cfg(target_os = "windows")]
    unsafe {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::Shell::{
            SHChangeNotify, SHCNE_RENAMEITEM, SHCNE_UPDATEDIR, SHCNF_FLUSH, SHCNF_PATHW,
        };
        let wide_from: Vec<u16> = from
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let wide_to: Vec<u16> = to
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        SHChangeNotify(
            SHCNE_RENAMEITEM as i32,
            SHCNF_PATHW | SHCNF_FLUSH,
            wide_from.as_ptr() as *const std::ffi::c_void,
            wide_to.as_ptr() as *const std::ffi::c_void,
        );
        if let Some(parent) = to.parent() {
            let wide_parent: Vec<u16> = parent
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            SHChangeNotify(
                SHCNE_UPDATEDIR as i32,
                SHCNF_PATHW | SHCNF_FLUSH,
                wide_parent.as_ptr() as *const std::ffi::c_void,
                std::ptr::null(),
            );
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (from, to);
    }
}

/// Multi-attempt deletion with read-only clearing (survives brief Windows Explorer / AV handle locks).
pub fn robust_delete_path_checked(path: &Path) -> Result<(), String> {
    let io_path = to_win_io_path(path);
    if !io_path.exists() {
        return Ok(());
    }

    let mut last_err: Option<std::io::Error> = None;
    for attempt in 0..40u64 {
        if !io_path.exists() {
            return Ok(());
        }
        clear_readonly_if_exists(path);
        let res = if io_path.is_dir() {
            fs::remove_dir_all(&io_path)
        } else {
            fs::remove_file(&io_path)
        };
        match res {
            Ok(()) => return Ok(()),
            Err(e) => {
                if !io_path.exists() {
                    return Ok(());
                }
                last_err = Some(e);
                std::thread::sleep(Duration::from_millis(30 + (attempt.min(6) * 10)));
            }
        }
    }

    Err(format!(
        "Failed to remove '{}': {}",
        path.display(),
        last_err
            .map(|e| e.to_string())
            .unwrap_or_else(|| "unknown error".to_string())
    ))
}

pub fn robust_delete_path(path: &Path) {
    let _ = robust_delete_path_checked(path);
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn make_temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("downex_staging_test_{}_{}", name, Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_unconfirmed_naming_and_long_path_fallback() {
        let dir = PathBuf::from(r"C:\Users\gaura\Downloads\Downex");
        let dst = dir.join("Jailer-2.2026.1080p.mkv");
        let primary = derive_primary_unconfirmed_path(&dst);
        assert_eq!(
            primary.file_name().unwrap().to_string_lossy(),
            "unconfirmed.Jailer-2.2026.1080p.mkv.downex"
        );
        assert!(is_unconfirmed_staging_path(&primary));
        assert!(!is_unconfirmed_staging_path(&dst));

        // Ultra-long filename near Windows MAX_PATH stays within 240 UTF-16 code units and preserves prefix/suffix
        let deep_parent = r"C:\Users\gaura\Downloads\Downex\SubFolderAlpha\SubFolderBeta\SubFolderGamma\ArchivePack";
        let long_name = format!("{}.mkv", "VeryLongMovieTitleName".repeat(12));
        let formatted = format_unconfirmed_filename(
            &long_name,
            Some("abc12345"),
            deep_parent.encode_utf16().count(),
        );
        let full_len = format!("{}\\{}", deep_parent, formatted).encode_utf16().count();
        assert!(
            full_len <= 240,
            "Expected staging path UTF-16 length <= 240, got {}",
            full_len
        );
        assert!(formatted.starts_with("unconfirmed.abc12345."));
        assert!(formatted.ends_with(".downex"));
    }

    #[test]
    fn test_staging_collision_fallback_and_claim_isolation() {
        let dir = make_temp_dir("collision");
        let target = dir.join("ubuntu.iso");

        // Pre-existing unrelated file occupying primary staging name must NEVER be overwritten
        let occupied = dir.join("unconfirmed.ubuntu.iso.downex");
        fs::write(&occupied, b"unrelated").unwrap();

        let staged1 = resolve_unconfirmed_staging_path(&target, Some("task-11112222"), None);
        assert_ne!(staged1, occupied);
        let name1 = staged1.file_name().unwrap().to_string_lossy().to_string();
        assert!(name1.starts_with("unconfirmed.") && name1.ends_with(".downex"));

        // Second concurrent task gets a distinct staging path while first is claimed
        let staged2 = resolve_unconfirmed_staging_path(&target, Some("task-11112222"), None);
        assert_ne!(staged2, staged1);
        assert_ne!(staged2, occupied);

        release_staging_path(&staged1);
        release_staging_path(&staged2);
        assert_eq!(fs::read(&occupied).unwrap(), b"unrelated");
        robust_delete_path(&dir);
    }

    #[test]
    fn test_resume_migration_and_deleted_staging_guard() {
        let dir = make_temp_dir("resume");
        let final_dst = dir.join("movie.mkv");
        let staging = dir.join("unconfirmed.movie.mkv.downex");

        // 1. Deleted staging + missing final -> must force fresh download (effective_is_resume = false)
        assert!(!prepare_staging_for_download(&staging, &final_dst, true));

        // 2. Legacy partial file at final_dst -> migrated cleanly to unconfirmed.*.downex
        fs::write(&final_dst, b"partial-bytes-123").unwrap();
        assert!(prepare_staging_for_download(&staging, &final_dst, true));
        assert!(staging.exists());
        assert!(!final_dst.exists());
        assert_eq!(fs::read(&staging).unwrap(), b"partial-bytes-123");

        // 3. Normal resume with existing staging file keeps it intact
        assert!(prepare_staging_for_download(&staging, &final_dst, true));
        assert_eq!(fs::read(&staging).unwrap(), b"partial-bytes-123");

        robust_delete_path(&dir);
    }

    #[test]
    fn test_verify_and_promote_lifecycle_with_collision_and_readonly_fallbacks() {
        let dir = make_temp_dir("promote");
        let payload = b"Verified payload bytes for atomic Downex staging promotion!";
        let expected_len = payload.len() as u64;

        // 1. Standard promotion: unconfirmed.setup.exe.downex -> setup.exe
        let target1 = dir.join("setup.exe");
        let staging1 = resolve_unconfirmed_staging_path(&target1, Some("task-p1"), None);
        fs::write(&staging1, payload).unwrap();

        // Integrity check rejects wrong length before promotion
        assert!(verify_staged_file_integrity(&staging1, Some(expected_len + 10), expected_len).is_err());
        assert_eq!(verify_staged_file_integrity(&staging1, Some(expected_len), expected_len).unwrap(), expected_len);

        let final1 = promote_unconfirmed_to_final(&staging1, &target1, expected_len).unwrap();
        assert_eq!(final1, target1);
        assert!(target1.exists());
        assert!(!staging1.exists());
        assert_eq!(fs::read(&target1).unwrap(), payload);
        release_staging_path(&staging1);

        // 2. Mid-download destination collision + read-only staging file fallback:
        // If `setup.exe` already exists, promotion must NOT overwrite it and must clear readonly on staging
        let staging2 = resolve_unconfirmed_staging_path(&target1, Some("task-p2"), None);
        let new_payload = b"Second concurrent payload";
        fs::write(&staging2, new_payload).unwrap();
        let mut perms = fs::metadata(&staging2).unwrap().permissions();
        perms.set_readonly(true);
        fs::set_permissions(&staging2, perms).unwrap();

        let final2 = promote_unconfirmed_to_final(&staging2, &target1, new_payload.len() as u64).unwrap();
        assert_ne!(final2, target1);
        assert_eq!(final2.file_name().unwrap().to_string_lossy(), "setup (1).exe");
        assert_eq!(fs::read(&target1).unwrap(), payload, "Existing file must remain untouched");
        assert_eq!(fs::read(&final2).unwrap(), new_payload);
        assert!(!staging2.exists());
        release_staging_path(&staging2);

        robust_delete_path(&dir);
    }

    #[test]
    fn test_copy_verify_delete_fallback_preserves_data_and_removes_staging() {
        let dir = make_temp_dir("copy_fallback");
        let staging = dir.join("unconfirmed.archive.zip.downex");
        let final_dst = dir.join("archive.zip");
        let payload = b"Cross-volume fallback verification bytes 0123456789";

        fs::write(&staging, payload).unwrap();
        copy_verify_delete_promote(&staging, &final_dst, payload.len() as u64).unwrap();

        assert!(final_dst.exists());
        assert!(!staging.exists());
        assert_eq!(fs::read(&final_dst).unwrap(), payload);

        robust_delete_path(&dir);
    }
}

