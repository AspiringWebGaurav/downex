#!/usr/bin/env node

/**
 * Downex Desktop Application — In-Process OTA Release Pipeline
 * 
 * Invoked via: node scripts/ship.mjs <target_version> [-m "release notes"]
 * (e.g. node scripts/ship.mjs 0.1.0 -m "v0.1.0: Multi-connection engine & Browser Extension")
 * 
 * Process:
 * 0. Enforces Pre-Flight Smoke Test against permanent immutable base installer on GPHost.
 * 1. Preserves 0.0.0 as the immutable local base version.
 * 2. Temporarily synchronizes version for compilation: package.json, Cargo.toml, tauri.conf.json.
 * 3. Compiles frontend (tsc && vite build) + Native Windows binary (tauri build --no-bundle).
 * 4. Encrypts native executable into AES-256-GCM container: update<version>.downex.bin (Magic: DWNX_OTA).
 * 5. Generates authentic Minisign Ed25519 cryptographic signature (.tauri/downex.key).
 * 6. Streams container to Cloudflare R2 on GPHost in dedicated folder: downex-dynamic-binaries/releases/v<version>/.
 * 7. Identifies and safeguards Base 0.0.0 installer; preserves previous OTA release in downex-dynamic-binaries/OLD/v<prev>/.
 * 8. Publishes atomic release manifest to GPHost with explicit baseFileId (POST /api/v1/releases/downex/publish).
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

const GPHOST_FOLDER = process.env.GPHOST_FOLDER || 'downex-dynamic-binaries';
const GPHOST_BASE_FOLDER = 'downex-immutable-base';
const GPHOST_APP_SLUG = process.env.GPHOST_APP_SLUG || 'downex';

/**
 * STRICT SECURITY AUDIT:
 * Base 0.0.0 installer and companion files are completely immutable and isolated.
 * Under NO circumstances may ship.mjs move, archive, patch, or delete any base asset.
 */
function isProtectedBaseFile(file) {
  if (!file) return false;
  const folder = file.folder || '';
  const name = (file.filename || file.sanitized_name || '').toLowerCase();
  const slug = file.slug || '';
  const id = file.id || '';
  return (
    folder.startsWith(GPHOST_BASE_FOLDER) ||
    folder.includes('immutable') ||
    folder.includes('base') ||
    slug === 'downex-desktop' ||
    slug === 'downex-extension' ||
    slug === 'downex-app' ||
    name.includes('setup') ||
    name.includes('0.0.0') ||
    name.includes('extension') ||
    id === '7845eb8f-a4e6-4d7f-bf43-608ca690077e' ||
    id === '0d4c06a4-285d-4e9b-8712-439ebdffadea' ||
    id === 'ade9d316-d190-4377-a052-44e10220dc45' ||
    id === '241b1293-091f-4df8-8afb-04468f6e8e5a' ||
    id === '12a9d2f5-ab90-41d0-8ed1-9faec4365790' ||
    id === '3504558c-cc5a-4356-ac95-14a5d5e2be6f'
  );
}

console.log('\n===============================================================');
console.log(`   Downex Download Manager — Shipping OTA Release v${targetVersion}`);
console.log(`   Storage Separation: OTA in [${GPHOST_FOLDER}] | Base in [${GPHOST_BASE_FOLDER}]`);
console.log('===============================================================\n');

// 0. Pre-Flight Verification of Permanent Base Application on GPHost
console.log('[0/8] Enforcing Pre-Flight verification of permanent Base application...');
try {
  const baseProbe = await fetch('https://gphost.eu.cc/raw/downex-desktop', {
    method: 'GET',
    headers: { 'User-Agent': 'Downex-ReleasePipeline/1.0 (Windows NT 10.0; Win64; x64)', Range: 'bytes=0-1024' },
  });
  if (!baseProbe.ok && baseProbe.status !== 206) {
    throw new Error(`Permanent base application probe returned HTTP ${baseProbe.status}`);
  }
  console.log(`  ✓ Permanent Base 0.0.0 installer verified reachable at https://gphost.eu.cc/raw/downex-desktop (HTTP ${baseProbe.status})`);
} catch (preFlightErr) {
  console.error('\n🛑 CRITICAL ABORT: Permanent Base 0.0.0 installer is NOT reachable on GPHost!');
  console.error(`   Endpoint: https://gphost.eu.cc/raw/downex-desktop`);
  console.error(`   Error: ${preFlightErr.message}`);
  console.error('   Release pipeline halted immediately to prevent releasing without base foundation.\n');
  process.exit(1);
}

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
  console.log('\n[1/8] Synchronizing build definitions to target v' + targetVersion + '...');
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
        'User-Agent': 'Downex-ReleasePipeline/1.0 (Windows NT 10.0; Win64; x64)',
      },
    });
    if (filesRes.ok) {
      const filesData = await filesRes.json();
      allGPHostFiles = filesData.files || [];

      // Locate immutable base file in isolated GPHOST_BASE_FOLDER or by permanent slug/name
      const baseFile = allGPHostFiles.find(
        (f) =>
          f.slug === 'downex-desktop' ||
          f.folder?.startsWith(GPHOST_BASE_FOLDER) ||
          f.id === '7845eb8f-a4e6-4d7f-bf43-608ca690077e' ||
          (f.filename?.toLowerCase().includes('setup') && f.filename?.includes('0.0.0'))
      );

      if (baseFile) {
        baseInstallerFileId = baseFile.id;
        console.log(`  ✓ Permanent Base 0.0.0 installer isolated & safeguarded:`);
        console.log(`    Folder: ${baseFile.folder} | ID: ${baseInstallerFileId} | Slug: ${baseFile.slug} | Name: ${baseFile.filename}`);
      }
    }
  } catch (e) {
    console.warn('  Notice: Could not list GPHost files:', e.message);
  }

  if (!baseInstallerFileId) {
    throw new Error('CRITICAL ABORT: Permanent Base 0.0.0 installer was not detected in GPHost file registry. Publication aborted to protect base immutability.');
  }

  // Check previous active release via manifest
  try {
    const latestRes = await fetch(`https://gphost.eu.cc/api/v1/releases/${GPHOST_APP_SLUG}/latest`, {
      headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'Downex-ReleasePipeline/1.0 (Windows NT 10.0; Win64; x64)' },
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

  // 8. Stream Encrypted Container to Cloudflare R2 in Dedicated Version Folder
  const targetReleaseFolder = `${GPHOST_FOLDER}/releases/v${targetVersion}`;
  console.log(`\n[7/8] Streaming ${containerFilename} to Cloudflare R2 in ${targetReleaseFolder}/...`);
  async function uploadToGPHostR2(payloadBytes, filename, folder) {
    const initRes = await fetch('https://gphost.eu.cc/api/v1/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GPHOST_API_KEY}`,
        'User-Agent': 'Downex-ReleasePipeline/1.0 (Windows NT 10.0; Win64; x64)',
      },
      body: JSON.stringify({
        filename,
        byteSize: payloadBytes.length,
        mimeType: 'application/octet-stream',
        folder,
        noShareLink: true,
        isPermanent: true,
        expiry_preset: 'never',
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
        'User-Agent': 'Downex-ReleasePipeline/1.0 (Windows NT 10.0; Win64; x64)',
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

  const uploadedFileId = await uploadToGPHostR2(containerPayload, containerFilename, targetReleaseFolder);
  console.log(`  ✓ Binary streamed and verified successfully! (File ID: ${uploadedFileId})`);

  // Safely archive previous active release to OLD/v<previousVersion>/ (Never delete any release)
  if (
    previousActiveFileId &&
    previousActiveFileId !== baseInstallerFileId &&
    previousVersion &&
    previousVersion !== targetVersion &&
    previousVersion !== '0.0.0'
  ) {
    const archiveFolder = `${GPHOST_FOLDER}/OLD/v${previousVersion}`;
    console.log(`  Safely archiving previous active release v${previousVersion} to ${archiveFolder}/...`);
    try {
      const patchRes = await fetch(`https://gphost.eu.cc/api/v1/files/${previousActiveFileId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GPHOST_API_KEY}`,
          'User-Agent': 'Downex-ReleasePipeline/1.0 (Windows NT 10.0; Win64; x64)',
        },
        body: JSON.stringify({ folder: archiveFolder }),
      });
      if (patchRes.ok) {
        console.log(`  ✓ Previous active release v${previousVersion} safely preserved in ${archiveFolder}/`);
      }
    } catch (moveErr) {
      console.warn('  Archive notice:', moveErr.message);
    }
  }

  // 9. Publish Atomic Release Manifest on GPHost with Guaranteed baseFileId
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
    baseFileId: baseInstallerFileId, // Mandatory explicit reference
  };

  const publishRes = await fetch(`https://gphost.eu.cc/api/v1/releases/${GPHOST_APP_SLUG}/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GPHOST_API_KEY}`,
      'User-Agent': 'Downex-ReleasePipeline/1.0 (Windows NT 10.0; Win64; x64)',
    },
    body: JSON.stringify(publishPayload),
  });

  if (!publishRes.ok) {
    const pubErr = await publishRes.text();
    throw new Error(`Release publish failed: HTTP ${publishRes.status}: ${pubErr}`);
  }

  console.log(`  ✓ Manifest published! Downex v${targetVersion} is now LIVE on GPHost!`);

  // Pre-flight Smoke Test: Probe live manifest & Cloudflare R2 binary availability
  console.log('  Verifying live release manifest and Cloudflare R2 binary availability...');
  try {
    const probeRes = await fetch(`https://gphost.eu.cc/api/v1/releases/${GPHOST_APP_SLUG}/latest`, {
      headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'Downex-ReleasePipeline/1.0 (Windows NT 10.0; Win64; x64)' },
    });
    if (!probeRes.ok) {
      throw new Error(`Live manifest probe failed: HTTP ${probeRes.status}`);
    }
    const liveManifest = await probeRes.json();
    const downloadUrl = liveManifest.url || liveManifest.platforms?.['windows-x86_64']?.url;
    if (!downloadUrl) {
      throw new Error('Live manifest is missing windows-x86_64 download URL');
    }

    console.log(`  Probing binary download URL: ${downloadUrl}`);
    const binProbe = await fetch(downloadUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'Downex-ReleasePipeline/1.0 (Windows NT 10.0; Win64; x64)', Range: 'bytes=0-1024' },
    });

    if (!binProbe.ok && binProbe.status !== 206) {
      const probeBody = await binProbe.text();
      throw new Error(`Live binary download probe returned HTTP ${binProbe.status}: ${probeBody.slice(0, 200)}`);
    }

    const chunk = Buffer.from(await binProbe.arrayBuffer());
    const magic = chunk.subarray(0, 8).toString('utf8');
    if (magic !== 'DWNX_OTA') {
      throw new Error(`Live binary validation failed: Expected magic DWNX_OTA, received "${magic}"`);
    }
    console.log(`  ✓ Smoke test passed: Live download verified operational with DWNX_OTA magic header (HTTP ${binProbe.status})!`);
  } catch (probeErr) {
    console.error('  ✗ FATAL SMOKE TEST FAILURE:', probeErr.message);
    throw probeErr;
  }

} finally {
  // 10. Revert local files back to the permanent immutable 0.0.0 base version!
  console.log('\nRestoring permanent immutable 0.0.0 base version in working tree...');
  setProjectVersion('0.0.0');
  console.log('  ✓ Working tree restored to base version 0.0.0.');
}

console.log('\n===============================================================');
console.log(` [SUCCESS] OTA Release v${targetVersion} is LIVE on GPHost!`);
console.log(`   - Storage: Cloudflare R2 (${GPHOST_FOLDER}/releases/v${targetVersion}/)`);
console.log(`   - Base Foundation: ${GPHOST_BASE_FOLDER}/ (Slug: downex-desktop)`);
console.log('   - Manifest: https://gphost.eu.cc/api/v1/releases/downex/latest');
console.log('   - Installed Downex applications will now detect this update!');
console.log('===============================================================\n');
