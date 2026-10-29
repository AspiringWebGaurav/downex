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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatchNoteRecord {
    pub version: String,
    pub title: String,
    pub release_date: String,
    pub highlights_json: String,
    pub raw_notes: Option<String>,
    #[serde(default)]
    pub is_custom: bool,
    pub updated_at: i64,
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
            "PRAGMA journal_mode = WAL;
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

        for migration in schema::MIGRATIONS {
            if migration.version > current_version {
                eprintln!(
                    "[Downex DB] Applying migration v{}: {}",
                    migration.version, migration.description
                );

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
                } else {
                    tx.execute_batch(migration.sql)?;
                }
                tx.execute_batch(&format!("PRAGMA user_version = {};", migration.version))?;
                tx.commit()?;
                eprintln!("[Downex DB] Successfully applied migration v{}", migration.version);
            }
        }

        Ok(())
    }

    pub fn insert_download(&self, record: &DownloadRecord) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO downloads (
                id, url, filename, destination_path, total_bytes, downloaded_bytes,
                status, etag, last_modified, headers_json, queue_id, speed_bytes_sec,
                error_message, checksum, media_type, supports_ranges, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
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
                    error_message, checksum, media_type, supports_ranges, created_at, updated_at
             FROM downloads ORDER BY created_at DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            let total_bytes: Option<i64> = row.get(4)?;
            let downloaded_bytes: i64 = row.get(5)?;
            let speed: i64 = row.get(11)?;
            let supports_ranges: i64 = row.get(15).unwrap_or(1);
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
                checksum: row.get(13)?,
                media_type: row.get(14)?,
                supports_ranges: supports_ranges != 0,
                created_at: row.get(16)?,
                updated_at: row.get(17)?,
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
                    error_message, checksum, media_type, supports_ranges, created_at, updated_at
             FROM downloads WHERE status = 'queued' ORDER BY created_at ASC",
        )?;

        let rows = stmt.query_map([], |row| {
            let total_bytes: Option<i64> = row.get(4)?;
            let downloaded_bytes: i64 = row.get(5)?;
            let speed: i64 = row.get(11)?;
            let supports_ranges: i64 = row.get(15).unwrap_or(1);
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
                checksum: row.get(13)?,
                media_type: row.get(14)?,
                supports_ranges: supports_ranges != 0,
                created_at: row.get(16)?,
                updated_at: row.get(17)?,
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
                    error_message, checksum, media_type, supports_ranges, created_at, updated_at
             FROM downloads WHERE id = ?1",
        )?;

        let mut rows = stmt.query_map(params![id], |row| {
            let speed: i64 = row.get(11)?;
            let supports_ranges: i64 = row.get(15).unwrap_or(1);
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
                checksum: row.get(13)?,
                media_type: row.get(14)?,
                supports_ranges: supports_ranges != 0,
                created_at: row.get(16)?,
                updated_at: row.get(17)?,
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

    pub fn get_all_patch_notes(&self) -> Result<Vec<PatchNoteRecord>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT version, title, release_date, highlights_json, raw_notes, is_custom, updated_at
             FROM patch_notes ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            let is_custom_int: i32 = row.get(5)?;
            Ok(PatchNoteRecord {
                version: row.get(0)?,
                title: row.get(1)?,
                release_date: row.get(2)?,
                highlights_json: row.get(3)?,
                raw_notes: row.get(4)?,
                is_custom: is_custom_int != 0,
                updated_at: row.get(6)?,
            })
        })?;
        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn save_patch_note(&self, note: &PatchNoteRecord) -> Result<()> {
        let conn = self.conn.lock();
        let now = if note.updated_at > 0 { note.updated_at } else { chrono::Utc::now().timestamp_millis() };
        let is_custom_int = if note.is_custom { 1 } else { 0 };
        conn.execute(
            "INSERT INTO patch_notes (version, title, release_date, highlights_json, raw_notes, is_custom, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(version) DO UPDATE SET
                title = excluded.title,
                release_date = excluded.release_date,
                highlights_json = excluded.highlights_json,
                raw_notes = excluded.raw_notes,
                is_custom = excluded.is_custom,
                updated_at = excluded.updated_at",
            params![
                note.version,
                note.title,
                note.release_date,
                note.highlights_json,
                note.raw_notes,
                is_custom_int,
                now,
            ],
        )?;
        Ok(())
    }

    pub fn delete_patch_note(&self, version: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM patch_notes WHERE version = ?1", params![version])?;
        Ok(())
    }
}
