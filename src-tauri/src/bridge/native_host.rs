use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};

#[derive(Debug, Deserialize, Serialize)]
pub struct NativeMessage {
    pub action: String,
    pub url: Option<String>,
    pub filename: Option<String>,
    pub cookies: Option<String>,
    pub referer: Option<String>,
    pub user_agent: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct NativeResponse {
    pub success: bool,
    pub message: String,
    pub task_id: Option<String>,
}

fn get_bridge_token() -> Option<String> {
    if let Ok(app_data) = std::env::var("APPDATA") {
        let token_path = std::path::PathBuf::from(app_data)
            .join("com.downex.manager")
            .join("bridge.token");
        if let Ok(token) = std::fs::read_to_string(token_path) {
            let trimmed = token.trim();
            if trimmed.len() >= 32 {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// Run native messaging loop over stdin / stdout
pub fn run_native_host() -> io::Result<()> {
    let mut stdin = io::stdin();
    let mut stdout = io::stdout();

    loop {
        // Read 4-byte message length
        let mut len_bytes = [0u8; 4];
        if stdin.read_exact(&mut len_bytes).is_err() {
            // EOF or pipe broken
            break;
        }

        let msg_len = u32::from_ne_bytes(len_bytes) as usize;
        if msg_len == 0 || msg_len > 10 * 1024 * 1024 {
            break;
        }

        let mut buffer = vec![0u8; msg_len];
        if stdin.read_exact(&mut buffer).is_err() {
            break;
        }

        let response = match serde_json::from_slice::<NativeMessage>(&buffer) {
            Ok(msg) => {
                match msg.action.as_str() {
                    "ping" => NativeResponse {
                        success: true,
                        message: "Downex Native Host is alive".to_string(),
                        task_id: None,
                    },
                    "get_auth_token" => {
                        let token = get_bridge_token().unwrap_or_default();
                        NativeResponse {
                            success: !token.is_empty(),
                            message: if token.is_empty() {
                                "Bridge token not found. Is Downex running?".to_string()
                            } else {
                                token
                            },
                            task_id: None,
                        }
                    }
                    "download" => {
                        if let Some(ref url) = msg.url {
                            let mut success = false;
                            let mut task_id = None;
                            let mut message = "Forwarded to Downex engine".to_string();

                            let payload = serde_json::json!({
                                "url": url,
                                "filename": msg.filename,
                                "cookies": msg.cookies,
                                "referer": msg.referer,
                                "user_agent": msg.user_agent,
                            });
                            let payload_str = payload.to_string();
                            let token_hdr = if let Some(token) = get_bridge_token() {
                                format!("Authorization: Bearer {}\r\n", token)
                            } else {
                                String::new()
                            };

                            if let Ok(mut stream) = std::net::TcpStream::connect("127.0.0.1:18888") {
                                let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(3)));
                                let req = format!(
                                    "POST /api/download HTTP/1.1\r\n\
Host: 127.0.0.1:18888\r\n\
{}Content-Type: application/json\r\n\
Content-Length: {}\r\n\
Connection: close\r\n\r\n{}",
                                    token_hdr,
                                    payload_str.len(),
                                    payload_str
                                );
                                if stream.write_all(req.as_bytes()).is_ok() {
                                    let mut resp_buf = Vec::new();
                                    let _ = stream.read_to_end(&mut resp_buf);
                                    let resp_text = String::from_utf8_lossy(&resp_buf);
                                    if resp_text.contains("HTTP/1.1 200") {
                                        success = true;
                                        if let Some(body_start) = resp_text.find("\r\n\r\n") {
                                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&resp_text[body_start + 4..]) {
                                                task_id = v["data"]["id"].as_str().map(|s| s.to_string());
                                            }
                                        }
                                    } else {
                                        message = "Bridge returned non-200 status".to_string();
                                    }
                                }
                            } else {
                                message = "Downex engine not running on port 18888".to_string();
                            }

                            NativeResponse {
                                success,
                                message,
                                task_id,
                            }
                        } else {
                            NativeResponse {
                                success: false,
                                message: "Missing URL in download request".to_string(),
                                task_id: None,
                            }
                        }
                    }
                    _ => NativeResponse {
                        success: false,
                        message: format!("Unknown action: {}", msg.action),
                        task_id: None,
                    },
                }
            }
            Err(e) => NativeResponse {
                success: false,
                message: format!("Failed to parse JSON: {}", e),
                task_id: None,
            },
        };

        // Send 4-byte length + JSON response
        let resp_bytes = serde_json::to_vec(&response).unwrap_or_default();
        let resp_len = (resp_bytes.len() as u32).to_ne_bytes();

        let _ = stdout.write_all(&resp_len);
        let _ = stdout.write_all(&resp_bytes);
        let _ = stdout.flush();
    }

    Ok(())
}
