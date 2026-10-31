import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const testDir = path.join(rootDir, 'test-vault-verification');

console.log('===============================================================');
console.log('   DOWNEX — FULL END-TO-END VAULT SECURITY & RECOVERY TEST');
console.log('===============================================================\n');

let PASSWORD = process.env.DOWNEX_VAULT_PASS || process.env.VAULT_PASSWORD || process.argv[2];
if (!PASSWORD) {
  console.log('Usage: node scripts/test-vault-e2e.mjs <passphrase>');
  console.log('Or set DOWNEX_VAULT_PASS in environment.');
  process.exit(1);
}
const WRONG_PASSWORD = 'wrong_password_9999_invalid';

// 1. Pack the vault using password
console.log('[Test 1] Running `vault:pack` with master password...');
try {
  execSync(`node scripts/vault.mjs pack --pass ${PASSWORD}`, {
    cwd: rootDir,
    encoding: 'utf8',
  });
  console.log('  ✓ Pack completed successfully.');
  if (!fs.existsSync(path.join(rootDir, 'downex-vault.enc'))) {
    throw new Error('downex-vault.enc was not created!');
  }
} catch (err) {
  console.error('  ✗ FAIL: Pack failed:', err.message);
  process.exit(1);
}

// 2. Test Hacker Defense Lifecycle (2 Attempts -> Permanent Corruption)
console.log('\n[Test 2a] Hacker Attempt 1: Wrong password -> Warning expected...');
try {
  execSync(`node scripts/vault.mjs unpack --pass ${WRONG_PASSWORD}`, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: 'pipe',
  });
} catch (err) {
  console.log('  ✓ Attempt 1 caught as expected.');
  const output = (err.stderr || '') + (err.stdout || '');
  if (!output.includes('Attempt 1/2 Failed')) {
    throw new Error('Expected Attempt 1/2 warning in stderr!');
  }
}

console.log('\n[Test 2b] Hacker Attempt 2: Wrong password -> Intentional file corruption expected...');
try {
  execSync(`node scripts/vault.mjs unpack --pass ${WRONG_PASSWORD}`, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: 'pipe',
  });
} catch (err) {
  console.log('  ✓ Attempt 2 caught as expected.');
  const output = (err.stderr || '') + (err.stdout || '');
  if (!output.includes('Maximum attempts exceeded (2/2)')) {
    throw new Error('Expected Maximum attempts exceeded message in stderr!');
  }
}

console.log('\n[Test 2c] Verifying that local vault file was corrupted on disk...');
const corruptedBytes = fs.readFileSync(path.join(rootDir, 'downex-vault.enc'));
const magicHeader = corruptedBytes.subarray(0, 8).toString('utf8');
if (magicHeader === 'DWNXVALT') {
  throw new Error('Vault was NOT corrupted after 2 failed attempts!');
}
console.log(`  ✓ Verified: Vault data was successfully scrambled on disk (Header: 0x${corruptedBytes.subarray(0, 8).toString('hex')}).`);

console.log('\n[Test 2d] Hacker Attempt 3: Trying to unpack corrupted container...');
try {
  execSync(`node scripts/vault.mjs unpack --pass ${PASSWORD}`, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  throw new Error('Unpack of corrupted container should have failed!');
} catch (err) {
  console.log('  ✓ Attempt 3 rejected due to corrupted header as expected.');
  const output = (err.stderr || '') + (err.stdout || '');
  if (!output.includes('Missing DWNXVALT header') && !output.includes('permanently scrambled')) {
    throw new Error('Expected Missing DWNXVALT header message in stderr!');
  }
}

// Re-pack clean vault with real password for legitimate restore test
console.log('\n[Test 2e] Re-packing fresh genuine vault with real master password...');
execSync(`node scripts/vault.mjs pack --pass ${PASSWORD}`, {
  cwd: rootDir,
  encoding: 'utf8',
});
console.log('  ✓ Genuine vault restored for normal usage.');

// 3. Setup isolated test folder to simulate brand-new machine
console.log('\n[Test 3] Setting up isolated directory simulating fresh clone on new system...');
if (fs.existsSync(testDir)) {
  fs.rmSync(testDir, { recursive: true, force: true });
}
fs.mkdirSync(testDir, { recursive: true });
fs.mkdirSync(path.join(testDir, 'scripts'), { recursive: true });

// Copy only git-tracked files
fs.copyFileSync(path.join(rootDir, 'downex-vault.enc'), path.join(testDir, 'downex-vault.enc'));
fs.copyFileSync(path.join(rootDir, 'scripts/vault.mjs'), path.join(testDir, 'scripts/vault.mjs'));
fs.copyFileSync(path.join(rootDir, 'package.json'), path.join(testDir, 'package.json'));

console.log('  ✓ Isolated sandbox prepared with only repo files.');

// 4. Test Decryption with CORRECT password in isolated folder
console.log('\n[Test 4] Running `vault:unpack` with correct password in sandbox...');
try {
  execSync(`node scripts/vault.mjs unpack --pass ${PASSWORD}`, {
    cwd: testDir,
    encoding: 'utf8',
  });
  console.log('  ✓ Unpack succeeded without errors.');
} catch (err) {
  console.error('  ✗ FAIL: Unpack failed:', err.message);
  process.exit(1);
}

// 5. Cryptographic Checksum Comparison for EVERY SINGLE FILE
console.log('\n[Test 5] Cryptographic verification: Comparing SHA-256 of all files...');

function getFilesRecursively(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...getFilesRecursively(full));
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}

const restoredFiles = getFilesRecursively(testDir).filter(
  (f) => !f.endsWith('downex-vault.enc') && !f.includes('scripts\\vault.mjs') && !f.endsWith('package.json')
);

console.log(`  Checking ${restoredFiles.length} restored files against originals...`);

let matches = 0;
let mismatches = 0;

for (const restoredPath of restoredFiles) {
  const rel = path.relative(testDir, restoredPath);
  const originalPath = path.join(rootDir, rel);

  if (!fs.existsSync(originalPath)) {
    console.error(`  ✗ Missing in original: ${rel}`);
    mismatches++;
    continue;
  }

  const restoredHash = crypto.createHash('sha256').update(fs.readFileSync(restoredPath)).digest('hex');
  const originalHash = crypto.createHash('sha256').update(fs.readFileSync(originalPath)).digest('hex');

  if (restoredHash !== originalHash) {
    console.error(`  ✗ HASH MISMATCH: ${rel}`);
    mismatches++;
  } else {
    matches++;
  }
}

console.log(`  ✓ Exact SHA-256 Matches : ${matches} / ${restoredFiles.length}`);
console.log(`  ✓ Mismatches            : ${mismatches}`);

if (mismatches > 0) {
  console.error('  ✗ FAIL: One or more files did not match original!');
  process.exit(1);
}

// 6. Verify Critical Files & Configurations Exist
console.log('\n[Test 6] Verifying presence of critical secret and workflow files...');
const criticalPaths = [
  'PROJECT_MAP.json',
  'AGENTS.md',
  'GEMINI.md',
  'Downex-Repair.cmd',
  '.env.local',
  '.tauri/downex.key',
  '.tauri/downex.key.pub',
  '.agents/mcp_config.json',
  'scripts/ship.mjs',
  'scripts/build-base.mjs',
  'scratch/find_all_exts.ps1',
  'scratch/find_idm_ext.ps1',
];

for (const cp of criticalPaths) {
  const full = path.join(testDir, cp);
  if (!fs.existsSync(full)) {
    console.error(`  ✗ Critical file missing: ${cp}`);
    process.exit(1);
  }
  const size = fs.statSync(full).size;
  console.log(`  ✓ Verified: ${cp} (${size} bytes)`);
}

// Cleanup test folder
console.log('\n[Test 7] Cleaning up isolated test folder...');
fs.rmSync(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
console.log('  ✓ Test directory cleaned.');

console.log('\n===============================================================');
console.log(' [ALL TESTS PASSED] Downex vault encryption & decryption 100% verified!');
console.log('===============================================================\n');
