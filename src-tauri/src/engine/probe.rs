use super::state::ProbeResult;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT_RANGES, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_RANGE, ETAG, LAST_MODIFIED, RANGE};
use std::collections::HashMap;

/// Extracts potential Content-Length / size in bytes embedded inside URL query parameters
/// (e.g., Google Video / googleusercontent `clen=2985392814`, `size=...`, `filesize=...`)
pub fn extract_size_from_url(url: &str) -> Option<u64> {
    if let Ok(parsed_url) = reqwest::Url::parse(url) {
        let keys = ["clen", "size", "filesize", "file_size", "content_length", "length", "bytes", "total_bytes"];
        for (k, v) in parsed_url.query_pairs() {
            let k_lower = k.to_lowercase();
            if keys.iter().any(|&candidate| candidate == k_lower) {
                if let Ok(num) = v.parse::<u64>() {
                    if num > 1024 {
                        return Some(num);
                    }
                }
            }
        }
    }
    None
}

fn is_disallowed_ssrf_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            let octets = v4.octets();
            let is_cgnat = octets[0] == 100 && (octets[1] & 0xC0) == 64;
            let is_benchmark = octets[0] == 198 && (octets[1] & 0xFE) == 18;
            v4.is_loopback()
                || v4.is_private()
                || v4.is_unspecified()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_multicast()
                || is_cgnat
                || is_benchmark
        }
        std::net::IpAddr::V6(v6) => {
            if let Some(mapped_v4) = v6.to_ipv4_mapped() {
                return is_disallowed_ssrf_ip(std::net::IpAddr::V4(mapped_v4));
            }
            let seg0 = v6.segments()[0];
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (seg0 & 0xffc0) == 0xfe80 // link-local fe80::/10
                || (seg0 & 0xfe00) == 0xfc00 // unique local fc00::/7
        }
    }
}

pub fn validate_http_url(url: &str, block_loopback_and_metadata: bool) -> Result<reqwest::Url, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL cannot be empty".to_string());
    }
    let parsed = reqwest::Url::parse(trimmed).map_err(|e| format!("Invalid URL: {}", e))?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(format!("Unsupported URL scheme '{}': only http and https are allowed", other)),
    }
    if block_loopback_and_metadata {
        if let Some(host_str) = parsed.host_str() {
            let lower = host_str.trim_end_matches('.').to_ascii_lowercase();
            if lower == "localhost" || lower.ends_with(".localhost") || lower.ends_with(".local") {
                return Err("Loopback or local host targets are not allowed via bridge".to_string());
            }
            let stripped = host_str.trim_matches(['[', ']'].as_ref());
            if let Ok(ip) = stripped.parse::<std::net::IpAddr>() {
                if is_disallowed_ssrf_ip(ip) {
                    return Err("Loopback, private, or link-local IP targets are not allowed via bridge".to_string());
                }
            } else {
                // Best-effort fast DNS check for hostnames resolving to loopback/private/metadata IPs
                let port = parsed.port_or_known_default().unwrap_or(80);
                if let Ok(addrs) = std::net::ToSocketAddrs::to_socket_addrs(&(stripped, port)) {
                    for addr in addrs {
                        if is_disallowed_ssrf_ip(addr.ip()) {
                            return Err("Resolved IP points to loopback or private network".to_string());
                        }
                    }
                }
            }
        } else {
            return Err("URL must include a valid host".to_string());
        }
    }
    Ok(parsed)
}

pub fn build_bridge_http_client() -> reqwest::Client {
    let policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 10 {
            return attempt.error("Too many redirects");
        }
        if validate_http_url(attempt.url().as_str(), true).is_err() {
            return attempt.error("Blocked unsafe redirect target");
        }
        attempt.follow()
    });
    reqwest::Client::builder()
        .redirect(policy)
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Downex/1.0")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

pub async fn probe_url(
    client: &reqwest::Client,
    url: &str,
    custom_headers: Option<&HashMap<String, String>>,
) -> Result<ProbeResult, Box<dyn std::error::Error + Send + Sync>> {
    let _ = validate_http_url(url, false)?;
    let mut req = client.get(url)
        .header(RANGE, "bytes=0-0")
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .header("Cache-Control", "no-cache");

    // Apply custom headers (User-Agent, Referer, Cookies, etc.)
    if let Some(headers) = custom_headers {
        let mut header_map = HeaderMap::new();
        for (k, v) in headers {
            if let (Ok(name), Ok(val)) = (reqwest::header::HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(v)) {
                header_map.insert(name, val);
            }
        }
        req = req.headers(header_map);
    }

    // Strict 4.5s timeout on range probe to prevent UI lockup / stuck 'Checking...' states
    let range_res = tokio::time::timeout(std::time::Duration::from_millis(4500), req.send()).await;

    let mut supports_ranges = false;
    let mut total_bytes = extract_size_from_url(url);
    let mut etag = None;
    let mut last_modified = None;
    let mut cd_header: Option<HeaderValue> = None;
    let mut probe_error: Option<String> = None;

    match range_res {
        Ok(Ok(res)) if res.status().is_success() || res.status() == reqwest::StatusCode::PARTIAL_CONTENT => {
            let status = res.status();
            let headers = res.headers().clone();
            cd_header = headers.get(CONTENT_DISPOSITION).cloned();
            etag = headers.get(ETAG).and_then(|h| h.to_str().ok()).map(|s| s.to_string());
            last_modified = headers.get(LAST_MODIFIED).and_then(|h| h.to_str().ok()).map(|s| s.to_string());

            if status == reqwest::StatusCode::PARTIAL_CONTENT {
                supports_ranges = true;
                if let Some(cr) = headers.get(CONTENT_RANGE) {
                    if let Ok(cr_str) = cr.to_str() {
                        if let Some(slash_idx) = cr_str.rfind('/') {
                            let total_str = &cr_str[slash_idx + 1..];
                            if let Ok(parsed) = total_str.parse::<u64>() {
                                total_bytes = Some(parsed);
                            }
                        }
                    }
                }
            } else if status.is_success() {
                if let Some(ar) = headers.get(ACCEPT_RANGES) {
                    if let Ok(ar_str) = ar.to_str() {
                        if ar_str.eq_ignore_ascii_case("bytes") {
                            supports_ranges = true;
                        }
                    }
                }
                if let Some(cl) = headers.get(CONTENT_LENGTH) {
                    if let Ok(cl_str) = cl.to_str() {
                        if let Ok(parsed) = cl_str.parse::<u64>() {
                            total_bytes = Some(parsed);
                        }
                    }
                }
            }
        }
        other => {
            let range_err = match other {
                Ok(Ok(res)) => format!("HTTP {}", res.status().as_u16()),
                Ok(Err(e)) => e.to_string(),
                Err(_) => "Probe request timed out".to_string(),
            };
            // Range probe failed, rejected or timed out: fall back to fast HEAD request with 3s timeout
            let mut head_req = client.head(url)
                .header(reqwest::header::ACCEPT_ENCODING, "identity")
                .header("Cache-Control", "no-cache");
            if let Some(headers) = custom_headers {
                let mut header_map = HeaderMap::new();
                for (k, v) in headers {
                    if let (Ok(name), Ok(val)) = (reqwest::header::HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(v)) {
                        header_map.insert(name, val);
                    }
                }
                head_req = head_req.headers(header_map);
            }
            match tokio::time::timeout(std::time::Duration::from_millis(3000), head_req.send()).await {
                Ok(Ok(head_res)) if head_res.status().is_success() => {
                    probe_error = None;
                    let headers = head_res.headers();
                    cd_header = headers.get(CONTENT_DISPOSITION).cloned();
                    etag = headers.get(ETAG).and_then(|h| h.to_str().ok()).map(|s| s.to_string());
                    last_modified = headers.get(LAST_MODIFIED).and_then(|h| h.to_str().ok()).map(|s| s.to_string());
                    if let Some(ar) = headers.get(ACCEPT_RANGES) {
                        if let Ok(ar_str) = ar.to_str() {
                            if ar_str.eq_ignore_ascii_case("bytes") {
                                supports_ranges = true;
                            }
                        }
                    }
                    if let Some(cl) = headers.get(CONTENT_LENGTH) {
                        if let Ok(cl_str) = cl.to_str() {
                            if let Ok(parsed) = cl_str.parse::<u64>() {
                                total_bytes = Some(parsed);
                            }
                        }
                    }
                }
                Ok(Ok(head_res)) => {
                    probe_error = Some(format!("HTTP {}", head_res.status().as_u16()));
                }
                Ok(Err(e)) => {
                    probe_error = Some(e.to_string());
                }
                Err(_) => {
                    probe_error = Some(range_err);
                }
            }
        }
    }

    if let Some(err) = probe_error {
        return Err(format!("Failed to probe download URL: {}", err).into());
    }

    if total_bytes.is_none() {
        total_bytes = extract_size_from_url(url);
    }

    // Resolve Filename from Content-Disposition or URL path
    let filename = extract_filename(url, cd_header.as_ref());

    Ok(ProbeResult {
        url: url.to_string(),
        filename,
        total_bytes,
        supports_ranges,
        etag,
        last_modified,
    })
}

fn extract_filename(url: &str, content_disposition: Option<&HeaderValue>) -> String {
    if let Some(cd) = content_disposition {
        if let Ok(cd_str) = cd.to_str() {
            // Check for filename*=UTF-8''filename.ext (RFC 5987)
            if let Some(idx) = cd_str.find("filename*=") {
                let part = &cd_str[idx + 10..];
                let clean = part.split(';').next().unwrap_or(part).trim();
                let clean = clean.trim_matches('"');
                if let Some(quote_idx) = clean.rfind("''") {
                    let encoded = &clean[quote_idx + 2..];
                    if let Ok(decoded) = urlencoding::decode(encoded) {
                        return sanitize_filename(&decoded);
                    }
                }
            }

            // Check standard filename="filename.ext"
            if let Some(idx) = cd_str.find("filename=") {
                let part = &cd_str[idx + 9..];
                let clean = part.split(';').next().unwrap_or(part).trim();
                let clean = clean.trim_matches('"');
                if !clean.is_empty() {
                    return sanitize_filename(clean);
                }
            }
        }
    }

    // Extract from URL path
    if let Ok(parsed_url) = reqwest::Url::parse(url) {
        if let Some(segments) = parsed_url.path_segments() {
            if let Some(last) = segments.last() {
                let clean = last.trim();
                if !clean.is_empty() && clean != "/" {
                    if let Ok(decoded) = urlencoding::decode(clean) {
                        return sanitize_filename(&decoded);
                    }
                    return sanitize_filename(clean);
                }
            }
        }
    }

    "downloaded_file".to_string()
}

pub fn sanitize_filename(name: &str) -> String {
    // Keep only the final path segment to block directory traversal in raw filenames
    let base = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(name);

    let mut clean: String = base
        .chars()
        .filter(|c| !c.is_control())
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect();

    clean = clean.trim_matches(|c: char| c.is_whitespace() || c == '.').to_string();

    if clean.is_empty() || clean == "." || clean == ".." {
        return "downloaded_file".to_string();
    }

    let stem = clean.split('.').next().unwrap_or(&clean).to_ascii_uppercase();
    let is_reserved = matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL"
            | "COM1" | "COM2" | "COM3" | "COM4" | "COM5" | "COM6" | "COM7" | "COM8" | "COM9"
            | "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5" | "LPT6" | "LPT7" | "LPT8" | "LPT9"
    );
    if is_reserved {
        return format!("_{}", clean);
    }

    if clean.chars().count() > 200 {
        clean.chars().take(200).collect()
    } else {
        clean
    }
}
