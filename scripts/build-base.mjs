#!/usr/bin/env node

/**
 * Downex — Build & Preserve Permanent Immutable Base 0.0.0 Binary
 * 
 * Invoked via: node scripts/build-base.mjs
 * 
 * 1. Confirms version is strictly 0.0.0.
 * 2. Compiles complete production frontend and native Rust binary.
 * 3. Preserves immutable binary locally in releases/base/Downex-0.0.0.exe with SHA-256 checksum.
 * 4. Uploads to Cloudflare R2 on GPHost with slug 'downex-base' and isPermanent: true.
 * 5. Registers baseFileId for all future OTA releases.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 1. Load Local Environment
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

console.log('\n===============================================================');
console.log('   Downex — Building Permanent Immutable Base 0.0.0 Binary');
console.log('===============================================================\n');

// 2. Verify 0.0.0 in all project manifests
const pkgJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const tauriConf = JSON.parse(fs.readFileSync(path.join(rootDir, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const cargoToml = fs.readFileSync(path.join(rootDir, 'src-tauri', 'Cargo.toml'), 'utf8');

if (pkgJson.version !== '0.0.0' || tauriConf.version !== '0.0.0' || !cargoToml.includes('version = "0.0.0"')) {
  console.error('[Error] Version is not 0.0.0 across all manifests!');
  process.exit(1);
}

// 3. Compile Production Frontend
console.log('[1/4] Compiling production frontend bundle (tsc && vite build)...');
execSync('npm.cmd run build:frontend', { cwd: rootDir, stdio: 'inherit' });
console.log('  ✓ Frontend compiled.');

// 4. Compile Production Native Binary and NSIS Installer
console.log('\n[2/4] Compiling native Windows release binary and NSIS base installer (tauri build --bundles nsis)...');
const srcTauriDir = path.join(rootDir, 'src-tauri');
const releaseAppName = path.join(srcTauriDir, 'target', 'release', 'Downex.exe');
const releaseLower = path.join(srcTauriDir, 'target', 'release', 'downex.exe');
if (fs.existsSync(releaseAppName)) fs.unlinkSync(releaseAppName);
if (fs.existsSync(releaseLower)) fs.unlinkSync(releaseLower);

execSync('npx.cmd tauri build --bundles nsis', { cwd: rootDir, stdio: 'inherit' });

let binaryPath = releaseAppName;
if (!fs.existsSync(binaryPath)) {
  binaryPath = releaseLower;
}
if (!fs.existsSync(binaryPath)) {
  console.error(`[Error] Binary not found at ${binaryPath}`);
  process.exit(1);
}

const binaryBytes = fs.readFileSync(binaryPath);
const sha256 = crypto.createHash('sha256').update(binaryBytes).digest('hex');
console.log(`  ✓ Release binary built: ${(binaryBytes.length / (1024 * 1024)).toFixed(2)} MB`);
console.log(`  ✓ SHA-256: ${sha256}`);

// Locate NSIS installer artifact
let nsisInstallerPath = null;
const nsisBundleDir = path.join(srcTauriDir, 'target', 'release', 'bundle', 'nsis');
if (fs.existsSync(nsisBundleDir)) {
  const files = fs.readdirSync(nsisBundleDir);
  const setupFile = files.find((f) => f.endsWith('.exe') && !f.endsWith('.old'));
  if (setupFile) {
    nsisInstallerPath = path.join(nsisBundleDir, setupFile);
    console.log(`  ✓ NSIS Setup Installer located: ${setupFile} (${(fs.statSync(nsisInstallerPath).size / (1024 * 1024)).toFixed(2)} MB)`);
  }
}

// 5. Save Immutable Local Base Copies
console.log('\n[3/4] Preserving immutable local copy in releases/base/...');
const baseDir = path.join(rootDir, 'releases', 'base');
fs.mkdirSync(baseDir, { recursive: true });

const localBaseExe = path.join(baseDir, 'Downex-0.0.0.exe');
fs.writeFileSync(localBaseExe, binaryBytes);
fs.writeFileSync(path.join(baseDir, 'Downex-0.0.0.exe.sha256'), sha256 + ' *Downex-0.0.0.exe\n');
console.log(`  ✓ Standalone executable permanently archived to: ${localBaseExe}`);

if (nsisInstallerPath && fs.existsSync(nsisInstallerPath)) {
  const installerBytes = fs.readFileSync(nsisInstallerPath);
  const installerSha256 = crypto.createHash('sha256').update(installerBytes).digest('hex');
  const localInstaller = path.join(baseDir, 'Downex-0.0.0-Setup.exe');
  fs.writeFileSync(localInstaller, installerBytes);
  fs.writeFileSync(path.join(baseDir, 'Downex-0.0.0-Setup.exe.sha256'), installerSha256 + ' *Downex-0.0.0-Setup.exe\n');
  console.log(`  ✓ NSIS Setup Installer permanently archived to: ${localInstaller}`);
}

// 6. Upload Permanent Base Binary to GPHost
const noUpload = process.argv.includes('--no-upload') || process.argv.includes('--dry-run');
if (noUpload) {
  console.log('\n[4/4] Skipping GPHost upload (--no-upload specified). Base 0.0.0 artifacts preserved locally.');
  console.log('===============================================================');
  console.log(' [SUCCESS] Permanent Base 0.0.0 Binary Verified & Archived!');
  console.log(`   - Local Binary Archive: ${localBaseExe}`);
  if (nsisInstallerPath && fs.existsSync(nsisInstallerPath)) {
    console.log(`   - Local NSIS Installer: ${path.join(baseDir, 'Downex-0.0.0-Setup.exe')}`);
  }
  console.log(`   - SHA-256: ${sha256}`);
  console.log('===============================================================\n');
  process.exit(0);
}

console.log('\n[4/4] Uploading immutable base binary and installer to GPHost Cloudflare R2...');

async function uploadToGPHost(bytes, filename, slug, folder, noShareLink = true) {
  const initRes = await fetch('https://gphost.eu.cc/api/v1/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GPHOST_API_KEY}`,
      'User-Agent': 'curl/8.4.0',
    },
    body: JSON.stringify({
      filename,
      byteSize: bytes.length,
      mimeType: 'application/vnd.microsoft.portable-executable',
      folder,
      slug,
      noShareLink,
      isPermanent: true,
      overwrite: true,
    }),
  });

  if (!initRes.ok) {
    const errText = await initRes.text();
    throw new Error(`Upload initiation failed for ${filename}: HTTP ${initRes.status}: ${errText}`);
  }

  const { uploadUrl, fileId, completeUrl } = await initRes.json();

  const r2Res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/vnd.microsoft.portable-executable' },
    body: bytes,
  });

  if (!r2Res.ok) {
    throw new Error(`Direct R2 upload failed for ${filename}: HTTP ${r2Res.status}`);
  }

  const compRes = await fetch(completeUrl || 'https://gphost.eu.cc/api/v1/complete-upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GPHOST_API_KEY}`,
      'User-Agent': 'curl/8.4.0',
    },
    body: JSON.stringify({
      fileId,
      noShareLink,
      isPermanent: true,
    }),
  });

  if (!compRes.ok) {
    const compErr = await compRes.text();
    throw new Error(`Upload completion failed for ${filename}: HTTP ${compRes.status}: ${compErr}`);
  }

  return fileId;
}

try {
  const baseFilename = 'downex-base-0.0.0.exe';
  const baseFileId = await uploadToGPHost(binaryBytes, baseFilename, 'downex-base', `${GPHOST_FOLDER}/base`, true);
  console.log(`  ✓ Standalone Base binary uploaded: ${baseFilename} (ID: ${baseFileId})`);

  let installerFileId = null;
  if (nsisInstallerPath && fs.existsSync(nsisInstallerPath)) {
    const installerBytes = fs.readFileSync(nsisInstallerPath);
    installerFileId = await uploadToGPHost(installerBytes, 'Downex-0.0.0-Setup.exe', 'downex-app', `${GPHOST_FOLDER}/base`, false);
    console.log(`  ✓ NSIS Setup Installer uploaded: Downex-0.0.0-Setup.exe (ID: ${installerFileId}, Slug: downex-app)`);
  }

  console.log('\n===============================================================');
  console.log(' [SUCCESS] Permanent Immutable Base 0.0.0 Established!');
  console.log(`   - Local Executable:     ${localBaseExe}`);
  if (nsisInstallerPath && fs.existsSync(nsisInstallerPath)) {
    console.log(`   - Local NSIS Setup:     ${path.join(baseDir, 'Downex-0.0.0-Setup.exe')}`);
    console.log(`   - Public Installer URL: https://gphost.eu.cc/f/downex-app`);
    console.log(`   - Direct CDN Hotlink:   https://gphost.eu.cc/raw/downex-app`);
  }
  console.log(`   - Base File ID:         ${baseFileId}`);
  console.log(`   - Standalone SHA-256:   ${sha256}`);
  console.log('   - This base is permanent and will NEVER be overwritten by OTA.');
  console.log('===============================================================\n');
} catch (uploadErr) {
  console.error('\n[Error] GPHost base upload failed:', uploadErr.message);
  process.exit(1);
}
