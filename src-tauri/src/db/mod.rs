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
    #[serde(default)]
    pub checksum: Option<String>,
    #[serde(default)]
    pub media_type: Option<String>,
    #[serde(default = "default_supports_ranges")]
    pub supports_ranges: bool,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub speed_limit_mbps: Option<f64>,
    #[serde(default)]
    pub staging_path: Option<String>,
}

const DOWNLOAD_SELECT_COLUMNS: &str = "id, url, filename, destination_path, total_bytes, downloaded_bytes,
                    status, etag, last_modified, headers_json, queue_id, speed_bytes_sec,
                    error_message, checksum, media_type, supports_ranges, created_at, updated_at,
                    speed_limit_mbps, staging_path";

fn map_download_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DownloadRecord> {
    let total_bytes: Option<i64> = row.get(4)?;
    let downloaded_bytes: i64 = row.get(5)?;
    let speed: i64 = row.get(11)?;
    let supports_ranges: i64 = row.get(15).unwrap_or(1);
    Ok(DownloadRecord {
        id: row.get(0)?,
        url: row.get(1)?,
        filename: row.get(2)?,
        destination_path: row.get(3)?,
        total_bytes: total_bytes.map(|v| v.max(0) as u64),
        downloaded_bytes: downloaded_bytes.max(0) as u64,
        status: row.get(6)?,
        etag: row.get(7)?,
        last_modified: row.get(8)?,
        headers_json: row.get(9)?,
        queue_id: row.get(10)?,
        speed_bytes_sec: speed.max(0) as u64,
        error_message: row.get(12)?,
        checksum: row.get(13)?,
        media_type: row.get(14)?,
        supports_ranges: supports_ranges != 0,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
        speed_limit_mbps: row.get(18).ok().flatten(),
        staging_path: row.get(19).ok().flatten(),
    })
}

fn default_supports_ranges() -> bool {
    true
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

        let mut conn = Connection::open(&db_path)?;

        // Performance pragmas for high-throughput concurrent I/O
        conn.execute_batch(
            "PRAGMA busy_timeout = 5000;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA temp_store = MEMORY;",
        )?;

        Self::apply_migrations(&mut conn)?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            db_path,
        })
    }

    fn has_column(conn: &Connection, table: &str, column: &str) -> bool {
        let mut stmt = match conn.prepare(&format!("PRAGMA table_info({})", table)) {
            Ok(s) => s,
            Err(_) => return false,
        };
        let names: Vec<String> = stmt
            .query_map([], |row| row.get(1))
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();
        names.iter().any(|n| n.eq_ignore_ascii_case(column))
    }

    fn apply_migrations(conn: &mut Connection) -> Result<()> {
        let current_version: i32 = conn
            .query_row("PRAGMA user_version;", [], |row| row.get(0))
            .unwrap_or(0);

        let mut applied_count = 0;
        let mut last_version = current_version;

        for migration in schema::MIGRATIONS {
            if migration.version > current_version {
                applied_count += 1;
                last_version = migration.version;

                let tx = conn.transaction()?;
                if migration.version == 2 {
                    if !Self::has_column(&tx, "downloads", "checksum") {
                        let _ = tx.execute("ALTER TABLE downloads ADD COLUMN checksum TEXT;", []);
                    }
                    if !Self::has_column(&tx, "downloads", "media_type") {
                        let _ = tx.execute("ALTER TABLE downloads ADD COLUMN media_type TEXT;", []);
                    }
                } else if migration.version == 3 {
                    if !Self::has_column(&tx, "downloads", "supports_ranges") {
                        let _ = tx.execute("ALTER TABLE downloads ADD COLUMN supports_ranges INTEGER NOT NULL DEFAULT 1;", []);
                    }
                } else if migration.version == 5 {
                    if !Self::has_column(&tx, "downloads", "speed_limit_mbps") {
                        let _ = tx.execute("ALTER TABLE downloads ADD COLUMN speed_limit_mbps REAL;", []);
                    }
                } else if migration.version == 6 {
                    if !Self::has_column(&tx, "downloads", "staging_path") {
                        let _ = tx.execute("ALTER TABLE downloads ADD COLUMN staging_path TEXT;", []);
                    }
                } else {
                    tx.execute_batch(migration.sql)?;
                }
                tx.execute_batch(&format!("PRAGMA user_version = {};", migration.version))?;
                tx.commit()?;
            }
        }

        if applied_count > 0 {
            eprintln!("[Downex DB] Initialized schema v{}", last_version);
        }

        Ok(())
    }

    pub fn insert_download(&self, record: &DownloadRecord) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO downloads (
                id, url, filename, destination_path, total_bytes, downloaded_bytes,
                status, etag, last_modified, headers_json, queue_id, speed_bytes_sec,
                error_message, checksum, media_type, supports_ranges, created_at, updated_at,
                speed_limit_mbps, staging_path
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
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
                record.checksum,
                record.media_type,
                if record.supports_ranges { 1 } else { 0 },
                record.created_at,
                record.updated_at,
                record.speed_limit_mbps,
                record.staging_path,
            ],
        )?;
        Ok(())
    }

        pub fn update_download_speed_limit(&self, id: &str, limit_mbps: Option<f64>) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE downloads SET speed_limit_mbps = ?1 WHERE id = ?2",
            params![limit_mbps, id],
        )?;
        Ok(())
    }

    pub fn update_download_supports_ranges(&self, id: &str, supports_ranges: bool) -> Result<()> {
        let conn = self.conn.lock();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE downloads SET supports_ranges = ?1, updated_at = ?2 WHERE id = ?3",
            params![if supports_ranges { 1 } else { 0 }, now, id],
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

    pub fn update_download_queue_id(&self, id: &str, queue_id: &str) -> Result<()> {
        let conn = self.conn.lock();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE downloads SET queue_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![queue_id, now, id],
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

    pub fn get_download_stats(&self) -> Result<(usize, usize, usize, u64)> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT
                COALESCE(SUM(CASE WHEN status IN ('downloading', 'probing') THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN status IN ('paused', 'queued', 'failed', 'error') THEN 1 ELSE 0 END), 0),
                COUNT(*),
                COALESCE(SUM(CASE WHEN status = 'downloading' AND speed_bytes_sec > 0 THEN speed_bytes_sec ELSE 0 END), 0)
             FROM downloads",
        )?;
        stmt.query_row([], |row| {
            let active: i64 = row.get(0)?;
            let paused: i64 = row.get(1)?;
            let total: i64 = row.get(2)?;
            let speed: i64 = row.get(3)?;
            Ok((
                active.max(0) as usize,
                paused.max(0) as usize,
                total.max(0) as usize,
                speed.max(0) as u64,
            ))
        })
    }

    pub fn get_all_downloads(&self) -> Result<Vec<DownloadRecord>> {
        let conn = self.conn.lock();
        let sql = format!("SELECT {} FROM downloads ORDER BY created_at DESC", DOWNLOAD_SELECT_COLUMNS);
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], map_download_row)?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn get_queued_downloads(&self) -> Result<Vec<DownloadRecord>> {
        let conn = self.conn.lock();
        let sql = format!("SELECT {} FROM downloads WHERE status = 'queued' ORDER BY created_at ASC", DOWNLOAD_SELECT_COLUMNS);
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], map_download_row)?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn get_download(&self, id: &str) -> Result<Option<DownloadRecord>> {
        let conn = self.conn.lock();
        let sql = format!("SELECT {} FROM downloads WHERE id = ?1", DOWNLOAD_SELECT_COLUMNS);
        let mut stmt = conn.prepare(&sql)?;
        let mut rows = stmt.query_map(params![id], map_download_row)?;

        if let Some(first) = rows.next() {
            Ok(Some(first?))
        } else {
            Ok(None)
        }
    }

    pub fn update_download_staging_path(&self, id: &str, staging_path: Option<&str>) -> Result<()> {
        let conn = self.conn.lock();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE downloads SET staging_path = ?1, updated_at = ?2 WHERE id = ?3",
            params![staging_path, now, id],
        )?;
        Ok(())
    }

    pub fn update_download_finalized_target(
        &self,
        id: &str,
        final_dest_path: &str,
        final_filename: &str,
    ) -> Result<()> {
        let conn = self.conn.lock();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE downloads SET destination_path = ?1, filename = ?2, staging_path = NULL, updated_at = ?3 WHERE id = ?4",
            params![final_dest_path, final_filename, now, id],
        )?;
        Ok(())
    }

    pub fn update_download_destination_and_staging(
        &self,
        id: &str,
        new_dest_path: &str,
        new_staging_path: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE downloads SET destination_path = ?1, staging_path = ?2, status = 'queued', error_message = NULL, updated_at = ?3 WHERE id = ?4",
            params![new_dest_path, new_staging_path, now, id],
        )?;
        Ok(())
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
            let db_end: i64 = if seg.range_end == u64::MAX { -1 } else { seg.range_end as i64 };
            tx.execute(
                "INSERT INTO segments (download_id, segment_index, range_start, range_end, downloaded, status)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    seg.download_id,
                    seg.segment_index,
                    seg.range_start as i64,
                    db_end,
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
                range_start: start.max(0) as u64,
                range_end: if end < 0 { u64::MAX } else { end as u64 },
                downloaded: downloaded.max(0) as u64,
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

    pub fn delete_setting(&self, key: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM app_settings WHERE key = ?1", params![key])?;
        Ok(())
    }

    pub fn get_or_create_installation_id(&self) -> String {
        if let Ok(Some(id)) = self.get_setting("installation_id") {
            let trimmed = id.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
        let new_id = format!("dwnx-{}", uuid::Uuid::new_v4());
        let _ = self.set_setting("installation_id", &new_id);
        new_id
    }

    pub fn get_lifetime_downloaded_bytes(&self) -> Result<u64> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT value FROM app_settings WHERE key = 'lifetime_downloaded_bytes'")?;
        let mut rows = stmt.query([])?;
        if let Some(row) = rows.next()? {
            let val: String = row.get(0)?;
            if let Ok(b) = val.parse::<u64>() {
                return Ok(b);
            }
        }

        // Fallback seed: Sum existing downloads if lifetime metric has not been initialized
        let mut sum_stmt = conn.prepare("SELECT COALESCE(SUM(downloaded_bytes), 0) FROM downloads")?;
        let sum: i64 = sum_stmt.query_row([], |r| r.get(0)).unwrap_or(0);
        let bytes = if sum > 0 { sum as u64 } else { 0 };

        let now = chrono::Utc::now().timestamp_millis();
        let _ = conn.execute(
            "INSERT INTO app_settings (key, value, updated_at) VALUES ('lifetime_downloaded_bytes', ?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![bytes.to_string(), now],
        );

        Ok(bytes)
    }

    pub fn set_lifetime_downloaded_bytes(&self, bytes: u64) -> Result<()> {
        let conn = self.conn.lock();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO app_settings (key, value, updated_at) VALUES ('lifetime_downloaded_bytes', ?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![bytes.to_string(), now],
        )?;
        Ok(())
    }


}
