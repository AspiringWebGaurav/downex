use super::staging::{
    prepare_staging_for_download, promote_unconfirmed_to_final, resolve_unconfirmed_staging_path,
    verify_staged_file_integrity, StagingClaimGuard, TargetClaimGuard,
};
use super::state::{DownloadProgressEvent, SegmentSnapshot};
use super::writer::PositionalWriter;
use crate::db::{DatabaseManager, SegmentRecord};
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, RANGE};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, RwLock};
use tokio_util::sync::CancellationToken;

const MIN_SPLIT_THRESHOLD_BYTES: u64 = 2 * 1024 * 1024; // 2 MB minimum to split a chunk
const MAX_TOTAL_SEGMENTS: usize = 256; // Dynamic work-stealing segment lifecycle capacity
pub const UNKNOWN_RANGE_END: u64 = u64::MAX; // Sentinel for streams without Content-Length

#[derive(Debug, Clone)]
pub struct ActiveSegment {
    pub index: u32,
    pub range_start: u64,
    pub range_end: Arc<AtomicU64>,
    pub downloaded: Arc<AtomicU64>,
    pub is_active: Arc<AtomicBool>,
}

impl ActiveSegment {
    pub fn expected_bytes(&self) -> u64 {
        let start = self.range_start;
        let end = self.range_end.load(Ordering::SeqCst);
        if end != UNKNOWN_RANGE_END && end >= start {
            end - start + 1
        } else {
            0
        }
    }

    pub fn is_complete(&self) -> bool {
        let expected = self.expected_bytes();
        let downloaded = self.downloaded.load(Ordering::SeqCst);
        expected > 0 && downloaded >= expected
    }

    pub fn remaining_bytes(&self) -> u64 {
        let expected = self.expected_bytes();
        let downloaded = self.downloaded.load(Ordering::SeqCst);
        expected.saturating_sub(downloaded)
    }
}

pub struct DownloadEnginePool {
    client: reqwest::Client,
    db: DatabaseManager,
}

impl DownloadEnginePool {
    pub fn new(client: reqwest::Client, db: DatabaseManager) -> Self {
        Self { client, db }
    }

    /// Evaluates current total verified downloaded bytes and determines whether the download has completed.
    /// Clamps each segment to its exact [start, end] byte boundaries (no double counting).
    pub fn evaluate_progress(
        segments: &[ActiveSegment],
        total_bytes: Option<u64>,
    ) -> (u64, bool) {
        if segments.is_empty() {
            return (0, false);
        }

        let mut total_downloaded = 0u64;
        let mut all_segments_done = true;

        for s in segments {
            let d = s.downloaded.load(Ordering::SeqCst);
            let expected = s.expected_bytes();
            total_downloaded += if expected > 0 { d.min(expected) } else { d };

            if expected == 0 || d < expected {
                all_segments_done = false;
            }
        }

        let is_complete = if let Some(expected_total) = total_bytes {
            if expected_total > 0 {
                total_downloaded >= expected_total || all_segments_done
            } else {
                all_segments_done
            }
        } else {
            all_segments_done
        };

        (total_downloaded, is_complete)
    }

    pub async fn execute_download(
        &self,
        task_id: String,
        url: String,
        destination_path: String,
        staging_path: String,
        total_bytes: Option<u64>,
        supports_ranges: bool,
        custom_headers: Option<HashMap<String, String>>,
        max_connections: u32,
        limiter: Arc<super::limiter::TaskSpeedLimiter>,
        progress_tx: mpsc::Sender<DownloadProgressEvent>,
        cancel_token: CancellationToken,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let target_path_buf = PathBuf::from(&destination_path);
        let staging_path_buf = if staging_path.trim().is_empty() {
            let resolved = resolve_unconfirmed_staging_path(&target_path_buf, Some(&task_id), None);
            let _ = self
                .db
                .update_download_staging_path(&task_id, Some(&resolved.to_string_lossy()));
            resolved
        } else {
            PathBuf::from(&staging_path)
        };

        // Hold RAII claims for both final target and unconfirmed staging path for the duration of execution
        let _target_claim = TargetClaimGuard::new(target_path_buf.clone());
        let _staging_claim = StagingClaimGuard::new(staging_path_buf.clone());

        // Check if existing segment records exist in DB for resume
        let existing_segments = self.db.get_segments(&task_id).unwrap_or_default();
        let requested_resume = !existing_segments.is_empty();

        let staging_prep_src = staging_path_buf.clone();
        let target_prep_src = target_path_buf.clone();
        let effective_is_resume = tauri::async_runtime::spawn_blocking(move || {
            prepare_staging_for_download(&staging_prep_src, &target_prep_src, requested_resume)
        })
        .await
        .unwrap_or(false);

        if requested_resume && !effective_is_resume {
            let _ = self.db.update_download_progress(&task_id, 0, 0);
        }

        let writer_path = staging_path_buf.clone();
        let writer_resume = effective_is_resume && supports_ranges;
        let writer_res = tauri::async_runtime::spawn_blocking(move || {
            PositionalWriter::new(&writer_path, total_bytes, writer_resume)
        })
        .await
        .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())) as Box<dyn std::error::Error + Send + Sync>)?
        .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
        let writer = Arc::new(writer_res);

        let segments: Arc<RwLock<Vec<ActiveSegment>>>;

        if effective_is_resume && !existing_segments.is_empty() && supports_ranges {
            // Restore from DB
            let mut list = Vec::new();
            for s in existing_segments {
                list.push(ActiveSegment {
                    index: s.segment_index,
                    range_start: s.range_start,
                    range_end: Arc::new(AtomicU64::new(s.range_end)),
                    downloaded: Arc::new(AtomicU64::new(s.downloaded)),
                    is_active: Arc::new(AtomicBool::new(false)),
                });
            }
            segments = Arc::new(RwLock::new(list));
        } else if let (Some(size), true) = (total_bytes, supports_ranges) {
            if size == 0 {
                let list = vec![ActiveSegment {
                    index: 0,
                    range_start: 0,
                    range_end: Arc::new(AtomicU64::new(UNKNOWN_RANGE_END)),
                    downloaded: Arc::new(AtomicU64::new(0)),
                    is_active: Arc::new(AtomicBool::new(false)),
                }];
                segments = Arc::new(RwLock::new(list));
            } else {
                // Partition segments in strict [start, end] non-overlapping byte intervals
                let conn_count = (max_connections.clamp(1, 32) as u64).min(size).max(1);
                let chunk_size = (size / conn_count).max(1);
                let mut list = Vec::new();

                for i in 0..conn_count {
                    let start = i * chunk_size;
                    let end = if i == conn_count - 1 {
                        size - 1
                    } else {
                        ((i + 1) * chunk_size).saturating_sub(1)
                    };

                    list.push(ActiveSegment {
                        index: i as u32,
                        range_start: start,
                        range_end: Arc::new(AtomicU64::new(end)),
                        downloaded: Arc::new(AtomicU64::new(0)),
                        is_active: Arc::new(AtomicBool::new(false)),
                    });
                }
                segments = Arc::new(RwLock::new(list));
            }
        } else {
            // Single-stream fallback
            let initial_end = total_bytes.map(|b| if b > 0 { b - 1 } else { UNKNOWN_RANGE_END }).unwrap_or(UNKNOWN_RANGE_END);
            let list = vec![ActiveSegment {
                index: 0,
                range_start: 0,
                range_end: Arc::new(AtomicU64::new(initial_end)),
                downloaded: Arc::new(AtomicU64::new(0)),
                is_active: Arc::new(AtomicBool::new(false)),
            }];
            segments = Arc::new(RwLock::new(list));
        }

        // Persist initial segments to DB
        self.persist_segments_to_db(&task_id, &segments).await;

        // Internal completion token: Cancelled immediately when total_bytes is reached
        // or all segments are complete. Automatically aborts all connections without delay.
        let completion_token = CancellationToken::new();
        let fallback_single_stream = Arc::new(AtomicBool::new(false));
        let fatal_error_msg: Arc<parking_lot::Mutex<Option<String>>> = Arc::new(parking_lot::Mutex::new(None));
        let stream_completed_unknown = Arc::new(AtomicBool::new(false));

        // Telemetry & Completion Coordinator Loop
        let p_task_id = task_id.clone();
        let p_segments = segments.clone();
        let p_total_bytes = total_bytes;
        let p_cancel = cancel_token.clone();
        let p_complete = completion_token.clone();
        let p_db = self.db.clone();
        let p_limiter = limiter.clone();
        let p_fallback = fallback_single_stream.clone();
        let p_supports_ranges = supports_ranges;
        let t_progress_tx = progress_tx.clone();

        let initial_downloaded: u64 = {
            let segs = segments.read().await;
            Self::evaluate_progress(&segs, total_bytes).0
        };

        let max_downloaded = Arc::new(AtomicU64::new(initial_downloaded));
        let p_max_downloaded = max_downloaded.clone();

        let telemetry_handle = tauri::async_runtime::spawn(async move {
            let mut last_bytes = initial_downloaded;
            let mut last_time = Instant::now();
            let mut last_checkpoint_time = Instant::now();
            let mut smoothed_speed = 0.0f64;
            let mut persistent_eta: Option<u64> = None;

            loop {
                tokio::select! {
                    _ = p_cancel.cancelled() => break,
                    _ = p_complete.cancelled() => break,
                    _ = tokio::time::sleep(Duration::from_millis(150)) => {
                        let should_checkpoint = last_checkpoint_time.elapsed() >= Duration::from_secs(2);
                        if should_checkpoint {
                            last_checkpoint_time = Instant::now();
                        }

                        let (current_total, is_all_complete, snapshots, db_records) = {
                            let segs = p_segments.read().await;
                            let (curr_total, is_done) = Self::evaluate_progress(&segs, p_total_bytes);

                            let mut snaps = Vec::with_capacity(segs.len());
                            for s in segs.iter() {
                                let d = s.downloaded.load(Ordering::SeqCst);
                                let end = s.range_end.load(Ordering::SeqCst);
                                let seg_expected = if end != UNKNOWN_RANGE_END && end >= s.range_start {
                                    end - s.range_start + 1
                                } else {
                                    0
                                };
                                snaps.push(SegmentSnapshot {
                                    index: s.index,
                                    start: s.range_start,
                                    end,
                                    downloaded: if seg_expected > 0 { d.min(seg_expected) } else { d },
                                    speed_bytes_sec: 0,
                                    is_active: s.is_active.load(Ordering::SeqCst),
                                });
                            }

                            let recs = if should_checkpoint {
                                let mut r = Vec::with_capacity(segs.len());
                                for s in segs.iter() {
                                    r.push(SegmentRecord {
                                        id: None,
                                        download_id: p_task_id.clone(),
                                        segment_index: s.index,
                                        range_start: s.range_start,
                                        range_end: s.range_end.load(Ordering::SeqCst),
                                        downloaded: s.downloaded.load(Ordering::SeqCst),
                                        status: if s.is_active.load(Ordering::SeqCst) {
                                            "downloading".to_string()
                                        } else {
                                            "idle".to_string()
                                        },
                                    });
                                }
                                Some(r)
                            } else {
                                None
                            };

                            (curr_total, is_done, snaps, recs)
                        }; // Read lock dropped cleanly BEFORE DB I/O or channel send!

                        // Monotonic high-water mark: reported progress must never flicker backwards
                        let mut cur_max = p_max_downloaded.load(Ordering::SeqCst);
                        while current_total > cur_max {
                            match p_max_downloaded.compare_exchange_weak(cur_max, current_total, Ordering::SeqCst, Ordering::SeqCst) {
                                Ok(_) => { cur_max = current_total; break; }
                                Err(actual) => { cur_max = actual; }
                            }
                        }
                        let monotonic_total = cur_max;

                        // If all bytes have been downloaded, trigger completion immediately!
                        if is_all_complete {
                            p_complete.cancel();
                            break;
                        }

                        if let Some(records) = db_records {
                            let _ = p_db.save_segments(&p_task_id, &records);
                        }

                        let now = Instant::now();
                        let elapsed = now.duration_since(last_time).as_secs_f64();
                        let bytes_delta = monotonic_total.saturating_sub(last_bytes);

                        let instant_speed = if elapsed > 0.0 {
                            bytes_delta as f64 / elapsed
                        } else {
                            0.0
                        };

                        let active_limit = p_limiter.get_limit();

                        // Responsive EMA dampener: 70% previous, 30% instant for rapid rate tracking
                        smoothed_speed = if smoothed_speed <= 0.0 {
                            instant_speed
                        } else if instant_speed > 0.0 {
                            (smoothed_speed * 0.70) + (instant_speed * 0.30)
                        } else {
                            smoothed_speed * 0.85
                        };

                        // When an active cap is set, adapt immediately to the ceiling
                        if active_limit > 0 {
                            let limit_f = active_limit as f64;
                            if smoothed_speed > limit_f {
                                smoothed_speed = limit_f;
                            }
                        }

                        if smoothed_speed < 100.0 {
                            smoothed_speed = 0.0;
                        }

                        let mut speed = smoothed_speed.round() as u64;
                        if active_limit > 0 && speed > active_limit {
                            speed = active_limit;
                        }
                        if should_checkpoint {
                            let _ = p_db.update_download_progress(&p_task_id, monotonic_total, speed);
                        }
                        last_bytes = monotonic_total;
                        last_time = now;

                        // Calculate ETA with IDM-style damped low-pass filter
                        if speed > 100 {
                            if let Some(total) = p_total_bytes {
                                if total > monotonic_total {
                                    let instant_eta = ((total - monotonic_total) as f64 / speed as f64).max(1.0);
                                    persistent_eta = match persistent_eta {
                                        Some(prev_eta) => {
                                            // Heavy dampening: 90% previous, 10% instant new estimate
                                            let smoothed = (prev_eta as f64 * 0.90) + (instant_eta * 0.10);
                                            Some(smoothed.round().max(1.0) as u64)
                                        }
                                        None => Some(instant_eta.round().max(1.0) as u64),
                                    };
                                } else {
                                    persistent_eta = Some(0);
                                }
                            }
                        }

                        // Strictly clamp reported downloaded bytes so it NEVER exceeds total_bytes
                        let clamped_downloaded = if let Some(total) = p_total_bytes {
                            monotonic_total.min(total)
                        } else {
                            monotonic_total
                        };

                        let event = DownloadProgressEvent {
                            task_id: p_task_id.clone(),
                            status: "downloading".to_string(),
                            downloaded_bytes: clamped_downloaded,
                            total_bytes: p_total_bytes,
                            speed_bytes_sec: speed,
                            eta_seconds: persistent_eta,
                            segments: snapshots,
                            supports_ranges: Some(p_supports_ranges && !p_fallback.load(Ordering::SeqCst)),
                        };

                        let _ = t_progress_tx.send(event).await;
                    }
                }
            }
        });

        // Fast-path: if resuming an already-complete staging file (e.g. retrying final rename after lock), skip network workers
        let already_complete = {
            let segs = segments.read().await;
            effective_is_resume && total_bytes.is_some() && Self::evaluate_progress(&segs, total_bytes).1
        };

        // Fixed-size parallel worker pool: capped strictly to user's max_connections (up to 32)
        let initial_seg_count = segments.read().await.len();
        let worker_count = if already_complete {
            completion_token.cancel();
            0
        } else if supports_ranges && (total_bytes.is_some() || effective_is_resume) {
            max_connections.clamp(1, 32) as usize
        } else {
            1
        };

        // Pre-claim initial segments atomically before spawning staggered workers so worker 0
        // cannot steal a staggered worker's own initial segment during startup delay.
        if worker_count > 0 {
            let segs = segments.read().await;
            for idx in 0..worker_count {
                if let Some(s) = segs.get(idx) {
                    s.is_active.store(true, Ordering::SeqCst);
                }
            }
        }

        let mut worker_handles = Vec::new();

        for idx in 0..worker_count {
            let initial_seg_idx = if idx < initial_seg_count {
                idx as u32
            } else {
                u32::MAX
            };

            let w_client = self.client.clone();
            let w_url = url.clone();
            let w_writer = writer.clone();
            let w_segments = segments.clone();
            let w_headers = custom_headers.clone();
            let w_cancel = cancel_token.clone();
            let w_complete = completion_token.clone();
            let w_task_id = task_id.clone();
            let w_supports_ranges = supports_ranges;
            let w_fallback = fallback_single_stream.clone();
            let w_limiter = limiter.clone();
            let w_total_bytes = total_bytes;
            let w_db = self.db.clone();
            let w_fatal_err = fatal_error_msg.clone();
            let w_unknown_eof = stream_completed_unknown.clone();

            let handle = tauri::async_runtime::spawn(async move {
                // Stagger initial connections (20ms per worker), waking immediately if paused or deleted
                if idx > 0 {
                    tokio::select! {
                        _ = w_cancel.cancelled() => return,
                        _ = w_complete.cancelled() => return,
                        _ = tokio::time::sleep(Duration::from_millis((idx as u64) * 20)) => {}
                    }
                }
                Self::worker_loop(
                    initial_seg_idx,
                    w_task_id,
                    w_db,
                    w_url,
                    w_client,
                    w_writer,
                    w_segments,
                    w_headers,
                    w_supports_ranges,
                    w_fallback,
                    w_limiter,
                    w_total_bytes,
                    w_cancel,
                    w_complete,
                    w_fatal_err,
                    w_unknown_eof,
                )
                .await
            });
            worker_handles.push(handle);
        }

        // Worker completion tracking: await handles once in a dedicated task
        let (done_tx, mut done_rx) = tokio::sync::oneshot::channel();
        tauri::async_runtime::spawn(async move {
            for h in worker_handles {
                let _ = h.await;
            }
            let _ = done_tx.send(());
        });

        // Master Coordination: Await either completion or user cancellation or worker exhaustion
        tokio::select! {
            _ = cancel_token.cancelled() => {
                completion_token.cancel();
                let _ = (&mut done_rx).await;
            }
            _ = completion_token.cancelled() => {
                let _ = (&mut done_rx).await;
            }
            _ = &mut done_rx => {}
        }

        // Abort background telemetry loop and signal any residual worker
        completion_token.cancel();
        telemetry_handle.abort();

        if cancel_token.is_cancelled() {
            // Skip slow FlushFileBuffers & SQLite writes if task record was already deleted (stop & delete)
            let existing_record = self.db.get_download(&task_id).ok().flatten();
            let task_exists = existing_record.is_some();
            if task_exists {
                let w_sync = writer.clone();
                let _ = tauri::async_runtime::spawn_blocking(move || w_sync.sync()).await;
                self.persist_segments_to_db(&task_id, &segments).await;
            }

            // Close OS file handles BEFORE firing completion signals or emitting final status
            drop(writer);

            if let Some(rec) = existing_record {
                let (raw_downloaded, _) = {
                    let segs = segments.read().await;
                    Self::evaluate_progress(&segs, total_bytes)
                };
                let downloaded_bytes = max_downloaded.load(Ordering::SeqCst).max(raw_downloaded);
                // Preserve 'queued' or completed/error state if transitioned externally
                let st = rec.status;
                if st != "queued" && st != "completed" && st != "error" && st != "failed" {
                    let _ = self.db.update_download_status(&task_id, "paused", 0, None);
                }
                let reported_status = if st == "queued" {
                    "queued".to_string()
                } else {
                    "paused".to_string()
                };
                let _ = progress_tx.send(DownloadProgressEvent {
                    task_id: task_id.clone(),
                    status: reported_status,
                    downloaded_bytes: total_bytes.map(|t| downloaded_bytes.min(t)).unwrap_or(downloaded_bytes),
                    total_bytes,
                    speed_bytes_sec: 0,
                    eta_seconds: None,
                    segments: Vec::new(),
                    supports_ranges: None,
                }).await;
            }
            return Ok(());
        }

        // Flush all in-memory buffers and OS page cache to physical disk off the async runtime
        let w_sync = writer.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || w_sync.sync()).await;

        // Persist final segment state to SQLite
        self.persist_segments_to_db(&task_id, &segments).await;

        // Complete Verification Phase (REA / IDM Specification)
        let (raw_verified, is_done) = {
            let segs = segments.read().await;
            Self::evaluate_progress(&segs, total_bytes)
        };
        let verified_downloaded = max_downloaded.load(Ordering::SeqCst).max(raw_verified);

        let fatal_opt = { fatal_error_msg.lock().take() };
        if let Some(fatal_msg) = fatal_opt {
            let _ = self.db.update_download_status(&task_id, "failed", 0, Some(&fatal_msg));
            let _ = progress_tx.send(DownloadProgressEvent {
                task_id: task_id.clone(),
                status: "failed".to_string(),
                downloaded_bytes: total_bytes.map(|t| verified_downloaded.min(t)).unwrap_or(verified_downloaded),
                total_bytes,
                speed_bytes_sec: 0,
                eta_seconds: None,
                segments: Vec::new(),
                supports_ranges: None,
            }).await;
            return Err(fatal_msg.into());
        }

        if let Some(expected) = total_bytes {
            if expected > 0 && !is_done && verified_downloaded < expected {
                let err_msg = "Download interrupted before receiving all expected bytes";
                eprintln!(
                    "[Downex Completion] Incomplete download detected: {} / {} bytes. Preserving '{}' and marking failed.",
                    verified_downloaded, expected, staging_path_buf.display()
                );
                let _ = self.db.update_download_status(&task_id, "failed", 0, Some(err_msg));
                let _ = progress_tx.send(DownloadProgressEvent {
                    task_id: task_id.clone(),
                    status: "failed".to_string(),
                    downloaded_bytes: verified_downloaded,
                    total_bytes,
                    speed_bytes_sec: 0,
                    eta_seconds: None,
                    segments: Vec::new(),
                    supports_ranges: None,
                }).await;
                return Err(err_msg.into());
            }
        } else if verified_downloaded == 0 || !stream_completed_unknown.load(Ordering::SeqCst) {
            let err_msg = if verified_downloaded == 0 {
                "Download ended without receiving any bytes"
            } else {
                "Stream closed prematurely before end of file"
            };
            let _ = self.db.update_download_status(&task_id, "failed", 0, Some(err_msg));
            let _ = progress_tx.send(DownloadProgressEvent {
                task_id: task_id.clone(),
                status: "failed".to_string(),
                downloaded_bytes: verified_downloaded,
                total_bytes: None,
                speed_bytes_sec: 0,
                eta_seconds: None,
                segments: Vec::new(),
                supports_ranges: None,
            }).await;
            return Err(err_msg.into());
        }

        // Physical File Length & OS Media Sync Enforcement
        let final_size = total_bytes.unwrap_or(verified_downloaded);
        if final_size > 0 {
            let _ = writer.set_len(final_size);
        }
        writer.sync()?;

        // CRITICAL: Close all open Windows file handles to `unconfirmed.*.downex` BEFORE verification and promotion
        drop(writer);

        // Verify staging file integrity and atomically promote `unconfirmed.{og_name}.downex` -> `{og_name}`
        let promote_staging = staging_path_buf.clone();
        let promote_target = target_path_buf.clone();
        let finalized_path = tauri::async_runtime::spawn_blocking(move || -> Result<PathBuf, String> {
            let verified_len = verify_staged_file_integrity(
                &promote_staging,
                total_bytes,
                verified_downloaded,
            )?;
            let promote_expected = if final_size > 0 { final_size } else { verified_len };
            promote_unconfirmed_to_final(&promote_staging, &promote_target, promote_expected)
        })
        .await
        .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())) as Box<dyn std::error::Error + Send + Sync>)?
        .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e)) as Box<dyn std::error::Error + Send + Sync>)?;

        let finalized_str = finalized_path.to_string_lossy().to_string();
        let finalized_name = finalized_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                Path::new(&destination_path)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "download".to_string())
            });

        // Clear staging_path and commit finalized path BEFORE emitting completed status/dialog
        let _ = self
            .db
            .update_download_finalized_target(&task_id, &finalized_str, &finalized_name);

        // Mark completed in database and publish terminal completed event
        let _ = self.db.update_download_progress(&task_id, final_size, 0);
        let _ = self.db.update_download_status(&task_id, "completed", 0, None);

        let _ = progress_tx.send(DownloadProgressEvent {
            task_id: task_id.clone(),
            status: "completed".to_string(),
            downloaded_bytes: final_size,
            total_bytes: Some(final_size),
            speed_bytes_sec: 0,
            eta_seconds: None,
            segments: Vec::new(),
            supports_ranges: None,
        }).await;

        eprintln!(
            "[Downex Completion] Successfully finalized '{}' -> '{}': {} bytes verified on disk.",
            staging_path_buf.display(), finalized_str, final_size
        );

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn worker_loop(
        mut segment_idx: u32,
        task_id: String,
        db: DatabaseManager,
        url: String,
        client: reqwest::Client,
        writer: Arc<PositionalWriter>,
        segments: Arc<RwLock<Vec<ActiveSegment>>>,
        custom_headers: Option<HashMap<String, String>>,
        supports_ranges: bool,
        fallback_single_stream: Arc<AtomicBool>,
        limiter: Arc<super::limiter::TaskSpeedLimiter>,
        total_bytes: Option<u64>,
        cancel_token: CancellationToken,
        completion_token: CancellationToken,
        fatal_error_msg: Arc<parking_lot::Mutex<Option<String>>>,
        stream_completed_unknown: Arc<AtomicBool>,
    ) {
        let mut preclaimed = segment_idx != u32::MAX;

        // Unassigned worker entry: immediately seek work or steal from active segment
        if segment_idx == u32::MAX {
            if let Some(next_idx) = Self::find_next_work(&segments, supports_ranges, &fallback_single_stream).await {
                segment_idx = next_idx;
                preclaimed = true;
            } else {
                let mut found = None;
                for _ in 0..5 {
                    tokio::select! {
                        _ = cancel_token.cancelled() => return,
                        _ = completion_token.cancelled() => return,
                        _ = tokio::time::sleep(Duration::from_millis(200)) => {
                            if let Some(next_idx) = Self::find_next_work(&segments, supports_ranges, &fallback_single_stream).await {
                                found = Some(next_idx);
                                break;
                            }
                        }
                    }
                }
                if let Some(next_idx) = found {
                    segment_idx = next_idx;
                    preclaimed = true;
                } else {
                    return;
                }
            }
        }

        let record_fatal = |msg: String| {
            let mut guard = fatal_error_msg.lock();
            if guard.is_none() {
                *guard = Some(msg.clone());
            }
            let _ = db.update_download_status(&task_id, "failed", 0, Some(&msg));
            completion_token.cancel();
        };

        let mut consecutive_failures: u32 = 0;
        const MAX_WORKER_FAILURES: u32 = 12;

        loop {
            if cancel_token.is_cancelled() || completion_token.is_cancelled() {
                break;
            }

            // Retrieve current segment handles
            let (start, end_atomic, downloaded_atomic, is_active_atomic) = {
                let segs = segments.read().await;
                if let Some(s) = segs.iter().find(|s| s.index == segment_idx) {
                    (
                        s.range_start,
                        s.range_end.clone(),
                        s.downloaded.clone(),
                        s.is_active.clone(),
                    )
                } else {
                    break;
                }
            };

            let end = end_atomic.load(Ordering::SeqCst);
            let mut downloaded_so_far = downloaded_atomic.load(Ordering::SeqCst);
            let expected_segment_bytes = if end != UNKNOWN_RANGE_END && end >= start { end - start + 1 } else { 0 };

            // Check if this segment has already received its full byte allocation
            if expected_segment_bytes > 0 && downloaded_so_far >= expected_segment_bytes {
                is_active_atomic.store(false, Ordering::SeqCst);

                // Look for another incomplete segment or steal work
                if let Some(next_idx) = Self::find_next_work(&segments, supports_ranges, &fallback_single_stream).await {
                    segment_idx = next_idx;
                    preclaimed = true;
                    continue;
                }

                // If no work immediately available, check if whole download is complete
                {
                    let segs = segments.read().await;
                    let (_, is_done) = Self::evaluate_progress(&segs, total_bytes);
                    if is_done {
                        break;
                    }
                }

                // Poll briefly (up to 5 attempts, 200ms each) in case another connection stalls or a split opens up
                let mut found = None;
                for _ in 0..5 {
                    tokio::select! {
                        _ = cancel_token.cancelled() => break,
                        _ = completion_token.cancelled() => break,
                        _ = tokio::time::sleep(Duration::from_millis(200)) => {
                            if let Some(next_idx) = Self::find_next_work(&segments, supports_ranges, &fallback_single_stream).await {
                                found = Some(next_idx);
                                break;
                            }
                        }
                    }
                }

                if let Some(next_idx) = found {
                    segment_idx = next_idx;
                    preclaimed = true;
                    continue;
                }
                break;
            }

            // If another worker encountered HTTP 200 OK without Range support, only worker 0 runs
            if fallback_single_stream.load(Ordering::SeqCst) && segment_idx != 0 {
                is_active_atomic.store(false, Ordering::SeqCst);
                break;
            }

            if preclaimed {
                preclaimed = false;
            } else if is_active_atomic
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_err()
            {
                if let Some(next_idx) = Self::find_next_work(&segments, supports_ranges, &fallback_single_stream).await {
                    segment_idx = next_idx;
                    preclaimed = true;
                    continue;
                }
                break;
            }

            let sending_range = supports_ranges && end != UNKNOWN_RANGE_END && !fallback_single_stream.load(Ordering::SeqCst);
            if !sending_range && downloaded_so_far > 0 {
                // Reconnecting an un-ranged stream always restarts from byte 0; reset progress to avoid offset corruption.
                downloaded_atomic.store(0, Ordering::SeqCst);
                downloaded_so_far = 0;
            }
            let current_offset = start + downloaded_so_far;

            // Build HTTP Request
            let mut req = client.get(&url);
            req = req.header(reqwest::header::ACCEPT_ENCODING, "identity");
            req = req.header("Cache-Control", "no-cache");
            req = req.header("Pragma", "no-cache");

            if let Some(ref headers) = custom_headers {
                let mut header_map = HeaderMap::new();
                for (k, v) in headers {
                    if let (Ok(name), Ok(val)) = (
                        reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                        HeaderValue::from_str(v),
                    ) {
                        header_map.insert(name, val);
                    }
                }
                req = req.headers(header_map);
            }

            if sending_range {
                req = req.header(RANGE, format!("bytes={}-{}", current_offset, end));
            }

            let res = tokio::select! {
                _ = cancel_token.cancelled() => {
                    is_active_atomic.store(false, Ordering::SeqCst);
                    break;
                }
                _ = completion_token.cancelled() => {
                    is_active_atomic.store(false, Ordering::SeqCst);
                    break;
                }
                send_res = req.send() => match send_res {
                    Ok(r) => r,
                    Err(e) => {
                        consecutive_failures += 1;
                        eprintln!("[Downex Worker {}] Connect error ({}/{}): {}", segment_idx, consecutive_failures, MAX_WORKER_FAILURES, e);
                        is_active_atomic.store(false, Ordering::SeqCst);
                        if consecutive_failures >= MAX_WORKER_FAILURES {
                            record_fatal(format!("Connection failed after retries: {}", e));
                            return;
                        }
                        tokio::select! {
                            _ = cancel_token.cancelled() => break,
                            _ = completion_token.cancelled() => break,
                            _ = tokio::time::sleep(Duration::from_millis(1000)) => {}
                        }
                        continue;
                    }
                }
            };

            let status = res.status();

            // Handle HTTP 200 OK response on range-expected request (Single stream fallback)
            if status == reqwest::StatusCode::OK && supports_ranges {
                fallback_single_stream.store(true, Ordering::SeqCst);
                let _ = db.update_download_supports_ranges(&task_id, false);
                if segment_idx == 0 {
                    eprintln!("[Downex Worker 0] Server returned HTTP 200 OK (Range ignored). Switching to single-stream mode.");
                    let total_end = total_bytes.map(|b| if b > 0 { b - 1 } else { UNKNOWN_RANGE_END }).unwrap_or(UNKNOWN_RANGE_END);
                    // Reset worker 0 state cleanly to byte 0
                    downloaded_atomic.store(0, Ordering::SeqCst);
                    {
                        let mut segs = segments.write().await;
                        segs.retain(|s| s.index == 0);
                        if let Some(s) = segs.first_mut() {
                            s.range_start = 0;
                            s.range_end.store(total_end, Ordering::SeqCst);
                        }
                    }
                } else {
                    let seg0_taken_over = {
                        let mut segs = segments.write().await;
                        let seg0_active = segs
                            .iter()
                            .any(|s| s.index == 0 && s.is_active.load(Ordering::SeqCst));
                        if !seg0_active {
                            is_active_atomic.store(false, Ordering::SeqCst);
                            let total_end = total_bytes
                                .map(|b| if b > 0 { b - 1 } else { UNKNOWN_RANGE_END })
                                .unwrap_or(UNKNOWN_RANGE_END);
                            segs.retain(|s| s.index == 0);
                            if let Some(s) = segs.first_mut() {
                                s.range_start = 0;
                                s.range_end.store(total_end, Ordering::SeqCst);
                                s.downloaded.store(0, Ordering::SeqCst);
                                s.is_active.store(true, Ordering::SeqCst);
                            }
                            true
                        } else {
                            false
                        }
                    };
                    if seg0_taken_over {
                        eprintln!(
                            "[Downex Worker {}] Server returned HTTP 200 OK while Worker 0 was idle. Taking over as single-stream Worker 0.",
                            segment_idx
                        );
                        segment_idx = 0;
                        preclaimed = true;
                        continue;
                    } else {
                        // Non-zero worker received HTTP 200 OK while Worker 0 is active: abort duplicate stream.
                        eprintln!("[Downex Worker {}] Server returned HTTP 200 OK to non-zero worker. Aborting worker.", segment_idx);
                        is_active_atomic.store(false, Ordering::SeqCst);
                        return;
                    }
                }
            } else if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
                let expected = if end != UNKNOWN_RANGE_END && end >= start { end - start + 1 } else { 0 };
                let current_d = downloaded_atomic.load(Ordering::SeqCst);
                if expected > 0 && current_d >= expected {
                    is_active_atomic.store(false, Ordering::SeqCst);
                    if let Some(next_idx) = Self::find_next_work(&segments, supports_ranges, &fallback_single_stream).await {
                        segment_idx = next_idx;
                        preclaimed = true;
                        continue;
                    }
                    break;
                }
                consecutive_failures += 1;
                eprintln!("[Downex Worker {}] Unexpected HTTP 416 at offset {} ({}/{})", segment_idx, start + current_d, consecutive_failures, MAX_WORKER_FAILURES);
                is_active_atomic.store(false, Ordering::SeqCst);
                if consecutive_failures >= MAX_WORKER_FAILURES {
                    record_fatal("Server rejected byte range (HTTP 416)".to_string());
                    return;
                }
                tokio::select! {
                    _ = cancel_token.cancelled() => break,
                    _ = completion_token.cancelled() => break,
                    _ = tokio::time::sleep(Duration::from_millis(500)) => {}
                }
                continue;
            } else if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status == reqwest::StatusCode::SERVICE_UNAVAILABLE {
                consecutive_failures += 1;
                eprintln!("[Downex Worker {}] Server rate limit / throttle (HTTP {}, {}/{}). Backing off for 2s...", segment_idx, status, consecutive_failures, MAX_WORKER_FAILURES);
                is_active_atomic.store(false, Ordering::SeqCst);
                if consecutive_failures >= MAX_WORKER_FAILURES {
                    record_fatal(format!("Server throttled requests (HTTP {})", status.as_u16()));
                    return;
                }
                tokio::select! {
                    _ = cancel_token.cancelled() => break,
                    _ = completion_token.cancelled() => break,
                    _ = tokio::time::sleep(Duration::from_millis(2000)) => {}
                }
                continue;
            } else if status == reqwest::StatusCode::NOT_FOUND
                || status == reqwest::StatusCode::FORBIDDEN
                || status == reqwest::StatusCode::UNAUTHORIZED
                || status == reqwest::StatusCode::GONE
            {
                let err_msg = format!("Server returned HTTP {} ({})", status.as_u16(), status.canonical_reason().unwrap_or("Error"));
                eprintln!("[Downex Worker {}] Fatal HTTP error: {}", segment_idx, err_msg);
                is_active_atomic.store(false, Ordering::SeqCst);
                record_fatal(err_msg);
                return;
            } else if !status.is_success() && status != reqwest::StatusCode::PARTIAL_CONTENT {
                consecutive_failures += 1;
                eprintln!("[Downex Worker {}] Server HTTP {} ({}/{}): retrying in 1s...", segment_idx, status, consecutive_failures, MAX_WORKER_FAILURES);
                is_active_atomic.store(false, Ordering::SeqCst);
                if consecutive_failures >= MAX_WORKER_FAILURES {
                    record_fatal(format!("Server returned HTTP {}", status.as_u16()));
                    return;
                }
                tokio::select! {
                    _ = cancel_token.cancelled() => break,
                    _ = completion_token.cancelled() => break,
                    _ = tokio::time::sleep(Duration::from_millis(1000)) => {}
                }
                continue;
            }

            let effective_start = if status == reqwest::StatusCode::OK && fallback_single_stream.load(Ordering::SeqCst) {
                0
            } else {
                start
            };
            let mut stream = res.bytes_stream();
            let mut stream_clean_eof = false;
            let mut stream_bytes_written: u64 = 0;
            let mut stream_io_error: Option<String> = None;

            loop {
                let chunk_res = tokio::select! {
                    _ = cancel_token.cancelled() => {
                        is_active_atomic.store(false, Ordering::SeqCst);
                        return;
                    }
                    _ = completion_token.cancelled() => {
                        is_active_atomic.store(false, Ordering::SeqCst);
                        return;
                    }
                    opt = tokio::time::timeout(Duration::from_millis(4000), stream.next()) => {
                        match opt {
                            Ok(Some(item)) => item,
                            Ok(None) => {
                                stream_clean_eof = true;
                                break; // Server closed stream (clean EOF)
                            }
                            Err(_timeout) => {
                                // Socket stalled for 4s with no incoming bytes (straggler / dead TCP route)
                                eprintln!("[Downex Worker {}] Straggler detected (4s socket stall). Recycling connection...", segment_idx);
                                break;
                            }
                        }
                    }
                };

                if fallback_single_stream.load(Ordering::SeqCst) && segment_idx != 0 {
                    is_active_atomic.store(false, Ordering::SeqCst);
                    return;
                }

                match chunk_res {
                    Ok(chunk) => {
                        let current_d = downloaded_atomic.load(Ordering::SeqCst);
                        let target_end = end_atomic.load(Ordering::SeqCst);
                        let expected = if target_end != UNKNOWN_RANGE_END && target_end >= effective_start {
                            target_end - effective_start + 1
                        } else {
                            0
                        };

                        if expected > 0 && current_d >= expected {
                            // Target segment byte boundary reached! Terminate connection stream.
                            break;
                        }

                        let remaining_in_segment = if expected > 0 {
                            expected.saturating_sub(current_d)
                        } else {
                            chunk.len() as u64
                        };

                        let write_len = (chunk.len() as u64).min(remaining_in_segment);

                        if write_len > 0 {
                            let write_offset = effective_start + current_d;
                            if let Err(e) = writer.write_at(write_offset, &chunk[..write_len as usize]) {
                                eprintln!("[Downex Writer] Positional write error at {}: {}", write_offset, e);
                                stream_io_error = Some(format!("Disk write error: {}", e));
                                break;
                            }
                            downloaded_atomic.fetch_add(write_len, Ordering::SeqCst);
                            stream_bytes_written += write_len;
                            consecutive_failures = 0;
                            if !limiter.throttle_cancellable(write_len as usize, &cancel_token, &completion_token).await {
                                is_active_atomic.store(false, Ordering::SeqCst);
                                return;
                            }
                        }

                        // Check if boundary was reached with this chunk
                        let total_after = current_d + write_len;
                        if expected > 0 && total_after >= expected {
                            break;
                        }
                    }
                    Err(e) => {
                        eprintln!("[Downex Stream {}] Read error: {}", segment_idx, e);
                        stream_io_error = Some(format!("Stream read error: {}", e));
                        break;
                    }
                }
            }

            is_active_atomic.store(false, Ordering::SeqCst);

            // Check if global download completed with this stream's bytes or clean EOF on unknown-size stream
            {
                let segs = segments.read().await;
                let (curr_total, is_done) = Self::evaluate_progress(&segs, total_bytes);
                if is_done || (stream_clean_eof && stream_io_error.is_none() && total_bytes.is_none() && curr_total > 0) {
                    if stream_clean_eof && total_bytes.is_none() {
                        stream_completed_unknown.store(true, Ordering::SeqCst);
                    }
                    completion_token.cancel();
                    break;
                }
            }

            // Track consecutive zero-progress or I/O failures so disk-full/broken streams never spin infinitely
            if stream_io_error.is_some() || (stream_bytes_written == 0 && !stream_clean_eof) {
                consecutive_failures += 1;
                if consecutive_failures >= MAX_WORKER_FAILURES {
                    record_fatal(stream_io_error.unwrap_or_else(|| "Download stalled without progress after retries".to_string()));
                    return;
                }
                tokio::select! {
                    _ = cancel_token.cancelled() => break,
                    _ = completion_token.cancelled() => break,
                    _ = tokio::time::sleep(Duration::from_millis(500)) => {}
                }
            } else if stream_clean_eof && stream_bytes_written == 0 {
                // Clean 0-byte EOF mid-segment (e.g., server closed early) counts toward retries
                consecutive_failures += 1;
                if consecutive_failures >= MAX_WORKER_FAILURES {
                    record_fatal("Server closed connection repeatedly without delivering requested byte range".to_string());
                    return;
                }
            }

            // Find next work: either incomplete idle segment or split active segment
            if let Some(next_idx) = Self::find_next_work(&segments, supports_ranges, &fallback_single_stream).await {
                segment_idx = next_idx;
                preclaimed = true;
                continue;
            }

            // Check if current segment still has bytes left to download (e.g. after a stalled socket recycle)
            {
                let current_d = downloaded_atomic.load(Ordering::SeqCst);
                let current_end = end_atomic.load(Ordering::SeqCst);
                let exp = if current_end != UNKNOWN_RANGE_END && current_end >= start { current_end - start + 1 } else { 0 };
                let unknown_incomplete = total_bytes.is_none()
                    && !stream_clean_eof
                    && !stream_completed_unknown.load(Ordering::SeqCst);
                if (exp > 0 && current_d < exp) || unknown_incomplete {
                    // Reconnect this same segment from current offset with fresh TCP connection
                    continue;
                }
            }

            // If no work immediately available, poll briefly before terminating worker
            let mut found = None;
            for _ in 0..5 {
                tokio::select! {
                    _ = cancel_token.cancelled() => break,
                    _ = completion_token.cancelled() => break,
                    _ = tokio::time::sleep(Duration::from_millis(200)) => {
                        if let Some(next_idx) = Self::find_next_work(&segments, supports_ranges, &fallback_single_stream).await {
                            found = Some(next_idx);
                            break;
                        }
                    }
                }
            }

            if let Some(next_idx) = found {
                segment_idx = next_idx;
                preclaimed = true;
                continue;
            }

            break;
        }
    }

    /// Finds next available work for an idle connection:
    /// 1. First priority: any existing idle segment that was interrupted or unfinished (atomically claimed).
    /// 2. Second priority: work-stealing from the active segment with largest remaining bytes.
    async fn find_next_work(
        segments: &Arc<RwLock<Vec<ActiveSegment>>>,
        supports_ranges: bool,
        fallback_single_stream: &Arc<AtomicBool>,
    ) -> Option<u32> {
        if !supports_ranges || fallback_single_stream.load(Ordering::SeqCst) {
            return None;
        }

        // 1. Look for existing unfinished idle segments and atomically claim
        {
            let segs = segments.read().await;
            for s in segs.iter() {
                if !s.is_complete() {
                    if s.is_active.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
                        return Some(s.index);
                    }
                }
            }
        }

        // 2. Dynamic work-stealing (split active segment)
        Self::try_steal_work(segments).await
    }

    /// Work-stealing algorithm (IDM REA Specification):
    /// Finds the active connection with the largest remaining byte distance,
    /// atomically truncates its end boundary, and creates a new segment for the second half.
    async fn try_steal_work(segments: &Arc<RwLock<Vec<ActiveSegment>>>) -> Option<u32> {
        let mut segs = segments.write().await;
        if segs.len() >= MAX_TOTAL_SEGMENTS {
            return None;
        }

        let mut max_remaining = 0u64;
        let mut target_seg_idx = None;

        for (i, s) in segs.iter().enumerate() {
            if s.is_active.load(Ordering::SeqCst) {
                let remaining = s.remaining_bytes();
                if remaining > max_remaining && remaining >= (MIN_SPLIT_THRESHOLD_BYTES * 2) {
                    max_remaining = remaining;
                    target_seg_idx = Some(i);
                }
            }
        }

        if let Some(target_idx) = target_seg_idx {
            let target = &mut segs[target_idx];
            let current_downloaded = target.downloaded.load(Ordering::SeqCst);
            let current_pos = target.range_start + current_downloaded;
            let target_end = target.range_end.load(Ordering::SeqCst);

            if target_end <= current_pos + (MIN_SPLIT_THRESHOLD_BYTES * 2) {
                return None;
            }

            let remaining = target_end - current_pos;
            let half = remaining / 2;
            let split_point = current_pos + half;

            let old_end = target_end;
            target.range_end.store(split_point, Ordering::SeqCst);

            let new_index = segs.len() as u32;
            segs.push(ActiveSegment {
                index: new_index,
                range_start: split_point + 1,
                range_end: Arc::new(AtomicU64::new(old_end)),
                downloaded: Arc::new(AtomicU64::new(0)),
                is_active: Arc::new(AtomicBool::new(true)), // Atomically claimed by the stealing worker!
            });

            return Some(new_index);
        }

        None
    }

    async fn persist_segments_to_db(&self, task_id: &str, segments: &Arc<RwLock<Vec<ActiveSegment>>>) {
        let segs = segments.read().await;
        let mut records = Vec::new();
        for s in segs.iter() {
            records.push(SegmentRecord {
                id: None,
                download_id: task_id.to_string(),
                segment_index: s.index,
                range_start: s.range_start,
                range_end: s.range_end.load(Ordering::SeqCst),
                downloaded: s.downloaded.load(Ordering::SeqCst),
                status: if s.is_active.load(Ordering::SeqCst) {
                    "downloading".to_string()
                } else if s.is_complete() {
                    "completed".to_string()
                } else {
                    "idle".to_string()
                },
            });
        }
        let _ = self.db.save_segments(task_id, &records);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::ensure_file_ready_to_open;
    use crate::db::DownloadRecord;
    use crate::engine::staging::{derive_primary_unconfirmed_path, robust_delete_path};
    use std::fs;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use uuid::Uuid;

    async fn spawn_test_http_server(
        payload: Arc<Vec<u8>>,
        force_200: bool,
        drip_delay_ms: u64,
    ) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tauri::async_runtime::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                let data = payload.clone();
                tauri::async_runtime::spawn(async move {
                    let mut req_buf = [0u8; 4096];
                    let n = match socket.read(&mut req_buf).await {
                        Ok(n) if n > 0 => n,
                        _ => return,
                    };
                    let req_str = String::from_utf8_lossy(&req_buf[..n]);
                    let mut range: Option<(usize, usize)> = None;
                    if !force_200 {
                        for line in req_str.lines() {
                            if let Some(rest) = line.strip_prefix("Range: bytes=").or_else(|| line.strip_prefix("range: bytes=")) {
                                if let Some((s, e)) = rest.trim().split_once('-') {
                                    if let (Ok(start), Ok(end)) = (s.parse::<usize>(), e.parse::<usize>()) {
                                        if start <= end && end < data.len() {
                                            range = Some((start, end));
                                        }
                                    }
                                }
                            }
                        }
                    }

                    let (status_line, slice, range_hdr) = if let Some((start, end)) = range {
                        (
                            "HTTP/1.1 206 Partial Content",
                            &data[start..=end],
                            format!("Content-Range: bytes {}-{}/{}\r\n", start, end, data.len()),
                        )
                    } else {
                        ("HTTP/1.1 200 OK", &data[..], String::new())
                    };

                    let headers = format!(
                        "{}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\n{}Connection: close\r\n\r\n",
                        status_line,
                        slice.len(),
                        range_hdr
                    );
                    if socket.write_all(headers.as_bytes()).await.is_err() {
                        return;
                    }

                    if drip_delay_ms == 0 {
                        let _ = socket.write_all(slice).await;
                    } else {
                        for chunk in slice.chunks(4096) {
                            if socket.write_all(chunk).await.is_err() {
                                return;
                            }
                            tokio::time::sleep(Duration::from_millis(drip_delay_ms)).await;
                        }
                    }
                    let _ = socket.shutdown().await;
                });
            }
        });
        format!("http://{}/test-asset.bin", addr)
    }

    fn seed_test_record(
        db: &DatabaseManager,
        id: &str,
        url: &str,
        filename: &str,
        dest_path: &Path,
        staging_path: &Path,
        total_bytes: u64,
        supports_ranges: bool,
    ) {
        let now = chrono::Utc::now().timestamp_millis();
        db.insert_download(&DownloadRecord {
            id: id.to_string(),
            url: url.to_string(),
            filename: filename.to_string(),
            destination_path: dest_path.to_string_lossy().to_string(),
            total_bytes: Some(total_bytes),
            downloaded_bytes: 0,
            status: "downloading".to_string(),
            etag: None,
            last_modified: None,
            headers_json: None,
            queue_id: "default".to_string(),
            speed_bytes_sec: 0,
            error_message: None,
            checksum: None,
            media_type: None,
            supports_ranges,
            created_at: now,
            updated_at: now,
            speed_limit_mbps: None,
            staging_path: Some(staging_path.to_string_lossy().to_string()),
        })
        .unwrap();
    }

    #[test]
    fn test_e2e_unconfirmed_staging_pause_resume_open_guard_and_promotion() {
        tauri::async_runtime::block_on(async {
            let root = std::env::temp_dir().join(format!("downex_e2e_staging_{}", Uuid::new_v4()));
            fs::create_dir_all(&root).unwrap();
            let db = DatabaseManager::new(root.join("test.db")).unwrap();
            let client = reqwest::Client::builder().no_proxy().build().unwrap();
            let pool = DownloadEnginePool::new(client, db.clone());

            // Deterministic 256 KB payload
            let payload: Vec<u8> = (0..262144u32).map(|i| ((i * 31 + 7) % 251) as u8).collect();
            let payload_arc = Arc::new(payload.clone());
            let url = spawn_test_http_server(payload_arc, false, 10).await;

            let final_dst = root.join("Jailer-2.mkv");
            let staging_dst = derive_primary_unconfirmed_path(&final_dst);
            assert_eq!(
                staging_dst.file_name().unwrap().to_string_lossy(),
                "unconfirmed.Jailer-2.mkv.downex"
            );

            let task_id = format!("task-{}", Uuid::new_v4());
            seed_test_record(
                &db,
                &task_id,
                &url,
                "Jailer-2.mkv",
                &final_dst,
                &staging_dst,
                payload.len() as u64,
                true,
            );

            // 1. Start multi-segment download and pause mid-transfer
            let (tx, _rx) = mpsc::channel(64);
            let cancel = CancellationToken::new();
            let cancel_trigger = cancel.clone();
            let staging_watch = staging_dst.clone();
            let final_watch = final_dst.clone();

            tauri::async_runtime::spawn(async move {
                for _ in 0..40 {
                    if staging_watch.exists() {
                        assert!(
                            !final_watch.exists(),
                            "Final filename MUST NOT exist while downloading!"
                        );
                        tokio::time::sleep(Duration::from_millis(25)).await;
                        cancel_trigger.cancel();
                        return;
                    }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
                cancel_trigger.cancel();
            });

            let limiter = Arc::new(crate::engine::TaskSpeedLimiter::new(0));
            pool.execute_download(
                task_id.clone(),
                url.clone(),
                final_dst.to_string_lossy().to_string(),
                staging_dst.to_string_lossy().to_string(),
                Some(payload.len() as u64),
                true,
                None,
                4,
                limiter.clone(),
                tx,
                cancel,
            )
            .await
            .unwrap();

            // Verify paused state: unconfirmed file stays on disk, final does NOT, opening is blocked!
            assert!(staging_dst.exists(), "Paused unconfirmed.*.downex must remain on disk for resume");
            assert!(!final_dst.exists(), "Original file must NOT appear on disk while paused");
            assert!(
                ensure_file_ready_to_open(&staging_dst.to_string_lossy(), &db).is_err(),
                "Opening unconfirmed.*.downex must be blocked"
            );
            assert!(
                ensure_file_ready_to_open(&final_dst.to_string_lossy(), &db).is_err(),
                "Opening incomplete destination path must be blocked"
            );

            // 2. Resume to 100% completion -> must promote unconfirmed.Jailer-2.mkv.downex -> Jailer-2.mkv
            let (tx2, _rx2) = mpsc::channel(64);
            let cancel2 = CancellationToken::new();
            pool.execute_download(
                task_id.clone(),
                url,
                final_dst.to_string_lossy().to_string(),
                staging_dst.to_string_lossy().to_string(),
                Some(payload.len() as u64),
                true,
                None,
                4,
                limiter,
                tx2,
                cancel2,
            )
            .await
            .unwrap();

            assert!(final_dst.exists(), "Final original file must exist after completion");
            assert!(!staging_dst.exists(), "Unconfirmed staging file must be promoted & removed");
            assert_eq!(fs::read(&final_dst).unwrap(), payload, "Final file must be bit-for-bit identical");

            let rec = db.get_download(&task_id).unwrap().unwrap();
            assert_eq!(rec.status, "completed");
            assert!(rec.staging_path.is_none());
            assert!(
                ensure_file_ready_to_open(&final_dst.to_string_lossy(), &db).is_ok(),
                "Completed original file must be openable"
            );

            robust_delete_path(&root);
        });
    }

    #[test]
    fn test_e2e_deleted_staging_fallback_and_single_stream_promotion() {
        tauri::async_runtime::block_on(async {
            let root = std::env::temp_dir().join(format!("downex_e2e_fallback_{}", Uuid::new_v4()));
            fs::create_dir_all(&root).unwrap();
            let db = DatabaseManager::new(root.join("test.db")).unwrap();
            let client = reqwest::Client::builder().no_proxy().build().unwrap();
            let pool = DownloadEnginePool::new(client, db.clone());

            let payload: Vec<u8> = (0..131072u32).map(|i| ((i * 17 + 3) % 251) as u8).collect();
            let payload_arc = Arc::new(payload.clone());
            // Force HTTP 200 OK (non-range single-stream server)
            let url = spawn_test_http_server(payload_arc, true, 0).await;

            let final_dst = root.join("installer.exe");
            let staging_dst = derive_primary_unconfirmed_path(&final_dst);
            let task_id = format!("task-ss-{}", Uuid::new_v4());
            seed_test_record(
                &db,
                &task_id,
                &url,
                "installer.exe",
                &final_dst,
                &staging_dst,
                payload.len() as u64,
                false,
            );

            // Seed stale DB segments pretending half was downloaded, while staging file does NOT exist on disk
            db.save_segments(
                &task_id,
                &[SegmentRecord {
                    id: None,
                    download_id: task_id.clone(),
                    segment_index: 0,
                    range_start: 0,
                    range_end: (payload.len() - 1) as u64,
                    downloaded: 65536,
                    status: "paused".to_string(),
                }],
            )
            .unwrap();
            assert!(!staging_dst.exists());

            // Resume fallback must detect missing unconfirmed file, reset from byte 0, and promote exact payload
            let (tx, _rx) = mpsc::channel(64);
            let cancel = CancellationToken::new();
            let limiter = Arc::new(crate::engine::TaskSpeedLimiter::new(0));
            pool.execute_download(
                task_id.clone(),
                url,
                final_dst.to_string_lossy().to_string(),
                staging_dst.to_string_lossy().to_string(),
                Some(payload.len() as u64),
                false,
                None,
                4,
                limiter,
                tx,
                cancel,
            )
            .await
            .unwrap();

            assert!(final_dst.exists());
            assert!(!staging_dst.exists());
            assert_eq!(fs::read(&final_dst).unwrap(), payload);

            // Startup crash reconciliation check: simulate a task left "downloading" on crash -> becomes "paused" keeping staging_path
            let crash_id = format!("crash-{}", Uuid::new_v4());
            let crash_final = root.join("crashed.zip");
            let crash_staging = derive_primary_unconfirmed_path(&crash_final);
            seed_test_record(
                &db,
                &crash_id,
                "http://127.0.0.1/crashed.zip",
                "crashed.zip",
                &crash_final,
                &crash_staging,
                1024,
                true,
            );
            db.recover_interrupted_tasks().unwrap();
            let recovered = db.get_download(&crash_id).unwrap().unwrap();
            assert_eq!(recovered.status, "paused");
            assert_eq!(
                recovered.staging_path.as_deref(),
                Some(crash_staging.to_string_lossy().as_ref())
            );

            robust_delete_path(&root);
        });
    }
}
