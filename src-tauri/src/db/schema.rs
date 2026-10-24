pub const CREATE_TABLES_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS downloads (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    filename TEXT NOT NULL,
    destination_path TEXT NOT NULL,
    total_bytes INTEGER,
    downloaded_bytes INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    etag TEXT,
    last_modified TEXT,
    headers_json TEXT,
    queue_id TEXT NOT NULL DEFAULT 'default',
    speed_bytes_sec INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    download_id TEXT NOT NULL,
    segment_index INTEGER NOT NULL,
    range_start INTEGER NOT NULL,
    range_end INTEGER NOT NULL,
    downloaded INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    FOREIGN KEY(download_id) REFERENCES downloads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_segments_download_id ON segments(download_id);

CREATE TABLE IF NOT EXISTS queues (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    max_concurrent_tasks INTEGER NOT NULL DEFAULT 3,
    is_active INTEGER NOT NULL DEFAULT 1,
    start_time TEXT,
    stop_time TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Default Queue
INSERT OR IGNORE INTO queues (id, name, max_concurrent_tasks, is_active)
VALUES ('default', 'Main Download Queue', 3, 1);
"#;
