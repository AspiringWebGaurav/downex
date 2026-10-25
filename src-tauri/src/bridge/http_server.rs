use crate::db::DatabaseManager;
use crate::scheduler::QueueManager;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;


#[derive(Debug, Deserialize, Serialize)]
pub struct ExtensionDownloadRequest {
    pub url: String,
    pub filename: Option<String>,
    pub cookies: Option<String>,
    pub referer: Option<String>,
    pub user_agent: Option<String>,
    pub destination_folder: Option<String>,
    pub queue_id: Option<String>,
    pub download_later: Option<bool>,
    pub show_dialog: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ExtensionProbeRequest {
    pub url: String,
    pub cookies: Option<String>,
    pub referer: Option<String>,
    pub user_agent: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ExtensionAdaptiveRequest {
    pub title: String,
    pub video_url: String,
    pub audio_url: Option<String>,
    pub cookies: Option<String>,
    pub referer: Option<String>,
    pub user_agent: Option<String>,
    pub extension: Option<String>,
    pub download_later: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

pub struct ExtensionHttpBridge {
    app_handle: Option<tauri::AppHandle>,
    queue_manager: Arc<QueueManager>,
    db: DatabaseManager,
    port: u16,
    auth_token: String,
}

fn is_allowed_origin(origin: &str) -> bool {
    let o = origin.trim();
    o.starts_with("chrome-extension://")
        || o.starts_with("moz-extension://")
        || o.starts_with("edge-extension://")
        || o == "tauri://localhost"
        || o == "http://localhost:1420"
        || o == "http://127.0.0.1:1420"
        || o == "null"
}

fn sanitize_destination_folder(folder: Option<String>, default_dir: &str, show_dialog: bool) -> Result<String, String> {
    if !show_dialog {
        // Silent automated download: enforce default downloads directory
        return Ok(default_dir.to_string());
    }

    let raw = match folder {
        Some(f) if !f.trim().is_empty() => f.trim().to_string(),
        _ => return Ok(default_dir.to_string()),
    };

    if raw.contains("..") || raw.starts_with('.') {
        return Err("Path traversal detected in destination folder".to_string());
    }

    let p = std::path::Path::new(&raw);
    if !p.is_absolute() {
        return Err("Destination folder must be an absolute path".to_string());
    }

    let lower = raw.to_lowercase();
    if lower.contains("\\windows\\") || lower.ends_with("\\windows")
        || lower.contains("\\system32")
        || lower.contains("\\start menu\\programs\\startup")
        || lower.contains("\\startup")
    {
        return Err("Writing to system-critical directories via bridge is forbidden".to_string());
    }

    Ok(raw)
}

impl ExtensionHttpBridge {
    pub fn new(
        app_handle: Option<tauri::AppHandle>,
        queue_manager: Arc<QueueManager>,
        db: DatabaseManager,
        port: u16,
        auth_token: String,
    ) -> Self {
        Self {
            app_handle,
            queue_manager,
            db,
            port,
            auth_token,
        }
    }

    pub fn start(self: Arc<Self>) {
        tauri::async_runtime::spawn(async move {
            let addr = format!("127.0.0.1:{}", self.port);
            let listener = match TcpListener::bind(&addr).await {
                Ok(l) => {
                    println!("[Downex Extension Bridge] Listening on http://{}", addr);
                    l
                }
                Err(err) => {
                    eprintln!("[Downex Extension Bridge] Failed to bind {}: {}", addr, err);
                    return;
                }
            };

            loop {
                match listener.accept().await {
                    Ok((mut socket, _)) => {
                        let bridge = self.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Err(e) = bridge.handle_connection(&mut socket).await {
                                eprintln!("[Downex Bridge] Connection error: {}", e);
                            }
                        });
                    }
                    Err(e) => {
                        eprintln!("[Downex Bridge] Accept error: {}", e);
                    }
                }
            }
        });
    }

    async fn handle_connection(
        &self,
        socket: &mut tokio::net::TcpStream,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut buffer = vec![0u8; 8192];
        let mut bytes_read = 0;

        // Read until \r\n\r\n or buffer limit
        let mut header_end = None;
        while bytes_read < buffer.len() {
            let n = socket.read(&mut buffer[bytes_read..]).await?;
            if n == 0 {
                return Ok(());
            }
            bytes_read += n;

            if let Some(pos) = buffer[..bytes_read]
                .windows(4)
                .position(|w| w == b"\r\n\r\n")
            {
                header_end = Some(pos);
                break;
            }
        }

        let header_pos = match header_end {
            Some(p) => p,
            None => return Ok(()),
        };

        let header_str = String::from_utf8_lossy(&buffer[..header_pos]);
        let mut lines = header_str.lines();
        let request_line = match lines.next() {
            Some(l) => l,
            None => return Ok(()),
        };

        let mut parts = request_line.split_whitespace();
        let method = parts.next().unwrap_or("GET");
        let path = parts.next().unwrap_or("/");

        // Parse content-length, origin, and authorization headers
        let mut content_length = 0usize;
        let mut origin_header: Option<String> = None;
        let mut auth_header: Option<String> = None;

        for line in lines {
            let lower = line.to_lowercase();
            if lower.starts_with("content-length:") {
                if let Some(val) = line.split(':').nth(1) {
                    content_length = val.trim().parse().unwrap_or(0);
                }
            } else if lower.starts_with("origin:") {
                if let Some(val) = line.splitn(2, ':').nth(1) {
                    origin_header = Some(val.trim().to_string());
                }
            } else if lower.starts_with("authorization:") {
                if let Some(val) = line.splitn(2, ':').nth(1) {
                    auth_header = Some(val.trim().to_string());
                }
            } else if lower.starts_with("x-downex-token:") {
                if let Some(val) = line.splitn(2, ':').nth(1) {
                    auth_header = Some(val.trim().to_string());
                }
            }
        }

        // Strict Cross-Origin Security Check: Block untrusted web domains (CSRF Shield)
        if let Some(ref origin) = origin_header {
            if !is_allowed_origin(origin) {
                eprintln!("[Downex Security] Blocked untrusted cross-origin request from: {}", origin);
                let response = "HTTP/1.1 403 Forbidden\r\n\
Content-Type: application/json; charset=utf-8\r\n\
Connection: close\r\n\r\n\
{\"success\":false,\"error\":\"Cross-origin request from untrusted origin blocked\"}";
                socket.write_all(response.as_bytes()).await?;
                return Ok(());
            }
        }

        let allow_origin = origin_header.as_deref().unwrap_or("tauri://localhost");

        // Handle CORS preflight
        if method == "OPTIONS" {
            let response = format!(
                "HTTP/1.1 204 No Content\r\n\
Access-Control-Allow-Origin: {}\r\n\
Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-Downex-Token\r\n\
Access-Control-Max-Age: 86400\r\n\
Content-Length: 0\r\n\r\n",
                allow_origin
            );
            socket.write_all(response.as_bytes()).await?;
            return Ok(());
        }

        // Read remaining body if Content-Length > 0
        let body_start = header_pos + 4;
        let _body_already_read = bytes_read - body_start;
        let mut body_bytes = buffer[body_start..bytes_read].to_vec();

        while body_bytes.len() < content_length {
            let mut chunk = vec![0u8; (content_length - body_bytes.len()).min(8192)];
            let n = socket.read(&mut chunk).await?;
            if n == 0 {
                break;
            }
            body_bytes.extend_from_slice(&chunk[..n]);
        }

        let body_str = String::from_utf8_lossy(&body_bytes);

        // Verified Extension Origin: requests originating from installed browser extensions
        let is_extension_origin = if let Some(ref origin) = origin_header {
            let o = origin.trim();
            o.starts_with("chrome-extension://")
                || o.starts_with("moz-extension://")
                || o.starts_with("edge-extension://")
        } else {
            false
        };

        let is_authorized = if is_extension_origin {
            // Verified browser extensions running on the local host are trusted
            true
        } else if let Some(ref auth) = auth_header {
            let token = auth.strip_prefix("Bearer ").unwrap_or(auth).trim();
            token == self.auth_token
        } else {
            false
        };

        let default_dir = if let Ok(u) = std::env::var("USERPROFILE") {
            format!("{}\\Downloads\\Downex", u)
        } else {
            "Downloads".to_string()
        };

        // Routing
        let (status_code, response_json) = match (method, path) {
            ("GET", "/api/ping") => (
                200,
                serde_json::json!({
                    "success": true,
                    "data": {
                        "app": "Downex",
                        "version": env!("CARGO_PKG_VERSION"),
                        "status": "ready"
                    }
                }),
            ),
            ("GET", "/api/handshake") => (
                200,
                serde_json::json!({
                    "success": true,
                    "token": self.auth_token,
                    "data": {
                        "token": self.auth_token,
                        "version": env!("CARGO_PKG_VERSION")
                    }
                }),
            ),
            ("GET", "/api/status") if !is_authorized => (
                401,
                serde_json::json!({
                    "success": false,
                    "error": "Unauthorized: valid Downex bridge authentication token required"
                }),
            ),
            ("GET", "/api/status") => {
                let downloads = self.db.get_all_downloads().unwrap_or_default();
                let active_count = downloads
                    .iter()
                    .filter(|d| d.status == "downloading" || d.status == "probing")
                    .count();
                let total_count = downloads.len();
                let total_speed: u64 = downloads
                    .iter()
                    .filter(|d| d.status == "downloading")
                    .map(|d| d.speed_bytes_sec as u64)
                    .sum();
                (
                    200,
                    serde_json::json!({
                        "success": true,
                        "data": {
                            "active_count": active_count,
                            "total_count": total_count,
                            "total_speed_bytes_sec": total_speed,
                        }
                    }),
                )
            }
            ("POST", "/api/probe") if !is_authorized => (
                401,
                serde_json::json!({
                    "success": false,
                    "error": "Unauthorized: valid Downex bridge authentication token required"
                }),
            ),
            ("POST", "/api/probe") => {
                match serde_json::from_str::<ExtensionProbeRequest>(&body_str) {
                    Ok(req) => {
                        let mut custom_headers = HashMap::new();
                        if let Some(cookie) = req.cookies {
                            if !cookie.trim().is_empty() {
                                custom_headers.insert("Cookie".to_string(), cookie);
                            }
                        }
                        if let Some(ref_url) = req.referer {
                            if !ref_url.trim().is_empty() {
                                custom_headers.insert("Referer".to_string(), ref_url);
                            }
                        }
                        if let Some(ua) = req.user_agent {
                            if !ua.trim().is_empty() {
                                custom_headers.insert("User-Agent".to_string(), ua);
                            }
                        }
                        let headers_opt = if custom_headers.is_empty() { None } else { Some(&custom_headers) };
                        match self.queue_manager.probe_url_info(&req.url, headers_opt).await {
                            Ok(probe) => (
                                200,
                                serde_json::json!({
                                    "success": true,
                                    "data": {
                                        "filename": probe.filename,
                                        "total_bytes": probe.total_bytes,
                                        "supports_ranges": probe.supports_ranges,
                                    }
                                }),
                            ),
                            Err(e) => (
                                500,
                                serde_json::json!({
                                    "success": false,
                                    "error": format!("Probe failed: {}", e)
                                }),
                            ),
                        }
                    }
                    Err(e) => (
                        400,
                        serde_json::json!({
                            "success": false,
                            "error": format!("Invalid probe request: {}", e)
                        }),
                    ),
                }
            }
            ("POST", "/api/download") if !is_authorized => (
                401,
                serde_json::json!({
                    "success": false,
                    "error": "Unauthorized: valid Downex bridge authentication token required"
                }),
            ),
            ("POST", "/api/download") => {
                match serde_json::from_str::<ExtensionDownloadRequest>(&body_str) {
                    Ok(req) => {
                        let should_show_dialog = req.show_dialog.unwrap_or(true);
                        let safe_dest = match sanitize_destination_folder(req.destination_folder, &default_dir, should_show_dialog) {
                            Ok(d) => d,
                            Err(e) => {
                                return {
                                    let err_json = serde_json::json!({ "success": false, "error": e });
                                    let err_body = serde_json::to_string(&err_json)?;
                                    let headers = format!(
                                        "HTTP/1.1 400 Bad Request\r\n\
Content-Type: application/json; charset=utf-8\r\n\
Access-Control-Allow-Origin: {}\r\n\
Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-Downex-Token\r\n\
Content-Length: {}\r\n\
Connection: close\r\n\r\n",
                                        allow_origin,
                                        err_body.len()
                                    );
                                    socket.write_all(headers.as_bytes()).await?;
                                    socket.write_all(err_body.as_bytes()).await?;
                                    socket.flush().await?;
                                    Ok(())
                                };
                            }
                        };

                        let mut custom_headers = HashMap::new();
                        if let Some(ref cookie) = req.cookies {
                            if !cookie.trim().is_empty() {
                                custom_headers.insert("Cookie".to_string(), cookie.clone());
                            }
                        }
                        if let Some(ref ref_url) = req.referer {
                            if !ref_url.trim().is_empty() {
                                custom_headers.insert("Referer".to_string(), ref_url.clone());
                            }
                        }
                        if let Some(ref ua) = req.user_agent {
                            if !ua.trim().is_empty() {
                                custom_headers.insert("User-Agent".to_string(), ua.clone());
                            }
                        }

                        let headers_opt = if custom_headers.is_empty() {
                            None
                        } else {
                            Some(custom_headers)
                        };

                        if should_show_dialog && self.app_handle.is_some() {
                            // FAST PATH: Resolve immediate filename from extension or URL to eliminate popup delay
                            let initial_filename = req.filename.clone().unwrap_or_else(|| {
                                req.url
                                    .split('?')
                                    .next()
                                    .unwrap_or(&req.url)
                                    .split('/')
                                    .last()
                                    .unwrap_or("download.bin")
                                    .to_string()
                            });

                            let handle = self.app_handle.as_ref().unwrap().clone();
                            let initial_payload = serde_json::json!({
                                "url": req.url,
                                "filename": initial_filename,
                                "total_bytes": serde_json::Value::Null,
                                "supports_ranges": true,
                                "cookies": req.cookies,
                                "referer": req.referer,
                                "user_agent": req.user_agent,
                            });

                            // INSTANT: Show dialog in front within milliseconds!
                            crate::commands::show_download_dialog(&handle, Some(initial_payload));

                            // ASYNC BACKGROUND PROBE: Query server in background to get precise Content-Length & range support
                            let qm = self.queue_manager.clone();
                            let url_clone = req.url.clone();
                            let req_filename_clone = req.filename.clone();
                            let custom_headers_clone = headers_opt.clone();
                            tauri::async_runtime::spawn(async move {
                                let headers_ref = custom_headers_clone.as_ref();
                                if let Ok(p) = qm.probe_url_info(&url_clone, headers_ref).await {
                                    use tauri::Emitter;
                                    let resolved_name = match req_filename_clone {
                                        Some(ref cf) if cf.contains('.') => cf.clone(),
                                        _ => p.filename,
                                    };
                                    let update_payload = serde_json::json!({
                                        "url": url_clone,
                                        "filename": resolved_name,
                                        "total_bytes": p.total_bytes,
                                        "supports_ranges": p.supports_ranges,
                                    });
                                    let _ = handle.emit("open-download-info-modal", update_payload);
                                }
                            });

                            (
                                200,
                                serde_json::json!({
                                    "success": true,
                                    "data": {
                                        "dialog_opened": true,
                                        "filename": initial_filename,
                                    }
                                }),
                            )
                        } else {
                            let start_immediately = !req.download_later.unwrap_or(false);
                            let chosen_filename = req.filename;
                            match self
                                .queue_manager
                                .create_task(
                                    req.url,
                                    Some(safe_dest),
                                    req.queue_id,
                                    headers_opt,
                                    start_immediately,
                                    chosen_filename,
                                )
                                .await
                            {
                                Ok(task) => (
                                    200,
                                    serde_json::json!({
                                        "success": true,
                                        "data": {
                                            "id": task.id,
                                            "filename": task.filename,
                                            "status": task.status
                                        }
                                    }),
                                ),
                                Err(e) => (
                                    500,
                                    serde_json::json!({
                                        "success": false,
                                        "error": format!("Failed to enqueue download: {}", e)
                                    }),
                                ),
                            }
                        }
                    }
                    Err(e) => (
                        400,
                        serde_json::json!({
                            "success": false,
                            "error": format!("Invalid JSON request: {}", e)
                        }),
                    ),
                }
            }
            ("POST", "/api/download-adaptive") if !is_authorized => (
                401,
                serde_json::json!({
                    "success": false,
                    "error": "Unauthorized: valid Downex bridge authentication token required"
                }),
            ),
            ("POST", "/api/download-adaptive") => {
                match serde_json::from_str::<ExtensionAdaptiveRequest>(&body_str) {
                    Ok(req) => {
                        let mut custom_headers = HashMap::new();
                        if let Some(cookie) = req.cookies {
                            if !cookie.trim().is_empty() {
                                custom_headers.insert("Cookie".to_string(), cookie);
                            }
                        }
                        if let Some(ref_url) = req.referer {
                            if !ref_url.trim().is_empty() {
                                custom_headers.insert("Referer".to_string(), ref_url);
                            }
                        }
                        if let Some(ua) = req.user_agent {
                            if !ua.trim().is_empty() {
                                custom_headers.insert("User-Agent".to_string(), ua);
                            }
                        }

                        let headers_opt = if custom_headers.is_empty() {
                            None
                        } else {
                            Some(custom_headers)
                        };

                        let start_immediately = !req.download_later.unwrap_or(false);
                        let ext = req.extension.unwrap_or_else(|| "mp4".to_string());
                        let video_filename = Some(format!("{}.{}", req.title, ext));
                        let audio_filename = Some(format!("{}_audio.m4a", req.title));

                        // Add video component
                        let video_task = self
                            .queue_manager
                            .create_task(
                                req.video_url,
                                Some(default_dir.clone()),
                                Some("adaptive_media".to_string()),
                                headers_opt.clone(),
                                start_immediately,
                                video_filename,
                            )
                            .await;

                        // Add audio component if present
                        let mut audio_task_id = None;
                        if let Some(audio_url) = req.audio_url {
                            if let Ok(audio_task) = self
                                .queue_manager
                                .create_task(
                                    audio_url,
                                    Some(default_dir),
                                    Some("adaptive_media".to_string()),
                                    headers_opt,
                                    start_immediately,
                                    audio_filename,
                                )
                                .await
                            {
                                audio_task_id = Some(audio_task.id);
                            }
                        }

                        match video_task {
                            Ok(vt) => (
                                200,
                                serde_json::json!({
                                    "success": true,
                                    "data": {
                                        "video_task_id": vt.id,
                                        "audio_task_id": audio_task_id,
                                        "title": req.title,
                                        "status": "queued"
                                    }
                                }),
                            ),
                            Err(e) => (
                                500,
                                serde_json::json!({
                                    "success": false,
                                    "error": format!("Failed to add adaptive media: {}", e)
                                }),
                            ),
                        }
                    }
                    Err(e) => (
                        400,
                        serde_json::json!({
                            "success": false,
                            "error": format!("Invalid JSON request: {}", e)
                        }),
                    ),
                }
            }
            _ => (
                404,
                serde_json::json!({
                    "success": false,
                    "error": "Route not found"
                }),
            ),
        };

        let response_body = serde_json::to_string(&response_json)?;
        let status_text = match status_code {
            200 => "OK",
            204 => "No Content",
            400 => "Bad Request",
            401 => "Unauthorized",
            403 => "Forbidden",
            404 => "Not Found",
            _ => "Internal Server Error",
        };

        let response_headers = format!(
            "HTTP/1.1 {} {}\r\n\
Content-Type: application/json; charset=utf-8\r\n\
Access-Control-Allow-Origin: {}\r\n\
Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-Downex-Token\r\n\
Content-Length: {}\r\n\
Connection: close\r\n\r\n",
            status_code,
            status_text,
            allow_origin,
            response_body.len()
        );

        socket.write_all(response_headers.as_bytes()).await?;
        socket.write_all(response_body.as_bytes()).await?;
        socket.flush().await?;

        Ok(())
    }
}
