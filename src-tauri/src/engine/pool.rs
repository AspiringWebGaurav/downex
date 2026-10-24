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

const MIN_SPLIT_THRESHOLD_BYTES: u64 = 1024 * 1024; // 1 MB minimum to split a chunk

#[derive(Debug, Clone)]
pub struct ActiveSegment {
    pub index: u32,
    pub range_start: u64,
    pub range_end: Arc<AtomicU64>,
    pub downloaded: Arc<AtomicU64>,
    pub is_active: Arc<AtomicBool>,
}

pub struct DownloadEnginePool {
    client: reqwest::Client,
    db: DatabaseManager,
}

impl DownloadEnginePool {
    pub fn new(client: reqwest::Client, db: DatabaseManager) -> Self {
        Self { client, db }
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
        let writer = Arc::new(PositionalWriter::new(&destination_path, total_bytes)?);

        // Check if existing segment records exist in DB for resume
        let existing_segments = self.db.get_segments(&task_id).unwrap_or_default();

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
            // Divide initial ranges equally
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
            // Single stream fallback
            let list = vec![ActiveSegment {
                index: 0,
                range_start: 0,
                range_end: Arc::new(AtomicU64::new(total_bytes.unwrap_or(0))),
                downloaded: Arc::new(AtomicU64::new(0)),
                is_active: Arc::new(AtomicBool::new(false)),
            }];
            segments = Arc::new(RwLock::new(list));
        }

        // Save initial segments to DB
        self.persist_segments_to_db(&task_id, &segments).await;

        let total_downloaded = Arc::new(AtomicU64::new(0));

        // Progress telemetry loop
        let p_task_id = task_id.clone();
        let p_segments = segments.clone();
        let p_total_bytes = total_bytes;
        let p_total_downloaded = total_downloaded.clone();
        let p_cancel = cancel_token.clone();
        let p_db = self.db.clone();

        let initial_downloaded: u64 = {
            let segs = segments.read().await;
            segs.iter().map(|s| s.downloaded.load(Ordering::Relaxed)).sum()
        };

        let telemetry_handle = tauri::async_runtime::spawn(async move {
            let mut last_bytes = initial_downloaded;
            let mut last_time = Instant::now();
            let mut smoothed_speed = 0.0f64;
            let mut persistent_eta: Option<u64> = None;

            loop {
                tokio::select! {
                    _ = p_cancel.cancelled() => break,
                    _ = tokio::time::sleep(Duration::from_millis(200)) => {
                        let segs = p_segments.read().await;
                        let mut current_total = 0u64;
                        let mut snapshots = Vec::new();

                        for s in segs.iter() {
                            let d = s.downloaded.load(Ordering::Relaxed);
                            current_total += d;
                            snapshots.push(SegmentSnapshot {
                                index: s.index,
                                start: s.range_start,
                                end: s.range_end.load(Ordering::Relaxed),
                                downloaded: d,
                                speed_bytes_sec: 0,
                                is_active: s.is_active.load(Ordering::Relaxed),
                            });
                        }

                        p_total_downloaded.store(current_total, Ordering::Relaxed);

                        let now = Instant::now();
                        let elapsed = now.duration_since(last_time).as_secs_f64();
                        let bytes_delta = current_total.saturating_sub(last_bytes);

                        let instant_speed = if elapsed > 0.0 {
                            bytes_delta as f64 / elapsed
                        } else {
                            0.0
                        };

                        // Exponential Moving Average filter (prevents speed from jittering or dropping to 0 on momentary packet stalls)
                        smoothed_speed = if smoothed_speed <= 0.0 {
                            instant_speed
                        } else if instant_speed > 0.0 {
                            (smoothed_speed * 0.70) + (instant_speed * 0.30)
                        } else {
                            // On momentary packet arrival pause, decay gently rather than collapsing immediately to 0
                            smoothed_speed * 0.96
                        };

                        let speed = smoothed_speed.round() as u64;

                        last_bytes = current_total;
                        last_time = now;

                        // Persistent ETA calculation
                        if speed > 100 {
                            if let Some(total) = p_total_bytes {
                                if total > current_total {
                                    let calc = (total - current_total) / speed;
                                    persistent_eta = Some(calc.max(1));
                                } else {
                                    persistent_eta = Some(0);
                                }
                            }
                        }

                        let eta = persistent_eta;

                        let event = DownloadProgressEvent {
                            task_id: p_task_id.clone(),
                            status: "downloading".to_string(),
                            downloaded_bytes: current_total,
                            total_bytes: p_total_bytes,
                            speed_bytes_sec: speed,
                            eta_seconds: eta,
                            segments: snapshots,
                        };

                        let _ = progress_tx.send(event).await;
                        let _ = p_db.update_download_progress(&p_task_id, current_total, speed);
                    }
                }
            }
        });

        // Spawn workers for each initial segment
        let mut worker_handles = Vec::new();
        let seg_count = segments.read().await.len();

        for idx in 0..seg_count {
            let w_client = self.client.clone();
            let w_url = url.clone();
            let w_writer = writer.clone();
            let w_segments = segments.clone();
            let w_headers = custom_headers.clone();
            let w_cancel = cancel_token.clone();
            let w_task_id = task_id.clone();
            let w_supports_ranges = supports_ranges;

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
                    w_cancel,
                )
                .await
            });
            worker_handles.push(handle);
        }

        // Wait for workers to finish
        for h in worker_handles {
            let _ = h.await;
        }

        telemetry_handle.abort();
        writer.sync()?;

        // Persist final segment state to DB
        self.persist_segments_to_db(&task_id, &segments).await;

        if cancel_token.is_cancelled() {
            let _ = self.db.update_download_status(&task_id, "paused", 0, None);
        } else {
            let final_downloaded = total_downloaded.load(Ordering::Relaxed);
            let _ = self.db.update_download_progress(&task_id, final_downloaded, 0);
            let _ = self.db.update_download_status(&task_id, "completed", 0, None);
        }

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
        cancel_token: CancellationToken,
    ) {
        loop {
            if cancel_token.is_cancelled() {
                break;
            }

            // Retrieve current segment boundaries and atomic handles
            let (start, end_atomic, downloaded_so_far, is_active_atomic, downloaded_atomic) = {
                let segs = segments.read().await;
                if let Some(s) = segs.iter().find(|s| s.index == segment_idx) {
                    (
                        s.range_start,
                        s.range_end.clone(),
                        s.downloaded.load(Ordering::Relaxed),
                        s.is_active.clone(),
                        s.downloaded.clone(),
                    )
                } else {
                    break;
                }
            };

            let end = end_atomic.load(Ordering::Relaxed);
            let current_offset = start + downloaded_so_far;
            if current_offset > end && end > 0 {
                // Segment is complete! Try work stealing
                is_active_atomic.store(false, Ordering::Relaxed);
                if supports_ranges {
                    if let Some(new_idx) = Self::try_steal_work(&segments).await {
                        segment_idx = new_idx;
                        continue;
                    }
                }
                break;
            }

            is_active_atomic.store(true, Ordering::Relaxed);

            // Build request
            let mut req = client.get(&url);
            if let Some(ref headers) = custom_headers {
                let mut header_map = HeaderMap::new();
                for (k, v) in headers {
                    if let (Ok(name), Ok(val)) = (reqwest::header::HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(v)) {
                        header_map.insert(name, val);
                    }
                }
                req = req.headers(header_map);
            }

            if supports_ranges && end > 0 {
                req = req.header(RANGE, format!("bytes={}-{}", current_offset, end));
            }

            let res = match req.send().await {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("[Downex Worker] Connect error: {}", e);
                    is_active_atomic.store(false, Ordering::Relaxed);
                    tokio::time::sleep(Duration::from_millis(1000)).await;
                    continue;
                }
            };

            let status = res.status();
            if !status.is_success() && status != reqwest::StatusCode::PARTIAL_CONTENT {
                eprintln!("[Downex Worker] Server returned HTTP {}: retrying...", status);
                is_active_atomic.store(false, Ordering::Relaxed);
                tokio::time::sleep(Duration::from_millis(1000)).await;
                continue;
            }

            // HTTP Range verification: If server returned 200 OK instead of 206 Partial Content,
            // stream starts from byte 0. Otherwise it aligns with current_offset.
            let mut write_pos = if status == reqwest::StatusCode::OK && current_offset > 0 {
                0
            } else {
                current_offset
            };

            let mut stream = res.bytes_stream();
            let mut mem_buffer = Vec::with_capacity(256 * 1024);
            let mut mem_buf_start = write_pos;

            while let Some(chunk_res) = stream.next().await {
                if cancel_token.is_cancelled() {
                    if !mem_buffer.is_empty() {
                        let _ = writer.write_at(mem_buf_start, &mem_buffer);
                    }
                    is_active_atomic.store(false, Ordering::Relaxed);
                    return;
                }

                match chunk_res {
                    Ok(chunk) => {
                        let len = chunk.len() as u64;
                        let target_end = end_atomic.load(Ordering::Relaxed);

                        // If dynamic work-stealing truncated our segment, don't write past target_end
                        if target_end > 0 && write_pos > target_end {
                            break;
                        }

                        let write_len = if target_end > 0 && write_pos + len > target_end {
                            (target_end + 1).saturating_sub(write_pos).min(len)
                        } else {
                            len
                        };

                        if write_len > 0 {
                            mem_buffer.extend_from_slice(&chunk[..write_len as usize]);
                            write_pos += write_len;
                            downloaded_atomic.fetch_add(write_len, Ordering::Relaxed);

                            // Flush buffer when threshold reached (256 KB memory chunks, matching IDM high-speed buffer)
                            if mem_buffer.len() >= 256 * 1024 {
                                if let Err(e) = writer.write_at(mem_buf_start, &mem_buffer) {
                                    eprintln!("[Downex Writer] Positional write error: {}", e);
                                    mem_buffer.clear();
                                    break;
                                }
                                mem_buf_start = write_pos;
                                mem_buffer.clear();
                            }
                        }

                        if target_end > 0 && write_pos > target_end {
                            break;
                        }
                    }
                    Err(e) => {
                        eprintln!("[Downex Stream] Read error: {}", e);
                        break;
                    }
                }
            }

            // Flush any remaining buffered bytes at end of stream
            if !mem_buffer.is_empty() {
                if let Err(e) = writer.write_at(mem_buf_start, &mem_buffer) {
                    eprintln!("[Downex Writer] Final flush error: {}", e);
                }
            }

            is_active_atomic.store(false, Ordering::Relaxed);

            // Attempt dynamic work stealing if more work remains
            if supports_ranges {
                if let Some(new_idx) = Self::try_steal_work(&segments).await {
                    segment_idx = new_idx;
                    continue;
                }
            }
            break;
        }
    }

    /// Work-stealing algorithm researched from IDM:
    /// Finds the active connection with the largest remaining byte distance,
    /// splits it in half atomically, and returns the new segment index.
    async fn try_steal_work(segments: &Arc<RwLock<Vec<ActiveSegment>>>) -> Option<u32> {
        let mut segs = segments.write().await;
        let mut max_remaining = 0u64;
        let mut target_seg_idx = None;

        for (i, s) in segs.iter().enumerate() {
            let end_val = s.range_end.load(Ordering::Relaxed);
            if s.is_active.load(Ordering::Relaxed) && end_val > s.range_start {
                let downloaded = s.downloaded.load(Ordering::Relaxed);
                let current_pos = s.range_start + downloaded;
                if end_val > current_pos {
                    let remaining = end_val - current_pos;
                    if remaining > max_remaining && remaining >= MIN_SPLIT_THRESHOLD_BYTES {
                        max_remaining = remaining;
                        target_seg_idx = Some(i);
                    }
                }
            }
        }

        if let Some(target_idx) = target_seg_idx {
            let target = &mut segs[target_idx];
            let current_pos = target.range_start + target.downloaded.load(Ordering::Relaxed);
            let target_end = target.range_end.load(Ordering::Relaxed);
            let half = (target_end - current_pos) / 2;
            let split_point = current_pos + half;

            let old_end = target_end;
            target.range_end.store(split_point, Ordering::SeqCst);

            let new_index = segs.len() as u32;
            segs.push(ActiveSegment {
                index: new_index,
                range_start: split_point + 1,
                range_end: Arc::new(AtomicU64::new(old_end)),
                downloaded: Arc::new(AtomicU64::new(0)),
                is_active: Arc::new(AtomicBool::new(false)),
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
                range_end: s.range_end.load(Ordering::Relaxed),
                downloaded: s.downloaded.load(Ordering::Relaxed),
                status: if s.is_active.load(Ordering::Relaxed) {
                    "downloading".to_string()
                } else {
                    "idle".to_string()
                },
            });
        }
        let _ = self.db.save_segments(task_id, &records);
    }
}
