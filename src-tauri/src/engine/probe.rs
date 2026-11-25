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

pub async fn probe_url(
    client: &reqwest::Client,
    url: &str,
    custom_headers: Option<&HashMap<String, String>>,
) -> Result<ProbeResult, Box<dyn std::error::Error + Send + Sync>> {
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
        _ => {
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
            if let Ok(Ok(head_res)) = tokio::time::timeout(std::time::Duration::from_millis(3000), head_req.send()).await {
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
        }
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

fn sanitize_filename(name: &str) -> String {
    let clean: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect();

    let clean = clean.trim();
    if clean.is_empty() {
        "downloaded_file".to_string()
    } else {
        clean.to_string()
    }
}
