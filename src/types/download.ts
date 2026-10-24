export interface SegmentSnapshot {
  index: u32;
  start: number;
  end: number;
  downloaded: number;
  speed_bytes_sec: number;
  is_active: boolean;
}

export type u32 = number;

export interface DownloadItem {
  id: string;
  url: string;
  filename: string;
  destination_path: string;
  total_bytes: number | null;
  downloaded_bytes: number;
  status: 'queued' | 'probing' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'error';
  etag?: string | null;
  last_modified?: string | null;
  headers_json?: string | null;
  queue_id: string;
  speed_bytes_sec: number;
  eta_seconds?: number | null;
  error_message?: string | null;
  created_at: number;
  updated_at: number;
  segments?: SegmentSnapshot[];
}

export interface DownloadProgressEvent {
  task_id: string;
  status: string;
  downloaded_bytes: number;
  total_bytes: number | null;
  speed_bytes_sec: number;
  eta_seconds?: number | null;
  segments: SegmentSnapshot[];
}

export interface ReleaseManifest {
  version: string;
  notes?: string;
  pub_date?: string;
  url?: string;
  size?: number;
}
