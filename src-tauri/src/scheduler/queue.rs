use crate::db::{DatabaseManager, DownloadRecord};
use crate::engine::{probe_url, DownloadEnginePool, DownloadProgressEvent};
use parking_lot::RwLock;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, Semaphore};
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct QueueManager {
    client: reqwest::Client,
    db: DatabaseManager,
    pool: Arc<DownloadEnginePool>,
    active_tokens: Arc<RwLock<HashMap<String, CancellationToken>>>,
    queue_semaphores: Arc<RwLock<HashMap<String, Arc<Semaphore>>>>,
    progress_tx: mpsc::Sender<DownloadProgressEvent>,
    queue_running: Arc<AtomicBool>,
}

impl QueueManager {
    pub fn new(
        client: reqwest::Client,
        db: DatabaseManager,
        progress_tx: mpsc::Sender<DownloadProgressEvent>,
    ) -> Self {
        let pool = Arc::new(DownloadEnginePool::new(client.clone(), db.clone()));
        let mut semaphores = HashMap::new();
        semaphores.insert("default".to_string(), Arc::new(Semaphore::new(3)));

        Self {
            client,
            db,
            pool,
            active_tokens: Arc::new(RwLock::new(HashMap::new())),
            queue_semaphores: Arc::new(RwLock::new(semaphores)),
            progress_tx,
            queue_running: Arc::new(AtomicBool::new(false)),
        }
    }

    pub async fn probe_url_info(
        &self,
        url: &str,
        custom_headers: Option<&HashMap<String, String>>,
    ) -> Result<crate::engine::state::ProbeResult, Box<dyn std::error::Error + Send + Sync>> {
        probe_url(&self.client, url, custom_headers).await
    }

    pub async fn create_task(
        &self,
        url: String,
        destination_folder: Option<String>,
        queue_id: Option<String>,
        custom_headers: Option<HashMap<String, String>>,
        start_immediately: bool,
        custom_filename: Option<String>,
    ) -> Result<DownloadRecord, Box<dyn std::error::Error + Send + Sync>> {
        // Probe URL to resolve filename, size, range support
        let probe = probe_url(&self.client, &url, custom_headers.as_ref()).await?;

        let id = uuid::Uuid::new_v4().to_string();
        let queue = queue_id.unwrap_or_else(|| "default".to_string());

        // Resolve single unified Downex download folder (strictly no category subfolders)
        let default_dir = PathBuf::from(self.get_default_download_directory());
        let save_dir_buf = match destination_folder {
            Some(ref custom) if !custom.trim().is_empty() => {
                let p = PathBuf::from(custom.trim());
                let p_str = p.to_string_lossy().replace('/', "\\");
                let def_str = default_dir.to_string_lossy().replace('/', "\\");

                // If path ends with any category subfolder, collapse directly to Downex root
                let is_category = [
                    r"\Video", r"\Compressed", r"\Music", r"\Programs", r"\Documents", r"\General",
                    "Downloads\\Video", "Downloads\\Compressed", "Downloads\\Music", "Downloads\\Programs", "Downloads\\Documents"
                ].iter().any(|cat| p_str.ends_with(cat));

                if is_category || p_str == def_str || !p.is_absolute() {
                    default_dir
                } else if std::fs::create_dir_all(&p).is_ok() {
                    p
                } else {
                    default_dir
                }
            }
            _ => default_dir,
        };

        let chosen_filename = if let Some(ref cf) = custom_filename {
            let trimmed = cf.trim();
            // If custom_filename has no dot or is generic, and probe.filename has an extension, prefer probe.filename
            if !trimmed.is_empty() 
                && trimmed != "download" 
                && trimmed != "file" 
                && (trimmed.contains('.') || !probe.filename.contains('.')) 
            {
                trimmed.to_string()
            } else {
                probe.filename
            }
        } else {
            probe.filename
        };

        let _ = std::fs::create_dir_all(&save_dir_buf);
        let dest_path = get_non_colliding_path(&save_dir_buf, &chosen_filename);

        let now = chrono::Utc::now().timestamp_millis();
        let headers_json = custom_headers.as_ref().map(|h| serde_json::to_string(h).unwrap_or_default());
        let initial_status = if start_immediately { "downloading" } else { "queued" };

        let record = DownloadRecord {
            id: id.clone(),
            url: url.clone(),
            filename: chosen_filename,
            destination_path: dest_path.clone(),
            total_bytes: probe.total_bytes,
            downloaded_bytes: 0,
            status: initial_status.to_string(),
            etag: probe.etag,
            last_modified: probe.last_modified,
            headers_json,
            queue_id: queue.clone(),
            speed_bytes_sec: 0,
            error_message: None,
            created_at: now,
            updated_at: now,
        };

        self.db.insert_download(&record)?;

        // Automatically spawn execution in the queue if requested
        if start_immediately {
            self.start_task(record.clone());
        } else if self.is_queue_running() {
            let qm = self.clone();
            tauri::async_runtime::spawn(async move {
                qm.process_next_in_queue().await;
            });
        }

        Ok(record)
    }

    pub async fn process_next_in_queue(&self) -> bool {
        if !self.is_queue_running() {
            return false;
        }

        // Strictly 1-by-1 sequential execution:
        // Check if ANY download is currently downloading or probing
        let downloads = match self.db.get_all_downloads() {
            Ok(d) => d,
            Err(_) => return false,
        };

        let any_active = downloads.iter().any(|d| {
            d.status == "downloading" || d.status == "probing"
        });

        if any_active {
            // A download is currently active, wait for it to complete
            return false;
        }

        // Fetch queued downloads in FIFO order (oldest first)
        let queued = match self.db.get_queued_downloads() {
            Ok(q) => q,
            Err(_) => return false,
        };

        if let Some(next_task) = queued.into_iter().next() {
            eprintln!("[Downex Queue] 1-by-1 Auto-starting: {} ({})", next_task.filename, next_task.id);
            self.start_task(next_task);
            return true;
        }

        eprintln!("[Downex Queue] Simple 1-by-1 queue finished all tasks.");
        false
    }

    pub async fn start_queue(&self) -> usize {
        self.queue_running.store(true, Ordering::Relaxed);
        let queued = self.db.get_queued_downloads().unwrap_or_default();
        let count = queued.len();
        self.process_next_in_queue().await;
        count
    }

    pub fn pause_queue(&self) -> bool {
        self.queue_running.store(false, Ordering::Relaxed);
        // Find any active downloading task that was part of the queue and pause it
        if let Ok(downloads) = self.db.get_all_downloads() {
            for d in downloads {
                if d.status == "downloading" || d.status == "probing" {
                    self.pause_task(&d.id);
                    // Retain place in line
                    let _ = self.db.update_download_status(&d.id, "queued", 0, None);
                }
            }
        }
        true
    }

    pub fn is_queue_running(&self) -> bool {
        self.queue_running.load(Ordering::Relaxed)
    }

    pub fn queue_download(&self, id: &str) -> bool {
        self.pause_task(id);
        let res = self.db.update_download_status(id, "queued", 0, None).is_ok();
        if self.is_queue_running() {
            let qm = self.clone();
            tauri::async_runtime::spawn(async move {
                qm.process_next_in_queue().await;
            });
        }
        res
    }

    pub fn start_task(&self, record: DownloadRecord) {
        let task_id = record.id.clone();
        let cancel_token = CancellationToken::new();

        {
            let mut tokens = self.active_tokens.write();
            tokens.insert(task_id.clone(), cancel_token.clone());
        }

        let pool = self.pool.clone();
        let db = self.db.clone();
        let progress_tx = self.progress_tx.clone();
        let active_tokens = self.active_tokens.clone();
        let qm_clone = self.clone();

        let queue_id = record.queue_id.clone();
        let sem = {
            let mut sems = self.queue_semaphores.write();
            sems.entry(queue_id).or_insert_with(|| Arc::new(Semaphore::new(3))).clone()
        };

        let headers: Option<HashMap<String, String>> = record.headers_json.as_ref().and_then(|h| serde_json::from_str(h).ok());

        tauri::async_runtime::spawn(async move {
            let _permit = sem.acquire().await;

            if cancel_token.is_cancelled() {
                let _ = db.update_download_status(&task_id, "paused", 0, None);
                active_tokens.write().remove(&task_id);
                return;
            }

            let _ = db.update_download_status(&task_id, "downloading", 0, None);

            // Immediate event so UI reflects downloading state right away
            let _ = progress_tx.send(DownloadProgressEvent {
                task_id: task_id.clone(),
                status: "downloading".to_string(),
                downloaded_bytes: record.downloaded_bytes,
                total_bytes: record.total_bytes,
                speed_bytes_sec: 0,
                eta_seconds: None,
                segments: Vec::new(),
            }).await;

            #[cfg(target_os = "windows")]
            prevent_windows_sleep(true);

            let max_conns = db
                .get_setting("max_segments")
                .ok()
                .flatten()
                .and_then(|s| s.parse::<u32>().ok())
                .unwrap_or(32); // Max throughput saturation for 200Mbps+ plans

            let res = pool
                .execute_download(
                    task_id.clone(),
                    record.url,
                    record.destination_path,
                    record.total_bytes,
                    true, // Range supported
                    headers,
                    max_conns,
                    progress_tx,
                    cancel_token,
                )
                .await;

            if let Err(e) = res {
                eprintln!("[Downex Queue] Download failed: {}", e);
                let _ = db.update_download_status(&task_id, "failed", 0, Some(&e.to_string()));
            }

            active_tokens.write().remove(&task_id);

            #[cfg(target_os = "windows")]
            prevent_windows_sleep(false);

            // Simple 1-by-1 Queue trigger: automatically pick up next task in line
            if qm_clone.is_queue_running() {
                let qm = qm_clone.clone();
                tauri::async_runtime::spawn(async move {
                    qm.process_next_in_queue().await;
                });
            }
        });
    }

    pub fn pause_task(&self, id: &str) -> bool {
        let mut tokens = self.active_tokens.write();
        if let Some(token) = tokens.remove(id) {
            token.cancel();
            let _ = self.db.update_download_status(id, "paused", 0, None);
            return true;
        }
        false
    }

    pub async fn resume_task(&self, id: &str) -> bool {
        let downloads = self.db.get_all_downloads().unwrap_or_default();
        if let Some(record) = downloads.into_iter().find(|d| d.id == id) {
            self.start_task(record);
            return true;
        }
        false
    }

    pub fn pause_all_tasks(&self) -> usize {
        let active_ids: Vec<String> = self.active_tokens.read().keys().cloned().collect();
        let mut count = 0;
        for id in active_ids {
            if self.pause_task(&id) {
                count += 1;
            }
        }
        count
    }

    pub async fn resume_all_tasks(&self) -> usize {
        let downloads = self.db.get_all_downloads().unwrap_or_default();
        let paused_records: Vec<_> = downloads
            .into_iter()
            .filter(|d| d.status == "paused" || d.status == "queued" || d.status == "failed")
            .collect();

        let count = paused_records.len();
        for record in paused_records {
            self.start_task(record);
        }
        count
    }

    pub fn cancel_task(&self, id: &str, delete_file: bool) -> bool {
        self.pause_task(id);
        if let Ok(downloads) = self.db.get_all_downloads() {
            if let Some(record) = downloads.into_iter().find(|d| d.id == id) {
                if delete_file {
                    let _ = std::fs::remove_file(&record.destination_path);
                }
            }
        }
        self.db.delete_download(id).is_ok()
    }

    pub async fn change_destination_and_retry(
        &self,
        task_id: &str,
        new_folder: &str,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        self.pause_task(task_id);
        let record = match self.db.get_download(task_id)? {
            Some(r) => r,
            None => return Ok(false),
        };

        let new_folder_path = PathBuf::from(new_folder.trim());
        let _ = std::fs::create_dir_all(&new_folder_path);
        let new_dest = get_non_colliding_path(&new_folder_path, &record.filename);

        self.db.update_download_destination(task_id, &new_dest)?;
        let mut updated_record = record;
        updated_record.destination_path = new_dest;
        updated_record.status = "queued".to_string();
        updated_record.error_message = None;

        self.start_task(updated_record);
        Ok(true)
    }

    pub fn get_default_download_directory(&self) -> String {
        // 1. Check if user configured a custom directory in DB settings
        if let Ok(Some(saved_dir)) = self.db.get_setting("default_download_dir") {
            let path = PathBuf::from(saved_dir.trim());
            if !saved_dir.trim().is_empty() && std::fs::create_dir_all(&path).is_ok() {
                return path.to_string_lossy().to_string();
            }
        }

        // 2. Check Windows Registry (HKCU\Software\Downex\DefaultDownloadDir) - IDM pattern
        #[cfg(target_os = "windows")]
        {
            use winreg::enums::HKEY_CURRENT_USER;
            use winreg::RegKey;
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            if let Ok(key) = hkcu.open_subkey(r"Software\Downex") {
                if let Ok(val) = key.get_value::<String, _>("DefaultDownloadDir") {
                    let path = PathBuf::from(val.trim());
                    if !val.trim().is_empty() && std::fs::create_dir_all(&path).is_ok() {
                        return path.to_string_lossy().to_string();
                    }
                }
            }
        }

        // 3. Fallback to default resolve logic
        resolve_default_download_directory().to_string_lossy().to_string()
    }

    pub fn set_default_download_directory(&self, new_dir: &str) -> Result<String, String> {
        let trimmed = new_dir.trim();
        if trimmed.is_empty() {
            return Err("Download folder path cannot be empty".to_string());
        }

        let target_path = PathBuf::from(trimmed);

        // Verify folder write accessibility on disk (IDM validation pattern)
        std::fs::create_dir_all(&target_path)
            .map_err(|e| format!("Cannot create or access folder '{}': {}", trimmed, e))?;

        // Canonical string representation
        let canonical_str = target_path.to_string_lossy().to_string();

        // 1. Persist to DB settings
        self.db
            .set_setting("default_download_dir", &canonical_str)
            .map_err(|e| format!("Failed to persist download folder in database: {}", e))?;

        // 2. Persist to Windows Registry (IDM pattern)
        #[cfg(target_os = "windows")]
        {
            use winreg::enums::HKEY_CURRENT_USER;
            use winreg::RegKey;
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            if let Ok((key, _)) = hkcu.create_subkey(r"Software\Downex") {
                let _ = key.set_value("DefaultDownloadDir", &canonical_str);
            }
        }

        eprintln!("[Downex Settings] Default download directory updated to: {}", canonical_str);
        Ok(canonical_str)
    }
}

pub fn resolve_default_download_directory() -> PathBuf {
    // 1. Primary: %USERPROFILE%\Downloads\Downex (Single unified folder, no IDM video/document subcategories)
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        let primary = PathBuf::from(&user_profile).join("Downloads").join("Downex");
        if std::fs::create_dir_all(&primary).is_ok() {
            return primary;
        }
        // 2. Fallback: %USERPROFILE%\Downex
        let fallback_profile = PathBuf::from(&user_profile).join("Downex");
        if std::fs::create_dir_all(&fallback_profile).is_ok() {
            return fallback_profile;
        }
    }

    // 3. Fallback: %APPDATA%\Downex\Downloads
    if let Ok(appdata) = std::env::var("APPDATA") {
        let fallback_appdata = PathBuf::from(appdata).join("Downex").join("Downloads");
        if std::fs::create_dir_all(&fallback_appdata).is_ok() {
            return fallback_appdata;
        }
    }

    // 4. Fallback: Local directory Downex_Downloads
    let local = PathBuf::from("Downex_Downloads");
    let _ = std::fs::create_dir_all(&local);
    local
}

pub fn get_non_colliding_path(dir: &Path, filename: &str) -> String {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate.to_string_lossy().to_string();
    }

    let p = Path::new(filename);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or(filename);
    let ext = p.extension().and_then(|e| e.to_str());

    let mut counter = 1;
    loop {
        let new_name = match ext {
            Some(e) => format!("{} ({}).{}", stem, counter, e),
            None => format!("{} ({})", stem, counter),
        };
        let new_candidate = dir.join(&new_name);
        if !new_candidate.exists() {
            return new_candidate.to_string_lossy().to_string();
        }
        counter += 1;
    }
}

#[cfg(target_os = "windows")]
fn prevent_windows_sleep(enable: bool) {
    // Windows Power Availability API: ES_CONTINUOUS | ES_SYSTEM_REQUIRED
    use windows_sys::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED};
    unsafe {
        if enable {
            SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED);
        } else {
            SetThreadExecutionState(ES_CONTINUOUS);
        }
    }
}
