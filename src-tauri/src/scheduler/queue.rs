use crate::db::{DatabaseManager, DownloadRecord};
use crate::engine::{probe_url, DownloadEnginePool, DownloadProgressEvent};
use parking_lot::RwLock;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::{mpsc, Mutex as AsyncMutex, Notify, Semaphore};
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
struct ActiveTaskHandle {
    generation: u64,
    cancel_token: CancellationToken,
    done_notify: Arc<Notify>,
    is_done: Arc<AtomicBool>,
}

const PENDING_STAGING_DELETES_KEY: &str = "pending_staging_deletes";

pub const SEQUENTIAL_QUEUE_ID: &str = "sequential";

#[derive(Clone)]
pub struct QueueManager {
    client: reqwest::Client,
    db: DatabaseManager,
    pool: Arc<DownloadEnginePool>,
    active_tokens: Arc<RwLock<HashMap<String, ActiveTaskHandle>>>,
    task_generation: Arc<AtomicU64>,
    queue_dispatch_lock: Arc<AsyncMutex<()>>,
    queue_semaphores: Arc<RwLock<HashMap<String, Arc<Semaphore>>>>,
    task_limiters: Arc<RwLock<HashMap<String, Arc<crate::engine::TaskSpeedLimiter>>>>,
    progress_tx: mpsc::Sender<DownloadProgressEvent>,
    queue_running: Arc<AtomicBool>,
    app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
    armed_shutdown_tasks: Arc<RwLock<HashSet<String>>>,
    global_shutdown_armed: Arc<AtomicBool>,
    active_shutdown_cancel: Arc<RwLock<Option<CancellationToken>>>,
    pending_deletes_lock: Arc<parking_lot::Mutex<()>>,
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
            task_generation: Arc::new(AtomicU64::new(0)),
            queue_dispatch_lock: Arc::new(AsyncMutex::new(())),
            queue_semaphores: Arc::new(RwLock::new(semaphores)),
            task_limiters: Arc::new(RwLock::new(HashMap::new())),
            progress_tx,
            queue_running: Arc::new(AtomicBool::new(false)),
            app_handle: Arc::new(RwLock::new(None)),
            armed_shutdown_tasks: Arc::new(RwLock::new(HashSet::new())),
            global_shutdown_armed: Arc::new(AtomicBool::new(false)),
            active_shutdown_cancel: Arc::new(RwLock::new(None)),
            pending_deletes_lock: Arc::new(parking_lot::Mutex::new(())),
        }
    }

    pub fn set_app_handle(&self, app: tauri::AppHandle) {
        *self.app_handle.write() = Some(app);
    }

    pub fn get_app_handle(&self) -> Option<tauri::AppHandle> {
        self.app_handle.read().clone()
    }

    pub fn has_active_downloads(&self) -> bool {
        if !self.active_tokens.read().is_empty() {
            return true;
        }
        if self.is_queue_running() {
            if let Ok(queued) = self.db.get_queued_downloads() {
                if !queued.is_empty() {
                    return true;
                }
            }
        }
        false
    }

    pub fn active_download_count(&self) -> usize {
        self.active_tokens.read().len()
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
        let queue = match queue_id {
            Some(q) if !q.trim().is_empty() => q,
            _ if !start_immediately => SEQUENTIAL_QUEUE_ID.to_string(),
            _ => "default".to_string(),
        };

        // Resolve unified Downex download folder
        let default_dir = PathBuf::from(self.get_default_download_directory());
        let save_dir_buf = match destination_folder {
            Some(ref custom) if !custom.trim().is_empty() => {
                let p = PathBuf::from(custom.trim());
                if p.is_absolute() && std::fs::create_dir_all(&p).is_ok() {
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
                crate::engine::probe::sanitize_filename(trimmed)
            } else {
                crate::engine::probe::sanitize_filename(&probe.filename)
            }
        } else {
            crate::engine::probe::sanitize_filename(&probe.filename)
        };

        let _ = std::fs::create_dir_all(&save_dir_buf);
        let dest_path = self.resolve_unique_destination(&save_dir_buf, &chosen_filename, None);
        let resolved_staging = crate::engine::staging::resolve_unconfirmed_staging_path(
            Path::new(&dest_path),
            Some(&id),
            None,
        );
        // Hold staging path claim across SQLite insert so concurrent tasks cannot claim the same staging name
        let staging_claim = crate::engine::staging::StagingClaimGuard::new(resolved_staging.clone());
        let staging_path_str = resolved_staging.to_string_lossy().to_string();

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
            checksum: None,
            media_type: None,
            supports_ranges: probe.supports_ranges,
            created_at: now,
            updated_at: now,
            speed_limit_mbps: None,
            staging_path: Some(staging_path_str),
        };

        self.db.insert_download(&record)?;
        drop(staging_claim);

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
        let _dispatch_guard = self.queue_dispatch_lock.lock().await;
        if !self.is_queue_running() {
            return false;
        }

        // Strictly 1-by-1 sequential execution:
        // Check if ANY download is currently running or marked downloading/probing
        if !self.active_tokens.read().is_empty() {
            return false;
        }

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

        if let Some(mut next_task) = queued.into_iter().next() {
            eprintln!("[Downex Queue] 1-by-1 Auto-starting: {} ({})", next_task.filename, next_task.id);
            if next_task.queue_id != SEQUENTIAL_QUEUE_ID {
                let _ = self.db.update_download_queue_id(&next_task.id, SEQUENTIAL_QUEUE_ID);
                next_task.queue_id = SEQUENTIAL_QUEUE_ID.to_string();
            }
            let _ = self.db.update_download_status(&next_task.id, "downloading", 0, None);
            next_task.status = "downloading".to_string();
            self.start_task(next_task);
            if let Some(app) = self.get_app_handle() {
                use tauri::Emitter;
                let _ = app.emit("refresh-downloads", ());
            }
            return true;
        }

        eprintln!("[Downex Queue] Simple 1-by-1 queue finished all tasks.");
        self.queue_running.store(false, Ordering::Relaxed);
        if let Some(app) = self.get_app_handle() {
            use tauri::Emitter;
            let _ = app.emit("refresh-downloads", ());
        }
        false
    }

    pub async fn start_queue(&self) -> usize {
        self.queue_running.store(true, Ordering::Relaxed);
        let queued = self.db.get_queued_downloads().unwrap_or_default();
        let count = queued.len();
        if count == 0 {
            self.queue_running.store(false, Ordering::Relaxed);
            return 0;
        }
        self.process_next_in_queue().await;
        count
    }

    pub fn pause_queue(&self) -> bool {
        self.queue_running.store(false, Ordering::Relaxed);
        // Pause only active tasks belonging to the sequential queue (never hijack normal downloads)
        if let Ok(downloads) = self.db.get_all_downloads() {
            for d in downloads {
                if d.queue_id == SEQUENTIAL_QUEUE_ID && (d.status == "downloading" || d.status == "probing") {
                    self.pause_task(&d.id);
                    // Retain place in queue
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
        let _ = self.db.update_download_queue_id(id, SEQUENTIAL_QUEUE_ID);
        let res = self.db.update_download_status(id, "queued", 0, None).is_ok();
        if self.is_queue_running() {
            let qm = self.clone();
            tauri::async_runtime::spawn(async move {
                qm.process_next_in_queue().await;
            });
        }
        res
    }

    pub fn unqueue_download(&self, id: &str) -> bool {
        let existing = self.db.get_download(id).ok().flatten();
        if let Some(ref rec) = existing {
            if rec.status == "downloading" || rec.status == "probing" {
                self.pause_task(id);
            } else if rec.status == "queued" {
                let _ = self.db.update_download_status(id, "paused", 0, None);
            }
        }
        let ok = self.db.update_download_queue_id(id, "default").is_ok();
        if let Some(app) = self.get_app_handle() {
            use tauri::Emitter;
            let _ = app.emit("refresh-downloads", ());
        }
        ok
    }

    pub fn start_task(&self, record: DownloadRecord) {
        let task_id = record.id.clone();
        let cancel_token = CancellationToken::new();
        let done_notify = Arc::new(Notify::new());
        let is_done = Arc::new(AtomicBool::new(false));
        let gen = self.task_generation.fetch_add(1, Ordering::SeqCst) + 1;

        {
            let mut tokens = self.active_tokens.write();
            if let Some(prev) = tokens.insert(
                task_id.clone(),
                ActiveTaskHandle {
                    generation: gen,
                    cancel_token: cancel_token.clone(),
                    done_notify: done_notify.clone(),
                    is_done: is_done.clone(),
                },
            ) {
                prev.cancel_token.cancel();
            }
        }

        // Dynamic Guard: Re-defer update while any download task is active
        if let Some(app) = self.get_app_handle() {
            if let Some(manifest) = crate::tray::get_pending_update_manifest() {
                crate::tray::defer_update_due_to_downloads(
                    &app,
                    Some(manifest.version.clone()),
                    Some(manifest),
                );
            }
        }

        let pool = self.pool.clone();
        let db = self.db.clone();
        let progress_tx = self.progress_tx.clone();
        let active_tokens = self.active_tokens.clone();
        let task_limiters = self.task_limiters.clone();
        let armed_shutdown_tasks = self.armed_shutdown_tasks.clone();
        let initial_bps = record
            .speed_limit_mbps
            .filter(|m| *m > 0.0)
            .map(|m| ((m * 1_000_000.0) / 8.0).round() as u64)
            .unwrap_or(0);
        let limiter = {
            let mut limiters = self.task_limiters.write();
            limiters
                .entry(task_id.clone())
                .or_insert_with(|| Arc::new(crate::engine::TaskSpeedLimiter::new(initial_bps)))
                .clone()
        };
        let qm_clone = self.clone();

        let queue_id = if record.queue_id == "adaptive_media" || record.queue_id == "default" {
            record.queue_id.clone()
        } else {
            "custom".to_string()
        };
        let sem = {
            let mut sems = self.queue_semaphores.write();
            sems.entry(queue_id).or_insert_with(|| Arc::new(Semaphore::new(3))).clone()
        };

        let headers: Option<HashMap<String, String>> = record.headers_json.as_ref().and_then(|h| serde_json::from_str(h).ok());

        tauri::async_runtime::spawn(async move {
            let permit_weight = crate::system_profile::concurrent_permit_weight();
            let _permit = sem.acquire_many(permit_weight).await;

            if cancel_token.is_cancelled() {
                let is_current_gen = {
                    let mut tokens = active_tokens.write();
                    let matches = tokens.get(&task_id).map(|h| h.generation == gen).unwrap_or(false);
                    if matches {
                        tokens.remove(&task_id);
                    }
                    matches
                };
                if is_current_gen {
                    let cur_status = db.get_download(&task_id).ok().flatten().map(|r| r.status);
                    if let Some(ref st) = cur_status {
                        if st != "queued" && st != "completed" && st != "error" && st != "failed" {
                            let _ = db.update_download_status(&task_id, "paused", 0, None);
                        }
                    }
                    task_limiters.write().remove(&task_id);
                }
                is_done.store(true, Ordering::Release);
                done_notify.notify_waiters();

                if qm_clone.is_queue_running() {
                    let qm = qm_clone.clone();
                    tauri::async_runtime::spawn(async move {
                        qm.process_next_in_queue().await;
                    });
                }

                // Dynamic OTA unblock: Check if all active downloads and queue items have completed
                if !qm_clone.has_active_downloads() {
                    if let Some(app) = qm_clone.get_app_handle() {
                        crate::tray::on_downloads_completed(&app);
                    }
                }
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
                supports_ranges: Some(record.supports_ranges),
            }).await;

            #[cfg(target_os = "windows")]
            prevent_windows_sleep(true);

            let max_conns = crate::system_profile::effective_max_connections(
                db.get_setting("max_segments")
                    .ok()
                    .flatten()
                    .and_then(|s| s.parse::<u32>().ok())
                    .unwrap_or(32), // Max throughput saturation for 200Mbps+ plans
            );

            let supports_ranges = record.supports_ranges && record.total_bytes.is_some();
            let dest_path_clone = record.destination_path.clone();
            let filename_clone = record.filename.clone();
            let total_bytes_clone = record.total_bytes;

            let staging_path = match record
                .staging_path
                .as_deref()
                .filter(|s| !s.trim().is_empty())
            {
                Some(s) => s.to_string(),
                None => {
                    let resolved = crate::engine::staging::resolve_unconfirmed_staging_path(
                        Path::new(&record.destination_path),
                        Some(&record.id),
                        None,
                    );
                    crate::engine::staging::release_staging_path(&resolved);
                    let s = resolved.to_string_lossy().to_string();
                    let _ = db.update_download_staging_path(&record.id, Some(&s));
                    s
                }
            };

            let res = pool
                .execute_download(
                    task_id.clone(),
                    record.url,
                    record.destination_path,
                    staging_path,
                    record.total_bytes,
                    supports_ranges,
                    headers,
                    max_conns,
                    limiter,
                    progress_tx,
                    cancel_token.clone(),
                )
                .await;

            let is_success = res.is_ok() && !cancel_token.is_cancelled();
            if let Err(ref e) = res {
                eprintln!("[Downex Queue] Download failed: {}", e);
                let _ = db.update_download_status(&task_id, "failed", 0, Some(&e.to_string()));
            }

            let is_current_gen = {
                let mut tokens = active_tokens.write();
                let matches = tokens.get(&task_id).map(|h| h.generation == gen).unwrap_or(false);
                if matches {
                    tokens.remove(&task_id);
                }
                matches
            };
            if is_current_gen {
                task_limiters.write().remove(&task_id);
            }
            is_done.store(true, Ordering::Release);
            done_notify.notify_waiters();

            #[cfg(target_os = "windows")]
            prevent_windows_sleep(false);

            let qm = qm_clone.clone();
            let t_id = task_id.clone();
            tauri::async_runtime::spawn(async move {
                // Simple 1-by-1 Queue trigger: automatically pick up next task BEFORE evaluating shutdown/tray idle
                if qm.is_queue_running() {
                    qm.process_next_in_queue().await;
                }

                // Zero-Corruption Auto-Shutdown Evaluation (runs only after physical promotion & flush)
                if is_success {
                    let (final_dest, final_name) = match db.get_download(&t_id) {
                        Ok(Some(updated)) => (updated.destination_path, updated.filename),
                        _ => (dest_path_clone, filename_clone),
                    };
                    qm.check_and_trigger_shutdown_if_armed(&t_id, &final_dest, &final_name, total_bytes_clone).await;
                }
                armed_shutdown_tasks.write().remove(&t_id);

                if !qm.has_active_downloads() {
                    if let Some(app) = qm.get_app_handle() {
                        crate::tray::on_downloads_completed(&app);
                    }
                }
            });
        });
    }

    async fn wait_handle_done(handle: &ActiveTaskHandle, timeout: std::time::Duration) {
        let notified = handle.done_notify.notified();
        if !handle.is_done.load(Ordering::Acquire) {
            let _ = tokio::time::timeout(timeout, notified).await;
        }
    }

    async fn wait_for_active_task_stop(&self, id: &str) {
        let handle_opt = {
            let tokens = self.active_tokens.read();
            tokens.get(id).cloned()
        };
        if let Some(handle) = handle_opt {
            handle.cancel_token.cancel();
            Self::wait_handle_done(&handle, std::time::Duration::from_secs(3)).await;
        }
    }

    pub fn pause_task(&self, id: &str) -> bool {
        let was_active = {
            let tokens = self.active_tokens.read();
            if let Some(handle) = tokens.get(id) {
                handle.cancel_token.cancel();
                true
            } else {
                false
            }
        };
        let _ = self.db.update_download_status(id, "paused", 0, None);
        was_active || true
    }

    pub async fn resume_task(&self, id: &str) -> bool {
        self.wait_for_active_task_stop(id).await;
        if let Ok(Some(record)) = self.db.get_download(id) {
            self.start_task(record);
            return true;
        }
        false
    }

    pub fn set_task_speed_limit(&self, task_id: &str, limit_bytes_per_sec: u64) -> bool {
        let is_active = self.active_tokens.read().contains_key(task_id);
        let mut limiters = self.task_limiters.write();
        if let Some(limiter) = limiters.get(task_id) {
            limiter.set_limit(limit_bytes_per_sec);
            true
        } else if is_active {
            limiters.insert(
                task_id.to_string(),
                Arc::new(crate::engine::TaskSpeedLimiter::new(limit_bytes_per_sec)),
            );
            true
        } else {
            false
        }
    }

    pub fn get_task_speed_limit(&self, task_id: &str) -> u64 {
        let limiters = self.task_limiters.read();
        limiters.get(task_id).map(|l| l.get_limit()).unwrap_or(0)
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
            .filter(|d| d.status == "paused" || d.status == "queued" || d.status == "failed" || d.status == "error")
            .collect();

        let count = paused_records.len();
        for record in paused_records {
            self.start_task(record);
        }
        count
    }

    fn mutate_pending_staging_deletes<F>(&self, mutator: F)
    where
        F: FnOnce(&mut Vec<String>),
    {
        let _guard = self.pending_deletes_lock.lock();
        let mut list: Vec<String> = self
            .db
            .get_setting(PENDING_STAGING_DELETES_KEY)
            .ok()
            .flatten()
            .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
            .unwrap_or_default();
        mutator(&mut list);

        let mut seen = HashSet::new();
        list.retain(|item| {
            let trimmed = item.trim();
            !trimmed.is_empty()
                && seen.insert(crate::engine::staging::normalize_staging_key(Path::new(trimmed)))
        });

        if list.is_empty() {
            let _ = self.db.delete_setting(PENDING_STAGING_DELETES_KEY);
        } else if let Ok(json) = serde_json::to_string(&list) {
            let _ = self.db.set_setting(PENDING_STAGING_DELETES_KEY, &json);
        }
    }

    fn record_pending_staging_deletes(&self, paths: &[PathBuf]) {
        if paths.is_empty() {
            return;
        }
        self.mutate_pending_staging_deletes(|list| {
            for p in paths {
                let s = p.to_string_lossy().to_string();
                if !s.trim().is_empty() {
                    list.push(s);
                }
            }
        });
    }

    fn clear_resolved_pending_deletes(&self, attempted: &[PathBuf], still_locked: &[PathBuf]) {
        let locked_keys: HashSet<String> = still_locked
            .iter()
            .map(|p| crate::engine::staging::normalize_staging_key(p))
            .collect();
        let attempted_keys: HashSet<String> = attempted
            .iter()
            .map(|p| crate::engine::staging::normalize_staging_key(p))
            .collect();

        self.mutate_pending_staging_deletes(|list| {
            list.retain(|entry| {
                let key = crate::engine::staging::normalize_staging_key(Path::new(entry));
                !attempted_keys.contains(&key) || locked_keys.contains(&key)
            });
        });
    }

    pub async fn cancel_task(&self, id: &str, delete_file: bool) -> bool {
        let record_opt = self.db.get_download(id).ok().flatten();
        let active_handle = {
            let mut tokens = self.active_tokens.write();
            tokens.remove(id)
        };
        if let Some(ref handle) = active_handle {
            handle.cancel_token.cancel();
        }
        self.task_limiters.write().remove(id);
        self.armed_shutdown_tasks.write().remove(id);

        let mut cleanup_targets: Vec<PathBuf> = Vec::new();
        if let Some(ref record) = record_opt {
            let final_path = PathBuf::from(&record.destination_path);
            let is_completed = record.status == "completed";
            // Removing an incomplete/unconfirmed download terminates its lifecycle (DB row & segments are deleted),
            // so its internal `unconfirmed.*.downex` staging files MUST ALWAYS be cleaned to prevent disk orphans.
            if delete_file || !is_completed {
                let candidates = crate::engine::staging::collect_task_staging_candidates(
                    &final_path,
                    record.staging_path.as_deref().map(Path::new),
                    Some(&record.id),
                );
                cleanup_targets.extend(candidates);
            }
            if delete_file {
                cleanup_targets.push(final_path);
            }
            self.record_pending_staging_deletes(&cleanup_targets);
        }

        let db_ok = self.db.delete_download(id).is_ok();

        // Wait cleanly for active engine workers to drop PositionalWriter handles BEFORE removing disk files
        if let Some(handle) = active_handle {
            Self::wait_handle_done(&handle, std::time::Duration::from_secs(6)).await;
        }

        if !cleanup_targets.is_empty() {
            let targets_for_delete = cleanup_targets.clone();
            let remaining = tauri::async_runtime::spawn_blocking(move || {
                let mut still_locked = Vec::new();
                for path in targets_for_delete {
                    if crate::engine::staging::is_staging_path_claimed(&path) {
                        continue;
                    }
                    if crate::engine::staging::robust_delete_path_checked(&path).is_err()
                        && crate::engine::staging::to_win_io_path(&path).exists()
                    {
                        still_locked.push(path);
                    }
                }
                still_locked
            })
            .await
            .unwrap_or_else(|_| cleanup_targets.clone());

            self.clear_resolved_pending_deletes(&cleanup_targets, &remaining);
        }

        db_ok
    }

    /// Reconciles pending tombstone deletions and sweeps orphaned `unconfirmed.*.downex` staging files
    /// that no longer belong to any tracked task in SQLite.
    pub fn reconcile_orphaned_staging_files(&self) -> usize {
        let downloads = self.db.get_all_downloads().unwrap_or_default();
        let mut tracked_keys: HashSet<String> = HashSet::new();
        let mut scan_dirs: Vec<PathBuf> = vec![PathBuf::from(self.get_default_download_directory())];

        #[cfg(not(test))]
        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            let user_downloads = PathBuf::from(user_profile).join("Downloads");
            if user_downloads.is_dir() {
                scan_dirs.push(user_downloads);
            }
        }

        for record in &downloads {
            let dest_path = PathBuf::from(&record.destination_path);
            if let Some(parent) = dest_path.parent() {
                scan_dirs.push(parent.to_path_buf());
            }
            if let Some(ref sp) = record.staging_path {
                let staging_pb = PathBuf::from(sp);
                if let Some(parent) = staging_pb.parent() {
                    scan_dirs.push(parent.to_path_buf());
                }
            }

            if record.status != "completed" {
                let candidates = crate::engine::staging::collect_task_staging_candidates(
                    &dest_path,
                    record.staging_path.as_deref().map(Path::new),
                    Some(&record.id),
                );
                for c in candidates {
                    tracked_keys.insert(crate::engine::staging::normalize_staging_key(&c));
                }
            }
        }

        let mut cleaned = 0usize;

        // 1. Retry any pending tombstone deletions from interrupted/locked removals
        let pending_paths: Vec<PathBuf> = {
            let _guard = self.pending_deletes_lock.lock();
            self.db
                .get_setting(PENDING_STAGING_DELETES_KEY)
                .ok()
                .flatten()
                .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
                .unwrap_or_default()
                .into_iter()
                .map(PathBuf::from)
                .collect()
        };

        if !pending_paths.is_empty() {
            let mut still_locked = Vec::new();
            for path in &pending_paths {
                let key = crate::engine::staging::normalize_staging_key(path);
                if tracked_keys.contains(&key) || crate::engine::staging::is_staging_path_claimed(path) {
                    continue;
                }
                if crate::engine::staging::to_win_io_path(path).exists() {
                    if crate::engine::staging::robust_delete_path_checked(path).is_ok() {
                        cleaned += 1;
                    } else if crate::engine::staging::to_win_io_path(path).exists() {
                        still_locked.push(path.clone());
                    }
                }
            }
            self.clear_resolved_pending_deletes(&pending_paths, &still_locked);
        }

        // 2. Sweep untracked `unconfirmed.*.downex` orphans in download directories
        let orphans = crate::engine::staging::find_orphaned_unconfirmed_in_dirs(&scan_dirs, &tracked_keys);
        for orphan in orphans {
            if crate::engine::staging::robust_delete_path_checked(&orphan).is_ok() {
                eprintln!("[Downex Lifecycle] Swept orphaned staging file: {}", orphan.display());
                cleaned += 1;
            }
        }

        cleaned
    }

    pub async fn change_destination_and_retry(
        &self,
        task_id: &str,
        new_folder: &str,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        self.wait_for_active_task_stop(task_id).await;
        let _ = self.db.update_download_status(task_id, "paused", 0, None);
        let record = match self.db.get_download(task_id)? {
            Some(r) => r,
            None => return Ok(false),
        };

        let new_folder_path = PathBuf::from(new_folder.trim());
        let _ = std::fs::create_dir_all(&new_folder_path);
        let new_dest = self.resolve_unique_destination(&new_folder_path, &record.filename, Some(task_id));
        let new_staging_buf = crate::engine::staging::resolve_unconfirmed_staging_path(
            Path::new(&new_dest),
            Some(task_id),
            None,
        );
        crate::engine::staging::release_staging_path(&new_staging_buf);
        let new_staging = new_staging_buf.to_string_lossy().to_string();

        // Carry over existing partial staging bytes if moving cleanly across same folder/volume
        if let Some(ref old_staging) = record.staging_path {
            let old_io = crate::engine::staging::to_win_io_path(Path::new(old_staging));
            let new_io = crate::engine::staging::to_win_io_path(&new_staging_buf);
            if old_io.exists() && old_io != new_io {
                if std::fs::rename(&old_io, &new_io).is_err() {
                    crate::engine::staging::robust_delete_path(Path::new(old_staging));
                }
            }
        }

        self.db
            .update_download_destination_and_staging(task_id, &new_dest, Some(&new_staging))?;
        let mut updated_record = record;
        updated_record.destination_path = new_dest;
        updated_record.staging_path = Some(new_staging);
        updated_record.status = "queued".to_string();
        updated_record.error_message = None;

        self.start_task(updated_record);
        Ok(true)
    }

    fn resolve_unique_destination(
        &self,
        dir: &Path,
        filename: &str,
        exclude_task_id: Option<&str>,
    ) -> String {
        let existing_destinations: HashSet<String> = self
            .db
            .get_all_downloads()
            .unwrap_or_default()
            .into_iter()
            .filter(|d| exclude_task_id.map_or(true, |ex| d.id != ex))
            .map(|d| d.destination_path.replace('/', "\\").to_lowercase())
            .collect();
        get_non_colliding_path_excluding(dir, filename, &existing_destinations)
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
        let target_path = if trimmed.is_empty() {
            resolve_default_download_directory()
        } else {
            PathBuf::from(trimmed)
        };

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

    pub fn toggle_task_shutdown(&self, task_id: &str) -> bool {
        let mut set = self.armed_shutdown_tasks.write();
        if set.contains(task_id) {
            set.remove(task_id);
            false
        } else {
            set.insert(task_id.to_string());
            true
        }
    }

    pub fn is_task_shutdown_armed(&self, task_id: &str) -> bool {
        self.armed_shutdown_tasks.read().contains(task_id)
    }

    pub fn set_global_shutdown(&self, enabled: bool) -> bool {
        self.global_shutdown_armed.store(enabled, Ordering::SeqCst);
        enabled
    }

    pub fn is_global_shutdown_armed(&self) -> bool {
        self.global_shutdown_armed.load(Ordering::SeqCst)
    }

    pub fn cancel_shutdown_countdown(&self) -> bool {
        let mut guard = self.active_shutdown_cancel.write();
        if let Some(token) = guard.take() {
            token.cancel();
            if let Some(app) = self.get_app_handle() {
                let _ = app.emit("downex://shutdown-cancelled", serde_json::json!({ "reason": "user_cancelled" }));
            }
            true
        } else {
            false
        }
    }

    pub fn trigger_immediate_shutdown(&self, dry_run: bool) -> Result<(), String> {
        self.cancel_shutdown_countdown();
        self.execute_os_shutdown(dry_run);
        Ok(())
    }

    pub async fn check_and_trigger_shutdown_if_armed(
        &self,
        task_id: &str,
        destination_path: &str,
        filename: &str,
        total_bytes: Option<u64>,
    ) {
        let is_task_armed = self.is_task_shutdown_armed(task_id);
        let is_global_armed = self.is_global_shutdown_armed();

        if !is_task_armed && !is_global_armed {
            return;
        }

        // 1. Zero-Corruption Physical Disk Integrity Check:
        // Ensure physical file on disk exists and matches expected length!
        if let Some(expected) = total_bytes {
            if expected > 0 {
                let io_dest = crate::engine::staging::to_win_io_path(Path::new(destination_path));
                match std::fs::metadata(&io_dest) {
                    Ok(meta) => {
                        if meta.len() < expected {
                            eprintln!(
                                "[Downex Shutdown] ABORTING: Physical file size ({} bytes) is less than expected ({} bytes). File may still be uncommitted or corrupt!",
                                meta.len(), expected
                            );
                            return;
                        }
                    }
                    Err(e) => {
                        eprintln!("[Downex Shutdown] ABORTING: Cannot read file metadata at {}: {}", destination_path, e);
                        return;
                    }
                }
            }
        }

        // 2. Multi-Download Protection (serialized with queue dispatch lock):
        // If there are other active or queued downloads, do not shut down yet!
        let _dispatch_guard = self.queue_dispatch_lock.lock().await;
        let has_remaining = self.has_active_downloads()
            || self
                .db
                .get_all_downloads()
                .map(|list| {
                    list.iter().any(|d| {
                        d.id != task_id
                            && (d.status == "downloading"
                                || d.status == "probing"
                                || (self.is_queue_running() && d.status == "queued"))
                    })
                })
                .unwrap_or(false);
        if has_remaining {
            eprintln!("[Downex Shutdown] Other downloads are still active or queued. Postponing shutdown until all active downloads complete.");
            return;
        }
        drop(_dispatch_guard);

        // 3. Initiate the 30-Second Safety Countdown
        self.spawn_shutdown_countdown(30, task_id.to_string(), filename.to_string(), total_bytes).await;
    }

    pub async fn spawn_shutdown_countdown(
        &self,
        duration_secs: u32,
        triggering_task_id: String,
        filename: String,
        total_bytes: Option<u64>,
    ) {
        let cancel_token = CancellationToken::new();
        {
            let mut guard = self.active_shutdown_cancel.write();
            if let Some(old) = guard.take() {
                old.cancel();
            }
            *guard = Some(cancel_token.clone());
        }

        let app_opt = self.get_app_handle();
        let qm_clone = self.clone();

        tauri::async_runtime::spawn(async move {
            let mut remaining = duration_secs;
            eprintln!("[Downex Shutdown] Safety countdown started: {} seconds remaining...", remaining);

            while remaining > 0 {
                if cancel_token.is_cancelled() {
                    eprintln!("[Downex Shutdown] Safety countdown cancelled by user.");
                    if let Some(ref app) = app_opt {
                        let _ = app.emit("downex://shutdown-cancelled", serde_json::json!({
                            "reason": "user_cancelled"
                        }));
                    }
                    return;
                }

                if let Some(ref app) = app_opt {
                    let _ = app.emit("downex://shutdown-tick", serde_json::json!({
                        "seconds_left": remaining,
                        "task_id": triggering_task_id,
                        "filename": filename,
                        "total_bytes": total_bytes,
                    }));
                }

                tokio::select! {
                    _ = cancel_token.cancelled() => {
                        eprintln!("[Downex Shutdown] Safety countdown cancelled during sleep.");
                        if let Some(ref app) = app_opt {
                            let _ = app.emit("downex://shutdown-cancelled", serde_json::json!({
                                "reason": "user_cancelled"
                            }));
                        }
                        return;
                    }
                    _ = tokio::time::sleep(std::time::Duration::from_secs(1)) => {
                        remaining -= 1;
                    }
                }
            }

            if cancel_token.is_cancelled() {
                return;
            }

            eprintln!("[Downex Shutdown] Safety countdown reached 0. Initiating clean Windows shutdown...");
            if let Some(ref app) = app_opt {
                let _ = app.emit("downex://shutdown-executing", serde_json::json!({
                    "task_id": triggering_task_id,
                    "filename": filename,
                }));
            }

            // SAFETY GUARD: Check if running in test / dry-run mode
            let is_dry_run = cfg!(debug_assertions)
                || std::env::var("DOWNEX_DRY_RUN_SHUTDOWN").is_ok()
                || std::env::var("CI").is_ok();

            qm_clone.execute_os_shutdown(is_dry_run);
        });
    }

    pub fn execute_os_shutdown(&self, dry_run: bool) {
        if dry_run {
            eprintln!("[Downex Shutdown] DRY RUN ACTIVE: Simulated Windows shutdown (shutdown.exe /s /t 0). System remains running.");
            return;
        }

        #[cfg(target_os = "windows")]
        {
            let _ = std::process::Command::new("shutdown")
                .args(["/s", "/t", "0", "/c", "Downex: Download completed clean shutdown"])
                .spawn();
        }
    }
}

pub fn resolve_default_download_directory() -> PathBuf {
    // 1. Primary: %USERPROFILE%\Downloads\Downex
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

fn is_path_available_for_target(candidate: &Path, existing_destinations: &HashSet<String>) -> bool {
    let key = candidate.to_string_lossy().replace('/', "\\").to_lowercase();
    if existing_destinations.contains(&key) {
        return false;
    }
    if crate::engine::staging::to_win_io_path(candidate).exists()
        || crate::engine::staging::is_target_path_claimed(candidate)
    {
        return false;
    }
    let unconfirmed = crate::engine::staging::derive_primary_unconfirmed_path(candidate);
    if crate::engine::staging::to_win_io_path(&unconfirmed).exists()
        || crate::engine::staging::is_staging_path_claimed(&unconfirmed)
    {
        return false;
    }
    true
}

pub fn get_non_colliding_path_excluding(
    dir: &Path,
    filename: &str,
    existing_destinations: &HashSet<String>,
) -> String {
    let candidate = dir.join(filename);
    if is_path_available_for_target(&candidate, existing_destinations) {
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
        if is_path_available_for_target(&new_candidate, existing_destinations) {
            return new_candidate.to_string_lossy().to_string();
        }
        counter += 1;
    }
}

pub fn get_non_colliding_path(dir: &Path, filename: &str) -> String {
    get_non_colliding_path_excluding(dir, filename, &HashSet::new())
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use uuid::Uuid;

    fn make_test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("downex_queue_test_{}_{}", name, Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn build_record(id: &str, url: &str, dest: &Path, staging: &Path, status: &str, total: u64) -> DownloadRecord {
        let now = chrono::Utc::now().timestamp_millis();
        DownloadRecord {
            id: id.to_string(),
            url: url.to_string(),
            filename: dest.file_name().unwrap().to_string_lossy().to_string(),
            destination_path: dest.to_string_lossy().to_string(),
            total_bytes: Some(total),
            downloaded_bytes: 0,
            status: status.to_string(),
            etag: None,
            last_modified: None,
            headers_json: None,
            queue_id: "default".to_string(),
            speed_bytes_sec: 0,
            error_message: None,
            checksum: None,
            media_type: None,
            supports_ranges: true,
            created_at: now,
            updated_at: now,
            speed_limit_mbps: None,
            staging_path: Some(staging.to_string_lossy().to_string()),
        }
    }

    #[test]
    fn test_cancel_incomplete_task_cleans_unconfirmed_even_when_delete_file_false() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let root = make_test_dir("cancel_incomplete");
            let db = DatabaseManager::new(&root.join("test.db")).unwrap();
            let (tx, _rx) = mpsc::channel(32);
            let qm = QueueManager::new(reqwest::Client::new(), db.clone(), tx);

            // 1. Paused/incomplete task with staging file -> cancel_task(id, false) must still delete unconfirmed.*.downex
            let paused_final = root.join("The.Mosquito.Bowl.2026.mkv");
            let paused_staging = crate::engine::staging::derive_primary_unconfirmed_path(&paused_final);
            fs::write(&paused_staging, b"partial-bytes-should-be-cleaned").unwrap();
            let paused_id = format!("task-paused-{}", Uuid::new_v4());
            let paused_rec = build_record(&paused_id, "http://127.0.0.1/movie.mkv", &paused_final, &paused_staging, "paused", 1024);
            db.insert_download(&paused_rec).unwrap();

            assert!(qm.cancel_task(&paused_id, false).await);
            assert!(!paused_staging.exists(), "Unconfirmed staging file must NOT remain orphaned after deleting paused task");
            assert!(db.get_download(&paused_id).unwrap().is_none());
            assert!(db.get_setting(PENDING_STAGING_DELETES_KEY).unwrap().is_none());

            // 2. Completed task with delete_file=false -> Safe Mode must keep the finished file on disk
            let done_final = root.join("Completed.Movie.mkv");
            let done_staging = crate::engine::staging::derive_primary_unconfirmed_path(&done_final);
            fs::write(&done_final, b"finished-movie-bytes").unwrap();
            let done_id = format!("task-done-{}", Uuid::new_v4());
            let mut done_rec = build_record(&done_id, "http://127.0.0.1/done.mkv", &done_final, &done_staging, "completed", 20);
            done_rec.staging_path = None;
            db.insert_download(&done_rec).unwrap();

            assert!(qm.cancel_task(&done_id, false).await);
            assert!(done_final.exists(), "Completed file must remain intact in Safe Mode");
            assert!(db.get_download(&done_id).unwrap().is_none());

            crate::engine::staging::robust_delete_path(&root);
        });
    }

    #[test]
    fn test_pause_then_immediate_cancel_active_task_releases_handles_without_orphan() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let root = make_test_dir("pause_then_cancel");
            let db = DatabaseManager::new(&root.join("test.db")).unwrap();
            let (tx, _rx) = mpsc::channel(64);
            let qm = QueueManager::new(reqwest::Client::new(), db.clone(), tx);

            // Spawn a slow streaming HTTP server so workers actively hold PositionalWriter when paused & deleted
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            tokio::spawn(async move {
                while let Ok((mut socket, _)) = listener.accept().await {
                    tokio::spawn(async move {
                        let mut buf = [0u8; 1024];
                        let _ = socket.read(&mut buf).await;
                        let headers = "HTTP/1.1 206 Partial Content\r\nContent-Length: 1048576\r\nContent-Range: bytes 0-1048575/1048576\r\nAccept-Ranges: bytes\r\n\r\n";
                        let _ = socket.write_all(headers.as_bytes()).await;
                        let chunk = vec![b'D'; 4096];
                        for _ in 0..32 {
                            if socket.write_all(&chunk).await.is_err() {
                                break;
                            }
                            tokio::time::sleep(std::time::Duration::from_millis(80)).await;
                        }
                    });
                }
            });

            let url = format!("http://127.0.0.1:{}/stream.bin", addr.port());
            let final_dst = root.join("Stream.2026.bin");
            let staging_dst = crate::engine::staging::derive_primary_unconfirmed_path(&final_dst);
            let task_id = format!("task-race-{}", Uuid::new_v4());
            let rec = build_record(&task_id, &url, &final_dst, &staging_dst, "downloading", 1_048_576);
            db.insert_download(&rec).unwrap();

            qm.start_task(rec);
            tokio::time::sleep(std::time::Duration::from_millis(180)).await;
            assert!(staging_dst.exists(), "Active download should create unconfirmed staging file");

            // Pause ("stop") and IMMEDIATELY delete while workers are unwinding
            assert!(qm.pause_task(&task_id));
            assert!(qm.cancel_task(&task_id, true).await);

            assert!(!staging_dst.exists(), "Stopping then immediately deleting must never leave orphaned unconfirmed file");
            assert!(!final_dst.exists());
            assert!(db.get_download(&task_id).unwrap().is_none());
            assert!(db.get_setting(PENDING_STAGING_DELETES_KEY).unwrap().is_none());

            crate::engine::staging::robust_delete_path(&root);
        });
    }

    #[test]
    fn test_reconcile_orphaned_staging_sweeps_orphans_and_preserves_paused_tasks() {
        let root = make_test_dir("reconcile_orphans");
        let db = DatabaseManager::new(&root.join("test.db")).unwrap();
        let _ = db.set_setting("default_download_dir", &root.to_string_lossy());
        let (tx, _rx) = mpsc::channel(16);
        let qm = QueueManager::new(reqwest::Client::new(), db.clone(), tx);

        // Tracked paused task's staging file -> MUST BE PRESERVED
        let paused_final = root.join("ValidPaused.mkv");
        let paused_staging = crate::engine::staging::derive_primary_unconfirmed_path(&paused_final);
        fs::write(&paused_staging, b"valid-paused-partial").unwrap();
        let paused_rec = build_record("task-valid-paused", "http://127.0.0.1/valid.mkv", &paused_final, &paused_staging, "paused", 2048);
        db.insert_download(&paused_rec).unwrap();

        // Untracked orphan `unconfirmed.*.downex` file -> MUST BE SWEPT
        let orphan_file = root.join("unconfirmed.DeletedOrphan.2026.mkv.downex");
        fs::write(&orphan_file, b"orphaned-bytes").unwrap();

        // Unrelated normal file -> MUST NEVER BE TOUCHED
        let normal_file = root.join("MyNotes.txt");
        fs::write(&normal_file, b"keep-me").unwrap();

        let swept = qm.reconcile_orphaned_staging_files();
        assert_eq!(swept, 1);
        assert!(!orphan_file.exists(), "Orphan unconfirmed file must be swept cleanly");
        assert!(paused_staging.exists(), "Valid paused download staging file must remain intact");
        assert!(normal_file.exists(), "Non-staging user files must never be touched");

        crate::engine::staging::robust_delete_path(&root);
    }

    #[test]
    fn test_sequential_queue_membership_persists_across_start_pause_complete_and_unqueue() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let root = make_test_dir("seq_queue_membership");
            let db = DatabaseManager::new(&root.join("test.db")).unwrap();
            let (tx, _rx) = mpsc::channel(16);
            let qm = QueueManager::new(reqwest::Client::new(), db.clone(), tx);

            // 1. Normal task stays in 'default', queued task stays in SEQUENTIAL_QUEUE_ID
            let normal_dst = root.join("NormalFile.bin");
            let mut normal_rec = build_record(
                "task-normal",
                "http://127.0.0.1/normal.bin",
                &normal_dst,
                &crate::engine::staging::derive_primary_unconfirmed_path(&normal_dst),
                "downloading",
                1024,
            );
            normal_rec.queue_id = "default".to_string();
            db.insert_download(&normal_rec).unwrap();

            let q1_dst = root.join("QueueFile1.bin");
            let mut q1_rec = build_record(
                "task-q1",
                "http://127.0.0.1/q1.bin",
                &q1_dst,
                &crate::engine::staging::derive_primary_unconfirmed_path(&q1_dst),
                "downloading",
                1024,
            );
            q1_rec.queue_id = SEQUENTIAL_QUEUE_ID.to_string();
            db.insert_download(&q1_rec).unwrap();

            // 2. pause_queue pauses only SEQUENTIAL_QUEUE_ID back to queued, never normal 'default' task
            assert!(qm.pause_queue());
            assert_eq!(db.get_download("task-normal").unwrap().unwrap().status, "downloading");
            assert_eq!(db.get_download("task-normal").unwrap().unwrap().queue_id, "default");
            let q1_paused = db.get_download("task-q1").unwrap().unwrap();
            assert_eq!(q1_paused.status, "queued");
            assert_eq!(q1_paused.queue_id, SEQUENTIAL_QUEUE_ID);

            // 3. queue_download attaches SEQUENTIAL_QUEUE_ID
            assert!(qm.queue_download("task-normal"));
            let normal_queued = db.get_download("task-normal").unwrap().unwrap();
            assert_eq!(normal_queued.queue_id, SEQUENTIAL_QUEUE_ID);
            assert_eq!(normal_queued.status, "queued");

            // 4. unqueue_download detaches to 'default' (queued->paused, completed->completed)
            assert!(qm.unqueue_download("task-normal"));
            let normal_unqueued = db.get_download("task-normal").unwrap().unwrap();
            assert_eq!(normal_unqueued.queue_id, "default");
            assert_eq!(normal_unqueued.status, "paused");

            db.update_download_status("task-q1", "completed", 0, None).unwrap();
            assert!(qm.unqueue_download("task-q1"));
            let q1_unqueued = db.get_download("task-q1").unwrap().unwrap();
            assert_eq!(q1_unqueued.queue_id, "default");
            assert_eq!(q1_unqueued.status, "completed");

            crate::engine::staging::robust_delete_path(&root);
        });
    }
}
