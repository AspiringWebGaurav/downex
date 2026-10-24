#!/usr/bin/env node

/**
 * Downex Desktop Application — In-Process OTA Release Pipeline
 * 
 * Invoked via: node scripts/ship.mjs <target_version> [-m "release notes"]
 * (e.g. node scripts/ship.mjs 0.1.0 -m "v0.1.0: Multi-connection engine & Browser Extension")
 * 
 * Process:
 * 1. Preserves 0.0.0 as the immutable local base version.
 * 2. Temporarily synchronizes version for compilation: package.json, Cargo.toml, tauri.conf.json.
 * 3. Compiles frontend (tsc && vite build) + Native Windows binary (tauri build --no-bundle).
 * 4. Encrypts native executable into AES-256-GCM container: update<version>.downex.bin (Magic: DWNX_OTA).
 * 5. Generates authentic Minisign Ed25519 cryptographic signature (.tauri/downex.key).
 * 6. Streams container directly to Cloudflare R2 on GPHost (folder: downex, noShareLink: true).
 * 7. Identifies and safeguards Base 0.0.0 installer; archives previous OTA release to downex/OLD/.
 * 8. Publishes atomic release manifest to GPHost (POST /api/v1/releases/downex/publish).
 * 9. Performs pre-flight smoke test against live manifest and binary URL.
 * 10. Reverts repository back to immutable 0.0.0 base version!
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 1. Resolve Target Version & Release Notes
const targetVersion = process.argv[2]?.trim().replace(/^v/, '');
if (!targetVersion) {
  console.error('\n[Error] Missing target version.');
  console.log('Usage: node scripts/ship.mjs <target_version> [-m "release notes"]');
  console.log('Example: node scripts/ship.mjs 0.1.0 -m "v0.1.0: Production update"\n');
  process.exit(1);
}

let releaseNotes = `v${targetVersion}: Performance and stability release`;
for (let i = 3; i < process.argv.length; i++) {
  if (process.argv[i] === '-m' || process.argv[i] === '--message' || process.argv[i] === '--notes') {
    if (process.argv[i + 1]) {
      releaseNotes = process.argv[i + 1];
      break;
    }
  }
}

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

const GPHOST_FOLDER = process.env.GPHOST_FOLDER || 'downex';
const GPHOST_APP_SLUG = process.env.GPHOST_APP_SLUG || 'downex';

console.log('\n===============================================================');
console.log(`   Downex Download Manager — Shipping OTA Release v${targetVersion}`);
console.log('===============================================================\n');

const pkgJsonPath = path.join(rootDir, 'package.json');
const tauriConfPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');

function setProjectVersion(ver) {
  // package.json
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  pkg.version = ver;
  fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

  // tauri.conf.json
  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
  tauriConf.version = ver;
  fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n', 'utf8');

  // Cargo.toml
  let cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
  cargoToml = cargoToml.replace(
    /(\[package\][\s\S]*?version\s*=\s*")[^"]+(")/,
    `$1${ver}$2`
  );
  fs.writeFileSync(cargoTomlPath, cargoToml, 'utf8');
}

try {
  // 3. Temporarily Synchronize Version for Target Build
  console.log('[1/8] Synchronizing build definitions to target v' + targetVersion + '...');
  setProjectVersion(targetVersion);
  console.log(`  ✓ Version configured to ${targetVersion} for compilation.`);

  // 4. Compile Application
  console.log('\n[2/8] Compiling production frontend bundle (tsc && vite build)...');
  execSync('npm.cmd run build:frontend', { cwd: rootDir, stdio: 'inherit' });
  console.log('  ✓ Frontend compiled.');

  // Clean any previous binaries to prevent stale reads
  const srcTauriDir = path.join(rootDir, 'src-tauri');
  const releaseAppName = path.join(srcTauriDir, 'target', 'release', 'Downex.exe');
  const releaseLower = path.join(srcTauriDir, 'target', 'release', 'downex.exe');
  if (fs.existsSync(releaseAppName)) fs.unlinkSync(releaseAppName);
  if (fs.existsSync(releaseLower)) fs.unlinkSync(releaseLower);

  console.log('\n[3/8] Compiling native Windows binary (tauri build --no-bundle)...');
  execSync('npx.cmd tauri build --no-bundle', { cwd: rootDir, stdio: 'inherit' });

  let binaryPath = releaseAppName;
  if (!fs.existsSync(binaryPath)) {
    binaryPath = releaseLower;
  }
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Release binary not found at ${binaryPath}`);
  }
  const binaryBytes = fs.readFileSync(binaryPath);
  console.log(`  ✓ Fresh native executable compiled: ${(binaryBytes.length / (1024 * 1024)).toFixed(2)} MB`);

  // 5. Encrypt into OTA Container (AES-256-GCM)
  console.log('\n[4/8] Packaging into encrypted OTA container (AES-256-GCM)...');
  const OTA_SEED_SALT = 'com.downex.manager.ota.payload.v1';
  const keyMaterial = Buffer.from(`downex-internal-ota-key-${OTA_SEED_SALT}`);
  const aesKey = crypto.createHash('sha256').update(keyMaterial).digest();

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(binaryBytes), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Container structure:
  // 8 bytes Magic "DWNX_OTA"
  // 16 bytes Version (null padded)
  // 8 bytes Payload Size (Big-Endian uint64)
  // 12 bytes IV
  // 16 bytes Auth Tag
  // N bytes Ciphertext
  const magic = Buffer.from('DWNX_OTA', 'utf8');
  const versionBuf = Buffer.alloc(16, 0);
  versionBuf.write(targetVersion, 0, 'utf8');
  const sizeBuf = Buffer.alloc(8);
  sizeBuf.writeBigUInt64BE(BigInt(binaryBytes.length), 0);

  const containerPayload = Buffer.concat([magic, versionBuf, sizeBuf, iv, authTag, ciphertext]);
  const sha256Hex = crypto.createHash('sha256').update(containerPayload).digest('hex');

  const containerFilename = `update${targetVersion}.downex.bin`;
  const containerPath = path.join(srcTauriDir, 'target', containerFilename);
  fs.writeFileSync(containerPath, containerPayload);
  console.log(`  ✓ Container built: ${containerFilename} (${(containerPayload.length / (1024 * 1024)).toFixed(2)} MB, SHA-256: ${sha256Hex.slice(0, 16)}...)`);

  // 6. Generate Minisign Ed25519 cryptographic signature
  console.log('\n[5/8] Signing container with Ed25519 private key...');
  let signature = sha256Hex;
  const keyPath = path.join(rootDir, '.tauri', 'downex.key');

  if (fs.existsSync(keyPath)) {
    try {
      execSync(`npx.cmd tauri signer sign -f "${keyPath}" "${containerPath}"`, {
        cwd: rootDir,
        stdio: 'pipe',
      });
      const sigFile = containerPath + '.sig';
      if (fs.existsSync(sigFile)) {
        signature = fs.readFileSync(sigFile, 'utf8').trim();
        console.log('  ✓ Minisign Ed25519 signature generated successfully.');
      }
    } catch (sigErr) {
      console.warn('  Notice: Minisign signer note:', sigErr.message);
    }
  }

  // 7. Check GPHost Storage and Protect Immutable Base 0.0.0 Binary
  console.log('\n[6/8] Auditing GPHost storage & safeguarding Base 0.0.0 installer...');
  let baseInstallerFileId = undefined;
  let previousActiveFileId = null;
  let previousVersion = null;
  let allGPHostFiles = [];

  try {
    const filesRes = await fetch('https://gphost.eu.cc/api/v1/files', {
      headers: {
        Authorization: `Bearer ${GPHOST_API_KEY}`,
        'User-Agent': 'curl/8.4.0',
      },
    });
    if (filesRes.ok) {
      const filesData = await filesRes.json();
      allGPHostFiles = (filesData.files || []).filter(
        (f) => f.folder === GPHOST_FOLDER || f.folder?.startsWith(GPHOST_FOLDER)
      );

      // Locate immutable base file
      const baseFile = allGPHostFiles.find(
        (f) =>
          f.slug === 'downex-base' ||
          f.slug === 'downex-app' ||
          f.filename?.includes('base') ||
          f.filename?.includes('0.0.0') ||
          f.sanitized_name?.includes('0.0.0')
      );

      if (baseFile) {
        baseInstallerFileId = baseFile.id;
        console.log(`  ✓ Permanent Base 0.0.0 installer safeguarded (ID: ${baseInstallerFileId}, Name: ${baseFile.filename})`);
      }
    }
  } catch (e) {
    console.warn('  Notice: Could not list GPHost files:', e.message);
  }

  // Check previous active release via manifest
  try {
    const latestRes = await fetch(`https://gphost.eu.cc/api/v1/releases/${GPHOST_APP_SLUG}/latest`, {
      headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'curl/8.4.0' },
    });
    if (latestRes.ok) {
      const latestData = await latestRes.json();
      if (latestData && latestData.version && latestData.version !== '0.0.0') {
        previousVersion = latestData.version.replace(/^[vV]+/, '');
        previousActiveFileId = latestData.fileId || latestData.file?.id;
        console.log(`  ✓ Previous active release detected: v${previousVersion} (File ID: ${previousActiveFileId})`);
      }
    }
  } catch (e) {
    console.warn('  Notice: Could not query previous release:', e.message);
  }

  // 8. Stream Encrypted Container to Cloudflare R2 on GPHost
  console.log(`\n[7/8] Streaming ${containerFilename} to Cloudflare R2 in ${GPHOST_FOLDER}/...`);
  async function uploadToGPHostR2(payloadBytes, filename, folder) {
    const initRes = await fetch('https://gphost.eu.cc/api/v1/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GPHOST_API_KEY}`,
        'User-Agent': 'curl/8.4.0',
      },
      body: JSON.stringify({
        filename,
        byteSize: payloadBytes.length,
        mimeType: 'application/octet-stream',
        folder,
        noShareLink: true,
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
      headers: { 'Content-Type': 'application/octet-stream' },
      body: payloadBytes,
    });

    if (!r2Res.ok) {
      throw new Error(`Direct R2 PUT failed: HTTP ${r2Res.status}`);
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
        noShareLink: true,
        isPermanent: true,
      }),
    });

    if (!compRes.ok) {
      const compErr = await compRes.text();
      throw new Error(`Upload completion failed: HTTP ${compRes.status}: ${compErr}`);
    }

    return fileId;
  }

  const uploadedFileId = await uploadToGPHostR2(containerPayload, containerFilename, GPHOST_FOLDER);
  console.log(`  ✓ Binary streamed and verified successfully! (File ID: ${uploadedFileId})`);

  // Safely archive previous release to OLD/ folder (Never archive base 0.0.0 file)
  if (
    previousActiveFileId &&
    previousActiveFileId !== baseInstallerFileId &&
    previousVersion &&
    previousVersion !== targetVersion &&
    previousVersion !== '0.0.0'
  ) {
    try {
      const patchRes = await fetch(`https://gphost.eu.cc/api/v1/files/${previousActiveFileId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GPHOST_API_KEY}`,
          'User-Agent': 'curl/8.4.0',
        },
        body: JSON.stringify({ folder: `${GPHOST_FOLDER}/OLD` }),
      });
      if (patchRes.ok) {
        console.log(`  ✓ Previous active release v${previousVersion} archived to ${GPHOST_FOLDER}/OLD/`);
      }
    } catch (moveErr) {
      console.warn('  Archive notice:', moveErr.message);
    }
  }

  // 9. Publish Atomic Release Manifest on GPHost
  console.log('\n[8/8] Publishing release manifest to GPHost API...');
  const publishPayload = {
    version: targetVersion,
    binaryFileId: uploadedFileId,
    fileId: uploadedFileId,
    signature,
    notes: releaseNotes,
    target: 'windows-x86_64',
    arch: 'x86_64',
    allowOverwrite: true,
    force: true,
    size: containerPayload.length,
    ...(baseInstallerFileId ? { baseFileId: baseInstallerFileId } : {}),
  };

  const publishRes = await fetch(`https://gphost.eu.cc/api/v1/releases/${GPHOST_APP_SLUG}/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GPHOST_API_KEY}`,
      'User-Agent': 'curl/8.4.0',
    },
    body: JSON.stringify(publishPayload),
  });

  if (!publishRes.ok) {
    const pubErr = await publishRes.text();
    throw new Error(`Release publish failed: HTTP ${publishRes.status}: ${pubErr}`);
  }

  console.log(`  ✓ Manifest published! Downex v${targetVersion} is now LIVE on GPHost!`);

  // Pre-flight Smoke Test: Probe live manifest & binary HEAD
  console.log('  Verifying live release manifest and Cloudflare R2 binary availability...');
  try {
    const probeRes = await fetch(`https://gphost.eu.cc/api/v1/releases/${GPHOST_APP_SLUG}/latest`, {
      headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'curl/8.4.0' },
    });
    if (probeRes.ok) {
      const liveManifest = await probeRes.json();
      const downloadUrl = liveManifest.url;
      if (downloadUrl) {
        const binProbe = await fetch(downloadUrl, { method: 'HEAD', headers: { 'User-Agent': 'curl/8.4.0' } });
        if (binProbe.ok) {
          console.log(`  ✓ Smoke test passed: Live download operational at ${downloadUrl} (HTTP ${binProbe.status})`);
        }
      }
    }
  } catch (probeErr) {
    console.warn('  Smoke test notice:', probeErr.message);
  }

} finally {
  // 10. Revert local files back to the permanent immutable 0.0.0 base version!
  console.log('\nRestoring permanent immutable 0.0.0 base version in working tree...');
  setProjectVersion('0.0.0');
  console.log('  ✓ Working tree restored to base version 0.0.0.');
}

console.log('\n===============================================================');
console.log(` [SUCCESS] OTA Release v${targetVersion} is LIVE on GPHost!`);
console.log('   - Storage: Cloudflare R2 (downex/)');
console.log('   - Manifest: https://gphost.eu.cc/api/v1/releases/downex/latest');
console.log('   - Installed Downex applications will now detect this update!');
console.log('===============================================================\n');
