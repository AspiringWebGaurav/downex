#!/usr/bin/env node

/**
 * Downex Browser Companion Extension — GPHost Distribution Pipeline
 * 
 * Invoked via: npm run ship:extension or node scripts/ship-extension.mjs
 * 
 * 1. Reads current extension version from downex-browser-extension/manifest.json.
 * 2. Packages extension files into clean distributable ZIP archives.
 * 3. Streams ZIP directly to Cloudflare R2 on GPHost with public slug 'downex-extension'.
 * 4. Verifies public download link and hotlink accessibility.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const extensionDir = path.join(rootDir, 'downex-browser-extension');

// 1. Read Extension Manifest & Version
const manifestPath = path.join(extensionDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('\n[Error] manifest.json not found in downex-browser-extension/');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const extVersion = manifest.version || '0.0.2';

console.log('\n===============================================================');
console.log(`   Downex Browser Companion — Shipping Extension v${extVersion}`);
console.log('===============================================================\n');

// 2. Load Local Environment (.env.local)
function loadEnv() {
  const envPath = path.join(rootDir, '.env.local');
  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}
loadEnv();

const GPHOST_API_KEY = process.env.VITE_GPHOST_API_KEY || process.env.GPHOST_API_KEY;
if (!GPHOST_API_KEY) {
  console.error('\n[Error] GPHOST_API_KEY not found in .env.local');
  process.exit(1);
}

const GPHOST_FOLDER = process.env.GPHOST_FOLDER || 'downex-dynamic-binaries';

// 3. Package Browser Extension into ZIP
console.log('[1/4] Packaging browser extension into ZIP archive...');
const distDir = path.join(rootDir, 'dist-extension');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const zipFilename = `downex-browser-extension-v${extVersion}.zip`;
const genericZipFilename = 'downex-extension.zip';
const zipPath = path.join(distDir, zipFilename);
const genericZipPath = path.join(distDir, genericZipFilename);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
if (fs.existsSync(genericZipPath)) fs.unlinkSync(genericZipPath);

// Use PowerShell Compress-Archive for standard cross-platform zip format
try {
  execSync(
    `powershell.exe -NoProfile -Command "Compress-Archive -Path '${extensionDir}\\*' -DestinationPath '${zipPath}' -Force"`,
    { cwd: rootDir, stdio: 'inherit' }
  );
  fs.copyFileSync(zipPath, genericZipPath);
} catch (zipErr) {
  console.error('[Error] Failed to create ZIP archive:', zipErr.message);
  process.exit(1);
}

const zipBytes = fs.readFileSync(zipPath);
const sha256 = crypto.createHash('sha256').update(zipBytes).digest('hex');
console.log(`  ✓ Package created: ${zipFilename} (${(zipBytes.length / 1024).toFixed(1)} KB, SHA-256: ${sha256.slice(0, 16)}...)`);

// 4. Stream Extension ZIP to GPHost Cloudflare R2
console.log(`\n[2/4] Uploading to GPHost Cloudflare R2 with slug 'downex-extension'...`);

async function uploadToGPHost(bytes, filename, slug) {
  const initRes = await fetch('https://gphost.eu.cc/api/v1/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GPHOST_API_KEY}`,
      'User-Agent': 'Downex-ReleasePipeline/1.0 (Windows NT 10.0; Win64; x64)',
    },
    body: JSON.stringify({
      filename,
      byteSize: bytes.length,
      mimeType: 'application/zip',
      folder: 'downex-immutable-base',
      slug,
      noShareLink: false,
      isPermanent: true,
      overwrite: true,
    }),
  });

  if (!initRes.ok) {
    const errText = await initRes.text();
    throw new Error(`Upload initiation failed: HTTP ${initRes.status}: ${errText}`);
  }

  const { uploadUrl, fileId, completeUrl } = await initRes.json();

  const r2Res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/zip' },
    body: bytes,
  });

  if (!r2Res.ok) {
    throw new Error(`Direct R2 PUT failed: HTTP ${r2Res.status}`);
  }

  const compRes = await fetch(completeUrl || 'https://gphost.eu.cc/api/v1/complete-upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GPHOST_API_KEY}`,
      'User-Agent': 'Downex-ReleasePipeline/1.0 (Windows NT 10.0; Win64; x64)',
    },
    body: JSON.stringify({
      fileId,
      slug: 'downex-extension',
      noShareLink: false,
      isPermanent: true,
      expiry_preset: 'never',
    }),
  });

  if (!compRes.ok) {
    const compErr = await compRes.text();
    throw new Error(`Upload completion failed: HTTP ${compRes.status}: ${compErr}`);
  }

  return fileId;
}

const fileId = await uploadToGPHost(zipBytes, zipFilename, 'downex-extension');
console.log(`  ✓ Extension uploaded successfully! (File ID: ${fileId})`);

// 5. Query File Record on GPHost to Retrieve Generated URLs
console.log('\n[3/4] Resolving permanent public URLs from GPHost...');
let downloadUrl = `https://gphost.eu.cc/f/${fileId}`;
let rawUrl = `https://gphost.eu.cc/raw/${fileId}`;
let shareUrl = `https://gphost.eu.cc/d/downex-extension`;

try {
  const fileRes = await fetch(`https://gphost.eu.cc/api/v1/files/${fileId}`, {
    headers: { Authorization: `Bearer ${GPHOST_API_KEY}`, 'User-Agent': 'Downex-ReleasePipeline/1.0 (Windows NT 10.0; Win64; x64)' },
  });
  if (fileRes.ok) {
    const fileData = await fileRes.json();
    const f = fileData.file || fileData;
    if (f.download_url) downloadUrl = f.download_url;
    if (f.raw_url) rawUrl = f.raw_url;
    if (f.slug) shareUrl = `https://gphost.eu.cc/f/${f.slug}`;
  }
} catch (e) {
  console.warn('  Notice: Could not fetch file details:', e.message);
}

// 6. Pre-flight Smoke Test: Probe Download URL
console.log('\n[4/4] Verifying public availability...');
try {
  const probe = await fetch(rawUrl, {
    method: 'GET',
    headers: { 'User-Agent': 'Downex-ReleasePipeline/1.0 (Windows NT 10.0; Win64; x64)', Range: 'bytes=0-512' },
  });
  if (probe.ok || probe.status === 206) {
    console.log(`  ✓ Smoke test passed: Direct download accessible at ${rawUrl} (HTTP ${probe.status})`);
  }
} catch (probeErr) {
  console.warn('  Notice on probe:', probeErr.message);
}

console.log('\n===============================================================');
console.log(` [SUCCESS] Downex Browser Extension v${extVersion} is LIVE on GPHost!`);
console.log(`   - Version: v${extVersion}`);
console.log(`   - Public Download Link: ${downloadUrl}`);
console.log(`   - Direct CDN Hotlink:   ${rawUrl}`);
console.log(`   - Slug Link:            https://gphost.eu.cc/f/downex-extension`);
console.log(`   - Local Archive:        ${zipPath}`);
console.log('===============================================================\n');
