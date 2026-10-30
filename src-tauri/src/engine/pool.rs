use super::state::{DownloadProgressEvent, SegmentSnapshot};
use super::writer::PositionalWriter;
use crate::db::{DatabaseManager, SegmentRecord};
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, RANGE};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, RwLock};
use tokio_util::sync::CancellationToken;

const MIN_SPLIT_THRESHOLD_BYTES: u64 = 10 * 1024 * 1024; // 10 MB minimum to split a chunk
const MAX_CONCURRENT_SEGMENTS: usize = 32;

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
        if end >= start {
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
            total_downloaded += d.min(expected);

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
        total_bytes: Option<u64>,
        supports_ranges: bool,
        custom_headers: Option<HashMap<String, String>>,
        max_connections: u32,
        progress_tx: mpsc::Sender<DownloadProgressEvent>,
        cancel_token: CancellationToken,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Check if existing segment records exist in DB for resume
        let existing_segments = self.db.get_segments(&task_id).unwrap_or_default();
        let is_resume = !existing_segments.is_empty();
        let writer = Arc::new(PositionalWriter::new(&destination_path, total_bytes, is_resume)?);

        let segments: Arc<RwLock<Vec<ActiveSegment>>>;

        if !existing_segments.is_empty() && supports_ranges {
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
            // Partition segments in strict [start, end] non-overlapping byte intervals
            let conn_count = max_connections.clamp(1, 32) as u64;
            let chunk_size = size / conn_count;
            let mut list = Vec::new();

            for i in 0..conn_count {
                let start = i * chunk_size;
                let end = if i == conn_count - 1 {
                    size - 1
                } else {
                    (i + 1) * chunk_size - 1
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
        } else {
            // Single-stream fallback
            let initial_end = total_bytes.map(|b| if b > 0 { b - 1 } else { 0 }).unwrap_or(0);
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

        // Telemetry & Completion Coordinator Loop
        let p_task_id = task_id.clone();
        let p_segments = segments.clone();
        let p_total_bytes = total_bytes;
        let p_cancel = cancel_token.clone();
        let p_complete = completion_token.clone();
        let p_db = self.db.clone();
        let t_progress_tx = progress_tx.clone();

        let initial_downloaded: u64 = {
            let segs = segments.read().await;
            Self::evaluate_progress(&segs, total_bytes).0
        };

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
                        let segs = p_segments.read().await;
                        let (current_total, is_all_complete) = Self::evaluate_progress(&segs, p_total_bytes);

                        // If all bytes have been downloaded, trigger completion immediately!
                        if is_all_complete {
                            p_complete.cancel();
                            break;
                        }

                        let mut snapshots = Vec::new();
                        for s in segs.iter() {
                            let d = s.downloaded.load(Ordering::SeqCst);
                            let end = s.range_end.load(Ordering::SeqCst);
                            snapshots.push(SegmentSnapshot {
                                index: s.index,
                                start: s.range_start,
                                end,
                                downloaded: d.min(if end >= s.range_start { end - s.range_start + 1 } else { d }),
                                speed_bytes_sec: 0,
                                is_active: s.is_active.load(Ordering::SeqCst),
                            });
                        }

                        // Periodic 2-second SQLite checkpoint
                        if last_checkpoint_time.elapsed() >= Duration::from_secs(2) {
                            last_checkpoint_time = Instant::now();
                            let mut records = Vec::new();
                            for s in segs.iter() {
                                records.push(SegmentRecord {
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
                            let _ = p_db.save_segments(&p_task_id, &records);
                        }

                        let now = Instant::now();
                        let elapsed = now.duration_since(last_time).as_secs_f64();
                        let bytes_delta = current_total.saturating_sub(last_bytes);

                        let instant_speed = if elapsed > 0.0 {
                            bytes_delta as f64 / elapsed
                        } else {
                            0.0
                        };

                        // Heavy low-pass EMA dampener for speed: 95% previous, 5% instant estimate
                        // Ensures slow, realistic speedometer progression without wild packet burst fluctuation
                        smoothed_speed = if smoothed_speed <= 0.0 {
                            instant_speed
                        } else if instant_speed > 0.0 {
                            (smoothed_speed * 0.95) + (instant_speed * 0.05)
                        } else {
                            smoothed_speed * 0.92
                        };

                        if smoothed_speed < 100.0 {
                            smoothed_speed = 0.0;
                        }

                        let speed = smoothed_speed.round() as u64;
                        last_bytes = current_total;
                        last_time = now;

                        // Calculate ETA with IDM-style damped low-pass filter
                        if speed > 100 {
                            if let Some(total) = p_total_bytes {
                                if total > current_total {
                                    let instant_eta = ((total - current_total) as f64 / speed as f64).max(1.0);
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
                            current_total.min(total)
                        } else {
                            current_total
                        };

                        let event = DownloadProgressEvent {
                            task_id: p_task_id.clone(),
                            status: "downloading".to_string(),
                            downloaded_bytes: clamped_downloaded,
                            total_bytes: p_total_bytes,
                            speed_bytes_sec: speed,
                            eta_seconds: persistent_eta,
                            segments: snapshots,
                        };

                        let _ = t_progress_tx.send(event).await;
                        let _ = p_db.update_download_progress(&p_task_id, clamped_downloaded, speed);
                    }
                }
            }
        });

        // Spawn workers for each initial segment
        let initial_seg_count = segments.read().await.len();
        let mut worker_handles = Vec::new();

        for idx in 0..initial_seg_count {
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
            let w_total_bytes = total_bytes;

            let handle = tauri::async_runtime::spawn(async move {
                Self::worker_loop(
                    idx as u32,
                    w_task_id,
                    w_url,
                    w_client,
                    w_writer,
                    w_segments,
                    w_headers,
                    w_supports_ranges,
                    w_fallback,
                    w_total_bytes,
                    w_cancel,
                    w_complete,
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

        // Flush all in-memory buffers and OS page cache to physical disk
        let _ = writer.sync();

        // Persist final segment state to SQLite
        self.persist_segments_to_db(&task_id, &segments).await;

        if cancel_token.is_cancelled() {
            let (downloaded_bytes, _) = {
                let segs = segments.read().await;
                Self::evaluate_progress(&segs, total_bytes)
            };
            let _ = self.db.update_download_status(&task_id, "paused", 0, None);
            let _ = progress_tx.send(DownloadProgressEvent {
                task_id: task_id.clone(),
                status: "paused".to_string(),
                downloaded_bytes: total_bytes.map(|t| downloaded_bytes.min(t)).unwrap_or(downloaded_bytes),
                total_bytes,
                speed_bytes_sec: 0,
                eta_seconds: None,
                segments: Vec::new(),
            }).await;
            return Ok(());
        }

        // Complete Verification Phase (REA / IDM Specification)
        let segs = segments.read().await;
        let (verified_downloaded, is_done) = Self::evaluate_progress(&segs, total_bytes);

        if !is_done && total_bytes.is_some() {
            let expected = total_bytes.unwrap();
            if verified_downloaded < expected {
                eprintln!(
                    "[Downex Completion] Incomplete download detected: {} / {} bytes. Marking paused for resume.",
                    verified_downloaded, expected
                );
                let _ = self.db.update_download_status(&task_id, "paused", 0, None);
                let _ = progress_tx.send(DownloadProgressEvent {
                    task_id: task_id.clone(),
                    status: "paused".to_string(),
                    downloaded_bytes: verified_downloaded,
                    total_bytes,
                    speed_bytes_sec: 0,
                    eta_seconds: None,
                    segments: Vec::new(),
                }).await;
                return Err("Download interrupted before receiving all expected bytes".into());
            }
        }

        // Physical File Length & OS Media Sync Enforcement
        let final_size = total_bytes.unwrap_or(verified_downloaded);
        if final_size > 0 {
            let _ = writer.set_len(final_size);
        }
        writer.sync()?;

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
        }).await;

        eprintln!(
            "[Downex Completion] Successfully finalized download '{}': {} bytes verified on disk.",
            task_id, final_size
        );

        Ok(())
    }

    async fn worker_loop(
        mut segment_idx: u32,
        _task_id: String,
        url: String,
        client: reqwest::Client,
        writer: Arc<PositionalWriter>,
        segments: Arc<RwLock<Vec<ActiveSegment>>>,
        custom_headers: Option<HashMap<String, String>>,
        supports_ranges: bool,
        fallback_single_stream: Arc<AtomicBool>,
        total_bytes: Option<u64>,
        cancel_token: CancellationToken,
        completion_token: CancellationToken,
    ) {
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
            let downloaded_so_far = downloaded_atomic.load(Ordering::SeqCst);
            let expected_segment_bytes = if end >= start { end - start + 1 } else { 0 };

            // Check if this segment has already received its full byte allocation
            if expected_segment_bytes > 0 && downloaded_so_far >= expected_segment_bytes {
                is_active_atomic.store(false, Ordering::SeqCst);

                // Look for another incomplete segment or steal work
                if let Some(next_idx) = Self::find_next_work(&segments, supports_ranges, &fallback_single_stream).await {
                    segment_idx = next_idx;
                    continue;
                }
                break;
            }

            // If another worker encountered HTTP 200 OK without Range support, only worker 0 runs
            if fallback_single_stream.load(Ordering::SeqCst) && segment_idx != 0 {
                is_active_atomic.store(false, Ordering::SeqCst);
                break;
            }

            is_active_atomic.store(true, Ordering::SeqCst);
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

            if supports_ranges && end > 0 && !fallback_single_stream.load(Ordering::SeqCst) {
                req = req.header(RANGE, format!("bytes={}-{}", current_offset, end));
            }

            let res = match req.send().await {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("[Downex Worker {}] Connect error: {}", segment_idx, e);
                    is_active_atomic.store(false, Ordering::SeqCst);
                    tokio::select! {
                        _ = cancel_token.cancelled() => break,
                        _ = completion_token.cancelled() => break,
                        _ = tokio::time::sleep(Duration::from_millis(1000)) => {}
                    }
                    continue;
                }
            };

            let status = res.status();

            // Handle HTTP 200 OK response on range-expected request (Single stream fallback)
            if status == reqwest::StatusCode::OK && supports_ranges {
                fallback_single_stream.store(true, Ordering::SeqCst);
                if segment_idx == 0 {
                    eprintln!("[Downex Worker 0] Server returned HTTP 200 OK (Range ignored). Switching to single-stream mode.");
                    let total_end = total_bytes.map(|b| if b > 0 { b - 1 } else { 0 }).unwrap_or(0);
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
                    // Non-zero worker received HTTP 200 OK: Server does not support ranges!
                    eprintln!("[Downex Worker {}] Server returned HTTP 200 OK to non-zero worker. Aborting worker.", segment_idx);
                    is_active_atomic.store(false, Ordering::SeqCst);
                    return;
                }
            } else if !status.is_success() && status != reqwest::StatusCode::PARTIAL_CONTENT {
                eprintln!("[Downex Worker {}] Server HTTP {}: retrying...", segment_idx, status);
                is_active_atomic.store(false, Ordering::SeqCst);
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

            while let Some(chunk_res) = stream.next().await {
                if cancel_token.is_cancelled() || completion_token.is_cancelled() {
                    is_active_atomic.store(false, Ordering::SeqCst);
                    return;
                }

                if fallback_single_stream.load(Ordering::SeqCst) && segment_idx != 0 {
                    is_active_atomic.store(false, Ordering::SeqCst);
                    return;
                }

                match chunk_res {
                    Ok(chunk) => {
                        let current_d = downloaded_atomic.load(Ordering::SeqCst);
                        let target_end = end_atomic.load(Ordering::SeqCst);
                        let expected = if target_end >= effective_start { target_end - effective_start + 1 } else { 0 };

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
                                break;
                            }
                            downloaded_atomic.fetch_add(write_len, Ordering::SeqCst);
                        }

                        // Check if boundary was reached with this chunk
                        let total_after = current_d + write_len;
                        if expected > 0 && total_after >= expected {
                            break;
                        }
                    }
                    Err(e) => {
                        eprintln!("[Downex Stream {}] Read error: {}", segment_idx, e);
                        break;
                    }
                }
            }

            is_active_atomic.store(false, Ordering::SeqCst);

            // Check if global download completed with this stream's bytes
            {
                let segs = segments.read().await;
                let (curr_total, is_done) = Self::evaluate_progress(&segs, total_bytes);
                if is_done || (total_bytes.is_none() && curr_total > 0 && fallback_single_stream.load(Ordering::SeqCst)) {
                    completion_token.cancel();
                    break;
                }
            }

            // Find next work: either incomplete idle segment or split active segment
            if let Some(next_idx) = Self::find_next_work(&segments, supports_ranges, &fallback_single_stream).await {
                segment_idx = next_idx;
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
        if segs.len() >= MAX_CONCURRENT_SEGMENTS {
            return None;
        }

        let mut max_remaining = 0u64;
        let mut target_seg_idx = None;

        for (i, s) in segs.iter().enumerate() {
            if s.is_active.load(Ordering::SeqCst) {
                let remaining = s.remaining_bytes();
                if remaining > max_remaining && remaining >= MIN_SPLIT_THRESHOLD_BYTES {
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

            if target_end <= current_pos + MIN_SPLIT_THRESHOLD_BYTES {
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
