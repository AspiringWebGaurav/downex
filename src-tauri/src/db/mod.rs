pub mod schema;

use parking_lot::Mutex;
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadRecord {
    pub id: String,
    pub url: String,
    pub filename: String,
    pub destination_path: String,
    pub total_bytes: Option<u64>,
    pub downloaded_bytes: u64,
    pub status: String,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub headers_json: Option<String>,
    pub queue_id: String,
    pub speed_bytes_sec: u64,
    pub error_message: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentRecord {
    pub id: Option<i64>,
    pub download_id: String,
    pub segment_index: u32,
    pub range_start: u64,
    pub range_end: u64,
    pub downloaded: u64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueRecord {
    pub id: String,
    pub name: String,
    pub max_concurrent_tasks: u32,
    pub is_active: bool,
    pub start_time: Option<String>,
    pub stop_time: Option<String>,
}

#[derive(Clone)]
pub struct DatabaseManager {
    conn: Arc<Mutex<Connection>>,
    #[allow(dead_code)]
    db_path: PathBuf,
}

impl DatabaseManager {
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self> {
        let db_path = path.as_ref().to_path_buf();
        if let Some(parent) = db_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let conn = Connection::open(&db_path)?;

        // Performance pragmas for high-throughput concurrent I/O
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA temp_store = MEMORY;",
        )?;

        conn.execute_batch(schema::CREATE_TABLES_SQL)?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            db_path,
        })
    }

    pub fn insert_download(&self, record: &DownloadRecord) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO downloads (
                id, url, filename, destination_path, total_bytes, downloaded_bytes,
                status, etag, last_modified, headers_json, queue_id, speed_bytes_sec,
                error_message, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                record.id,
                record.url,
                record.filename,
                record.destination_path,
                record.total_bytes.map(|v| v as i64),
                record.downloaded_bytes as i64,
                record.status,
                record.etag,
                record.last_modified,
                record.headers_json,
                record.queue_id,
                record.speed_bytes_sec as i64,
                record.error_message,
                record.created_at,
                record.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn update_download_status(&self, id: &str, status: &str, speed: u64, error: Option<&str>) -> Result<()> {
        let conn = self.conn.lock();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE downloads SET status = ?1, speed_bytes_sec = ?2, error_message = ?3, updated_at = ?4 WHERE id = ?5",
            params![status, speed as i64, error, now, id],
        )?;
        Ok(())
    }

    pub fn update_download_progress(&self, id: &str, downloaded_bytes: u64, speed_bytes_sec: u64) -> Result<()> {
        let conn = self.conn.lock();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE downloads SET downloaded_bytes = ?1, speed_bytes_sec = ?2, updated_at = ?3 WHERE id = ?4",
            params![downloaded_bytes as i64, speed_bytes_sec as i64, now, id],
        )?;
        Ok(())
    }

    pub fn get_all_downloads(&self) -> Result<Vec<DownloadRecord>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, url, filename, destination_path, total_bytes, downloaded_bytes,
                    status, etag, last_modified, headers_json, queue_id, speed_bytes_sec,
                    error_message, created_at, updated_at
             FROM downloads ORDER BY created_at DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            let total_bytes: Option<i64> = row.get(4)?;
            let downloaded_bytes: i64 = row.get(5)?;
            let speed: i64 = row.get(11)?;
            Ok(DownloadRecord {
                id: row.get(0)?,
                url: row.get(1)?,
                filename: row.get(2)?,
                destination_path: row.get(3)?,
                total_bytes: total_bytes.map(|v| v as u64),
                downloaded_bytes: downloaded_bytes as u64,
                status: row.get(6)?,
                etag: row.get(7)?,
                last_modified: row.get(8)?,
                headers_json: row.get(9)?,
                queue_id: row.get(10)?,
                speed_bytes_sec: speed as u64,
                error_message: row.get(12)?,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn get_queued_downloads(&self) -> Result<Vec<DownloadRecord>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, url, filename, destination_path, total_bytes, downloaded_bytes,
                    status, etag, last_modified, headers_json, queue_id, speed_bytes_sec,
                    error_message, created_at, updated_at
             FROM downloads WHERE status = 'queued' ORDER BY created_at ASC",
        )?;

        let rows = stmt.query_map([], |row| {
            let total_bytes: Option<i64> = row.get(4)?;
            let downloaded_bytes: i64 = row.get(5)?;
            let speed: i64 = row.get(11)?;
            Ok(DownloadRecord {
                id: row.get(0)?,
                url: row.get(1)?,
                filename: row.get(2)?,
                destination_path: row.get(3)?,
                total_bytes: total_bytes.map(|v| v as u64),
                downloaded_bytes: downloaded_bytes as u64,
                status: row.get(6)?,
                etag: row.get(7)?,
                last_modified: row.get(8)?,
                headers_json: row.get(9)?,
                queue_id: row.get(10)?,
                speed_bytes_sec: speed as u64,
                error_message: row.get(12)?,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn get_download(&self, id: &str) -> Result<Option<DownloadRecord>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, url, filename, destination_path, total_bytes, downloaded_bytes,
                    status, etag, last_modified, headers_json, queue_id, speed_bytes_sec,
                    error_message, created_at, updated_at
             FROM downloads WHERE id = ?1",
        )?;

        let mut rows = stmt.query_map(params![id], |row| {
            let speed: i64 = row.get(11)?;
            Ok(DownloadRecord {
                id: row.get(0)?,
                url: row.get(1)?,
                filename: row.get(2)?,
                destination_path: row.get(3)?,
                total_bytes: row.get(4)?,
                downloaded_bytes: row.get(5)?,
                status: row.get(6)?,
                etag: row.get(7)?,
                last_modified: row.get(8)?,
                headers_json: row.get(9)?,
                queue_id: row.get(10)?,
                speed_bytes_sec: speed as u64,
                error_message: row.get(12)?,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
            })
        })?;

        if let Some(first) = rows.next() {
            Ok(Some(first?))
        } else {
            Ok(None)
        }
    }

    pub fn update_download_destination(&self, id: &str, new_dest_path: &str) -> Result<()> {
        let conn = self.conn.lock();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE downloads SET destination_path = ?1, status = 'queued', error_message = NULL, updated_at = ?2 WHERE id = ?3",
            params![new_dest_path, now, id],
        )?;
        Ok(())
    }

    pub fn delete_download(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM downloads WHERE id = ?1", params![id])?;
        conn.execute("DELETE FROM segments WHERE download_id = ?1", params![id])?;
        Ok(())
    }

    pub fn save_segments(&self, download_id: &str, segments: &[SegmentRecord]) -> Result<()> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM segments WHERE download_id = ?1", params![download_id])?;

        for seg in segments {
            tx.execute(
                "INSERT INTO segments (download_id, segment_index, range_start, range_end, downloaded, status)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    seg.download_id,
                    seg.segment_index,
                    seg.range_start as i64,
                    seg.range_end as i64,
                    seg.downloaded as i64,
                    seg.status,
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn get_segments(&self, download_id: &str) -> Result<Vec<SegmentRecord>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, download_id, segment_index, range_start, range_end, downloaded, status
             FROM segments WHERE download_id = ?1 ORDER BY segment_index ASC",
        )?;

        let rows = stmt.query_map(params![download_id], |row| {
            let start: i64 = row.get(3)?;
            let end: i64 = row.get(4)?;
            let downloaded: i64 = row.get(5)?;
            Ok(SegmentRecord {
                id: Some(row.get(0)?),
                download_id: row.get(1)?,
                segment_index: row.get(2)?,
                range_start: start as u64,
                range_end: end as u64,
                downloaded: downloaded as u64,
                status: row.get(6)?,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    /// Reconciles interrupted tasks on application startup
    pub fn recover_interrupted_tasks(&self) -> Result<()> {
        let conn = self.conn.lock();
        // Any task left in "downloading" or "probing" is safely transitioned to "paused"
        conn.execute(
            "UPDATE downloads SET status = 'paused', speed_bytes_sec = 0 WHERE status IN ('downloading', 'probing')",
            [],
        )?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT value FROM app_settings WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            let val: String = row.get(0)?;
            Ok(Some(val))
        } else {
            Ok(None)
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, now],
        )?;
        Ok(())
    }
}

