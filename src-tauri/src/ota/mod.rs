use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformInfo {
    pub signature: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseManifest {
    pub version: String,
    pub notes: Option<String>,
    pub pub_date: Option<String>,
    pub url: Option<String>,
    pub size: Option<u64>,
    pub signature: Option<String>,
    pub platforms: Option<std::collections::HashMap<String, PlatformInfo>>,
}

pub async fn check_latest_release(
    client: &reqwest::Client,
    current_version: &str,
) -> Result<Option<ReleaseManifest>, Box<dyn std::error::Error + Send + Sync>> {
    let url = format!(
        "https://gphost.eu.cc/api/v1/releases/downex/latest?target=windows-x86_64&arch=x86_64&current_version={}",
        current_version
    );

    let res = client
        .get(&url)
        .header("User-Agent", "Downex-OTA/0.0.0")
        .send()
        .await?;

    if res.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }

    if res.status().is_success() {
        let mut manifest: ReleaseManifest = res.json().await?;
        if manifest.url.is_none() {
            if let Some(ref platforms) = manifest.platforms {
                if let Some(target) = platforms.get("windows-x86_64") {
                    manifest.url = target.url.clone();
                    if manifest.signature.is_none() {
                        manifest.signature = target.signature.clone();
                    }
                }
            }
        }
        if is_newer_version(&manifest.version, current_version) {
            return Ok(Some(manifest));
        }
    }

    Ok(None)
}

fn is_newer_version(remote: &str, current: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> {
        v.trim_start_matches('v')
            .split('.')
            .map(|s| s.parse::<u64>().unwrap_or(0))
            .collect()
    };

    let r = parse(remote);
    let c = parse(current);
    let len = r.len().max(c.len());

    for i in 0..len {
        let rv = r.get(i).copied().unwrap_or(0);
        let cv = c.get(i).copied().unwrap_or(0);
        if rv > cv {
            return true;
        } else if rv < cv {
            return false;
        }
    }

    false
}

pub const DOWNEX_PUBLIC_KEY: &str = "RWTlF3zfMjQrPQFQjTf9O0vLKNdG7hXa5+lE67R6eXO+J5chsKkmRCnU";

pub fn verify_minisign_signature(data: &[u8], signature_str: &str) -> Result<(), String> {
    let pubkey = minisign_verify::PublicKey::from_base64(DOWNEX_PUBLIC_KEY)
        .map_err(|e| format!("Invalid embedded public key: {}", e))?;
    let sig = minisign_verify::Signature::decode(signature_str)
        .map_err(|e| format!("Failed to parse Minisign signature: {}", e))?;
    pubkey.verify(data, &sig, false)
        .map_err(|e| format!("Cryptographic signature verification failed: {}", e))?;
    Ok(())
}
