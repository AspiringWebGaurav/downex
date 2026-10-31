#!/usr/bin/env node

/**
 * Downex — Workspace Encrypted Vault Pipeline
 * 
 * Securely archives, compresses, and encrypts all private workspace assets:
 * - Environment Credentials: `.env.local`
 * - Release Signing Keys: `.tauri/downex.key`, `.tauri/downex.key.pub`
 * - AI Agent Guidelines & Architecture: `AGENTS.md`, `GEMINI.md`, `PROJECT_MAP.json`, `.agents/`
 * - Internal & Proprietary Automation Scripts: `scripts/build-base.mjs`, `scripts/ship.mjs`, etc.
 * - Client Self-Healing Utilities: `Downex-Repair.cmd`
 * - Reverse Engineering Reference Library: `reference/` (all disassemblies, binaries, DLLs)
 * - Research & Diagnostic Utilities: `scratch/`
 * - Immutable Base Release Packages: `releases/` (if present)
 * 
 * Excludes build caches, dependencies, and temporary files:
 * `node_modules`, `target`, `dist`, `dist-extension`, `.git`, `test-results`, `playwright-report`, `.cache`.
 * 
 * Encryption: AES-256-GCM + scrypt key derivation (memory-hard, GPU-resistant).
 * Container: 8-byte magic ('DWNXVALT') + version (1 byte) + attempts (1 byte) + salt (32 bytes) + IV (12 bytes) + tag (16 bytes) + ciphertext.
 * Hacker Defense Lifecycle: 2 failed attempts intentionally poison and scramble the vault file on disk.
 * 
 * Usage:
 *   node scripts/vault.mjs pack [--pass <password>]
 *   node scripts/vault.mjs unpack [--pass <password>]
 *   node scripts/vault.mjs status
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const vaultFilePath = path.join(rootDir, 'downex-vault.enc');
const defenseFilePath = path.join(rootDir, '.vault_attempts');

const MAGIC_HEADER = Buffer.from('DWNXVALT', 'utf8'); // 8 bytes
const FORMAT_VERSION = 0x01; // 1 byte
const SALT_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

// Patterns to exclude from vault packaging
const EXCLUDE_DIR_NAMES = new Set([
  'node_modules',
  'target',
  'dist',
  'dist-extension',
  '.next',
  '.turbo',
  '.cache',
  'test-results',
  'playwright-report',
  'build',
  'gen',
  '.git',
  'test-vault-verification',
]);

const EXCLUDE_FILE_EXTENSIONS = new Set([
  '.log',
  '.tmp',
  '.tsbuildinfo',
]);

const EXCLUDE_FILE_NAMES = new Set([
  'Thumbs.db',
  '.DS_Store',
  'downex-vault.enc',
  'vault.bin',
  '.vault_attempts',
]);

// 1. Resolve Password from CLI flags, env var, or interactive prompt
async function resolvePassword(action) {
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--pass' || arg === '--password' || arg === '-p') {
      const val = process.argv[i + 1];
      if (val) return val;
    } else if (arg.startsWith('--pass=')) {
      return arg.split('=')[1];
    } else if (arg.startsWith('--password=')) {
      return arg.split('=')[1];
    }
  }

  if (process.env.DOWNEX_VAULT_PASS) return process.env.DOWNEX_VAULT_PASS;
  if (process.env.VAULT_PASSWORD) return process.env.VAULT_PASSWORD;
  if (process.env.GPN_VAULT_PASS) return process.env.GPN_VAULT_PASS;

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (process.stdin.isTTY) {
      process.stdout.write(`\n[Downex Vault] Enter passphrase to ${action}: `);
      let password = '';

      const onData = (char) => {
        char = char + '';
        switch (char) {
          case '\n':
          case '\r':
          case '\u0004':
            process.stdin.removeListener('data', onData);
            process.stdin.setRawMode(false);
            process.stdout.write('\n');
            rl.close();
            const trimmed = password.trim();
            if (!trimmed) {
              console.error('\n[Error] Passphrase cannot be empty.');
              process.exit(1);
            }
            resolve(trimmed);
            break;
          case '\u0003': // Ctrl+C
            process.stdout.write('\n');
            process.exit(130);
            break;
          case '\u007f': // Backspace
          case '\b':
            if (password.length > 0) {
              password = password.slice(0, -1);
              process.stdout.write('\b \b');
            }
            break;
          default:
            password += char;
            process.stdout.write('*');
            break;
        }
      };

      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', onData);
    } else {
      rl.question(`\n[Downex Vault] Enter passphrase to ${action}: `, (answer) => {
        rl.close();
        const trimmed = answer.trim();
        if (!trimmed) {
          console.error('\n[Error] Passphrase cannot be empty.');
          process.exit(1);
        }
        resolve(trimmed);
      });
    }
  });
}

// 2. Recursive File Walker with Exclusions
function collectFiles(baseDir, relativePrefix = '') {
  const results = [];
  if (!fs.existsSync(baseDir)) return results;

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(baseDir, entry.name);
    const relPath = relativePrefix ? path.posix.join(relativePrefix, entry.name) : entry.name;

    if (entry.isDirectory()) {
      if (EXCLUDE_DIR_NAMES.has(entry.name)) continue;
      results.push(...collectFiles(fullPath, relPath));
    } else if (entry.isFile()) {
      if (EXCLUDE_FILE_NAMES.has(entry.name)) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (EXCLUDE_FILE_EXTENSIONS.has(ext)) continue;
      results.push({ fullPath, relPath });
    }
  }
  return results;
}

// 3. PACK Command: Gather -> JSON Manifest -> Gzip -> AES-256-GCM -> downex-vault.enc
async function packVault() {
  console.log('\n===============================================================');
  console.log('   Downex — Packaging Encrypted Workspace Vault');
  console.log('===============================================================\n');

  const password = await resolvePassword('PACK');

  console.log('[1/4] Dynamically scanning private assets, scripts, and configurations...');
  const filesMap = new Map();

  function addFile(fullPath, relPath) {
    const normalizedRel = relPath.replace(/\\/g, '/');
    if (!filesMap.has(normalizedRel) && fs.existsSync(fullPath)) {
      filesMap.set(normalizedRel, { fullPath, relPath: normalizedRel });
    }
  }

  // A. Root environment files (.env.local, .env.*, strictly excluding .env.example)
  if (fs.existsSync(rootDir)) {
    const rootEntries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (entry.isFile()) {
        const name = entry.name.toLowerCase();
        if (name.startsWith('.env') && !name.includes('.example') && !name.includes('.sample')) {
          addFile(path.join(rootDir, entry.name), entry.name);
        }
      }
    }
  }

  // B. Root Architecture Maps, Rules, and Local Utility Scripts
  const rootExplicitFiles = [
    'PROJECT_MAP.json',
    'AGENTS.md',
    'GEMINI.md',
    'Downex-Repair.cmd',
  ];
  for (const f of rootExplicitFiles) {
    const full = path.join(rootDir, f);
    if (fs.existsSync(full)) {
      addFile(full, f);
    }
  }

  // C. Agent Intelligence & Rules (.agents/)
  const agentsDir = path.join(rootDir, '.agents');
  if (fs.existsSync(agentsDir)) {
    for (const item of collectFiles(agentsDir, '.agents')) {
      addFile(item.fullPath, item.relPath);
    }
  }

  // D. Tauri Private Signing Keys (.tauri/)
  const tauriDir = path.join(rootDir, '.tauri');
  if (fs.existsSync(tauriDir)) {
    for (const item of collectFiles(tauriDir, '.tauri')) {
      addFile(item.fullPath, item.relPath);
    }
  }

  // E. Reverse Engineering Library (reference/)
  const referenceDir = path.join(rootDir, 'reference');
  if (fs.existsSync(referenceDir)) {
    for (const item of collectFiles(referenceDir, 'reference')) {
      addFile(item.fullPath, item.relPath);
    }
  }

  // F. Scratchpad & Diagnostic Utilities (scratch/)
  const scratchDir = path.join(rootDir, 'scratch');
  if (fs.existsSync(scratchDir)) {
    for (const item of collectFiles(scratchDir, 'scratch')) {
      addFile(item.fullPath, item.relPath);
    }
  }

  // G. Local Automation & Shipping Scripts (scripts/)
  // All private automation scripts are packed into the vault.
  // We exclude vault.mjs itself from being extracted over itself at runtime.
  const scriptsDir = path.join(rootDir, 'scripts');
  if (fs.existsSync(scriptsDir)) {
    for (const item of collectFiles(scriptsDir, 'scripts')) {
      if (item.relPath.toLowerCase() !== 'scripts/vault.mjs') {
        addFile(item.fullPath, item.relPath);
      }
    }
  }

  // H. Built Base Installers & Release Packages (releases/)
  const releasesDir = path.join(rootDir, 'releases');
  if (fs.existsSync(releasesDir)) {
    for (const item of collectFiles(releasesDir, 'releases')) {
      addFile(item.fullPath, item.relPath);
    }
  }

  const filesToPack = Array.from(filesMap.values());
  console.log(`  ✓ Found ${filesToPack.length} files to archive.`);

  // Build Manifest Object
  console.log('[2/4] Reading and encoding files into structured bundle...');
  let totalRawBytes = 0;
  const manifest = {
    version: 1,
    app: 'downex',
    createdAt: new Date().toISOString(),
    files: [],
  };

  for (const file of filesToPack) {
    const buf = fs.readFileSync(file.fullPath);
    totalRawBytes += buf.length;
    manifest.files.push({
      path: file.relPath,
      data: buf.toString('base64'),
      size: buf.length,
    });
  }

  console.log(`  ✓ Raw uncompressed size: ${(totalRawBytes / (1024 * 1024)).toFixed(2)} MB`);

  console.log('[3/4] Compressing bundle with maximum gzip compression...');
  const manifestJson = JSON.stringify(manifest);
  const compressedBuffer = zlib.gzipSync(Buffer.from(manifestJson, 'utf8'), { level: 9 });
  console.log(`  ✓ Compressed size: ${(compressedBuffer.length / (1024 * 1024)).toFixed(2)} MB`);

  console.log('[4/4] Encrypting with AES-256-GCM and scrypt key derivation...');
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);

  const key = crypto.scryptSync(password, salt, 32, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const ciphertext = Buffer.concat([cipher.update(compressedBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Combine into final vault container (70-byte header + ciphertext):
  // [MAGIC: 8B] [VERSION: 1B] [ATTEMPTS: 1B] [SALT: 32B] [IV: 12B] [TAG: 16B] [CIPHERTEXT: remaining]
  const vaultBuffer = Buffer.concat([
    MAGIC_HEADER,
    Buffer.from([FORMAT_VERSION, 0x00]), // version 0x01, attempts 0x00
    salt,
    iv,
    authTag,
    ciphertext,
  ]);

  fs.writeFileSync(vaultFilePath, vaultBuffer);

  // Also maintain backup copy in vault/vault.bin for backward compatibility
  const legacyVaultPath = path.join(rootDir, 'vault', 'vault.bin');
  const legacyVaultDir = path.dirname(legacyVaultPath);
  if (!fs.existsSync(legacyVaultDir)) {
    fs.mkdirSync(legacyVaultDir, { recursive: true });
  }
  fs.writeFileSync(legacyVaultPath, vaultBuffer);

  const checksum = crypto.createHash('sha256').update(vaultBuffer).digest('hex');

  console.log('\n===============================================================');
  console.log(' [SUCCESS] Encrypted Vault Created Successfully!');
  console.log(`   - Vault File : ${path.relative(rootDir, vaultFilePath)}`);
  console.log(`   - File Size  : ${(vaultBuffer.length / (1024 * 1024)).toFixed(2)} MB (${(vaultBuffer.length / 1024).toFixed(1)} KB)`);
  console.log(`   - SHA-256    : ${checksum.slice(0, 16)}...`);
  console.log(`   - Total Files: ${manifest.files.length}`);
  console.log('===============================================================\n');
}

// 4. UNPACK Command: Read downex-vault.enc -> AES-256-GCM Decrypt -> Gunzip -> Restore Files
async function unpackVault() {
  console.log('\n===============================================================');
  console.log('   Downex — Restoring Encrypted Workspace Vault');
  console.log('===============================================================\n');

  const activeVaultFile = fs.existsSync(vaultFilePath)
    ? vaultFilePath
    : fs.existsSync(path.join(rootDir, 'vault', 'vault.bin'))
    ? path.join(rootDir, 'vault', 'vault.bin')
    : null;

  if (!activeVaultFile) {
    console.error(`\n[Error] Vault file not found: ${vaultFilePath}`);
    console.error('Make sure you have cloned the repository containing downex-vault.enc\n');
    process.exit(1);
  }

  const password = await resolvePassword('UNPACK');

  console.log('[1/4] Reading and verifying vault container header...');
  const vaultBuffer = fs.readFileSync(activeVaultFile);

  const MIN_HEADER_LEN = MAGIC_HEADER.length + 2 + SALT_LEN + IV_LEN + TAG_LEN; // 70 bytes
  if (vaultBuffer.length < MIN_HEADER_LEN) {
    console.error('\n[Error] Vault file is corrupt or truncated.');
    process.exit(1);
  }

  const magic = vaultBuffer.subarray(0, 8);
  if (!magic.equals(MAGIC_HEADER)) {
    console.error('\n===============================================================');
    console.error(' [CONTAINER CORRUPTED] Invalid vault file: Missing DWNXVALT header.');
    console.error(' This file data has been permanently scrambled by self-defense.');
    console.error(' Nice try... go get a life.');
    console.error('===============================================================\n');
    process.exit(1);
  }

  let offset = 8;
  const version = vaultBuffer.readUInt8(offset);
  offset += 1;

  if (version !== FORMAT_VERSION) {
    console.error(`\n[Error] Unsupported vault version: ${version} (expected: ${FORMAT_VERSION})`);
    process.exit(1);
  }

  const inHeaderAttempts = vaultBuffer.readUInt8(offset);
  offset += 1;

  if (inHeaderAttempts >= 2) {
    console.error('\n===============================================================');
    console.error(' [SECURITY PROTOCOL TRIGGERED] Maximum attempts exceeded (2/2)!');
    console.error(' Local vault container has been locked / corrupted on disk.');
    console.error(' Nice try, hacker... go get a life.');
    console.error('===============================================================\n');
    process.exit(1);
  }

  const salt = vaultBuffer.subarray(offset, offset + SALT_LEN);
  offset += SALT_LEN;

  const iv = vaultBuffer.subarray(offset, offset + IV_LEN);
  offset += IV_LEN;

  const authTag = vaultBuffer.subarray(offset, offset + TAG_LEN);
  offset += TAG_LEN;

  const ciphertext = vaultBuffer.subarray(offset);

  console.log('[2/4] Deriving key and decrypting AES-256-GCM container...');
  let compressedBuffer;
  try {
    const key = crypto.scryptSync(password, salt, 32, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    compressedBuffer = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (err) {
    let sidecarAttempts = 0;
    try {
      if (fs.existsSync(defenseFilePath)) {
        const raw = fs.readFileSync(defenseFilePath, 'utf8');
        sidecarAttempts = JSON.parse(raw).attempts || 0;
      }
    } catch {}

    const failedAttempts = Math.max(inHeaderAttempts, sidecarAttempts) + 1;

    if (failedAttempts < 2) {
      // In-file attempt record at offset 9
      try {
        const fd = fs.openSync(activeVaultFile, 'r+');
        fs.writeSync(fd, Buffer.from([failedAttempts]), 0, 1, 9);
        fs.closeSync(fd);
      } catch (e) {}

      // Sidecar file
      try {
        fs.writeFileSync(defenseFilePath, JSON.stringify({ attempts: failedAttempts, timestamp: new Date().toISOString() }));
      } catch (e) {}

      console.error('\n===============================================================');
      console.error(' [ACCESS DENIED] Attempt 1/2 Failed!');
      console.error(' Cryptographic authentication tag mismatch.');
      console.error(' Nice try... go get a life.');
      console.error(' WARNING: 1 attempt remaining before file data is corrupted!');
      console.error('===============================================================\n');
    } else {
      // 2nd attempt failed: INTENTIONALLY CORRUPT FILE DATA ON DISK
      try {
        const fileSize = fs.statSync(activeVaultFile).size;
        const poisonBytes = crypto.randomBytes(fileSize);
        fs.writeFileSync(activeVaultFile, poisonBytes);
        const legacyVault = path.join(rootDir, 'vault', 'vault.bin');
        if (fs.existsSync(legacyVault)) {
          fs.writeFileSync(legacyVault, poisonBytes);
        }
        if (fs.existsSync(defenseFilePath)) {
          fs.unlinkSync(defenseFilePath);
        }
      } catch (corruptErr) {}

      console.error('\n===============================================================');
      console.error(' [SECURITY PROTOCOL TRIGGERED] Maximum attempts exceeded (2/2)!');
      console.error(' Local vault container has been permanently corrupted on disk.');
      console.error(' Nice try, hacker... go get a life.');
      console.error('===============================================================\n');
    }
    process.exit(1);
  }

  // Reset in-file attempt counter and clear sidecar file on successful decryption
  try {
    const fd = fs.openSync(activeVaultFile, 'r+');
    fs.writeSync(fd, Buffer.from([0x00]), 0, 1, 9);
    fs.closeSync(fd);
  } catch (e) {}

  if (fs.existsSync(defenseFilePath)) {
    try {
      fs.unlinkSync(defenseFilePath);
    } catch {}
  }

  console.log('  ✓ Cryptographic signature & authentication tag verified!');

  console.log('[3/4] Decompressing archive payload...');
  let manifest;
  try {
    const uncompressedJson = zlib.gunzipSync(compressedBuffer).toString('utf8');
    manifest = JSON.parse(uncompressedJson);
  } catch (err) {
    console.error('\n[Error] Failed to decompress vault archive payload:', err.message);
    process.exit(1);
  }

  console.log(`  ✓ Manifest loaded: ${manifest.files.length} files (Packaged: ${manifest.createdAt})`);

  console.log('[4/4] Extracting files into original directory hierarchy...');
  let restoredCount = 0;
  for (const entry of manifest.files) {
    const targetPath = path.resolve(rootDir, entry.path);
    const parentDir = path.dirname(targetPath);

    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const fileBuf = Buffer.from(entry.data, 'base64');
    fs.writeFileSync(targetPath, fileBuf);
    restoredCount++;
  }

  console.log('\n===============================================================');
  console.log(' [SUCCESS] Workspace Restored 100% Successfully!');
  console.log(`   - Restored Files : ${restoredCount}`);
  console.log('   - Secrets (.env) : .env.local');
  console.log('   - OTA Signing    : .tauri/downex.key, .tauri/downex.key.pub');
  console.log('   - Agent Rules    : AGENTS.md, GEMINI.md, .agents/');
  console.log('   - Architecture   : PROJECT_MAP.json');
  console.log('   - Automation     : scripts/ (ship.mjs, build-base.mjs, etc.)');
  console.log('   - Repair Tool    : Downex-Repair.cmd');
  console.log('   - Reverse Lib    : reference/idm/');
  console.log('   - Diagnostic     : scratch/');
  console.log('===============================================================\n');
  console.log('Next steps to resume development:');
  console.log('  1. npm install');
  console.log('  2. npm run dev\n');
}

// 5. STATUS Command
function statusVault() {
  console.log('\n===============================================================');
  console.log('   Downex — Encrypted Vault Status');
  console.log('===============================================================\n');

  const activeVaultFile = fs.existsSync(vaultFilePath)
    ? vaultFilePath
    : fs.existsSync(path.join(rootDir, 'vault', 'vault.bin'))
    ? path.join(rootDir, 'vault', 'vault.bin')
    : null;

  if (!activeVaultFile) {
    console.log(`Status    : NOT FOUND (${vaultFilePath})`);
    console.log('Run `npm run vault:pack` to create your initial encrypted vault.\n');
    return;
  }

  const stat = fs.statSync(activeVaultFile);
  const buf = fs.readFileSync(activeVaultFile);
  const isValidHeader = buf.length >= 8 && buf.subarray(0, 8).equals(MAGIC_HEADER);
  const version = isValidHeader && buf.length >= 9 ? buf.readUInt8(8) : 'Unknown';
  const attempts = isValidHeader && buf.length >= 10 ? buf.readUInt8(9) : '0';
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

  console.log(`Vault File : ${path.relative(rootDir, activeVaultFile)}`);
  console.log(`Size       : ${(stat.size / (1024 * 1024)).toFixed(2)} MB (${(stat.size / 1024).toFixed(1)} KB)`);
  console.log(`Modified   : ${stat.mtime.toISOString()}`);
  console.log(`Header     : ${isValidHeader ? 'VALID (DWNXVALT)' : 'INVALID / CORRUPTED'}`);
  console.log(`Version    : ${version}`);
  console.log(`Attempts   : ${attempts}/2 failed`);
  console.log(`SHA-256    : ${sha256}`);
  console.log('\nVault is ready to be committed to GitHub or unpacked on another machine.\n');
}

// Main Command Router
const cmd = (process.argv[2] || '').toLowerCase().trim();
switch (cmd) {
  case 'pack':
  case 'encrypt':
    packVault().catch((err) => {
      console.error('\n[Error] Pack failed:', err);
      process.exit(1);
    });
    break;
  case 'unpack':
  case 'restore':
  case 'decrypt':
    unpackVault().catch((err) => {
      console.error('\n[Error] Unpack failed:', err);
      process.exit(1);
    });
    break;
  case 'status':
    statusVault();
    break;
  default:
    console.log('\nUsage:');
    console.log('  node scripts/vault.mjs pack [--pass <password>]');
    console.log('  node scripts/vault.mjs unpack [--pass <password>]');
    console.log('  node scripts/vault.mjs status\n');
    process.exit(1);
}
