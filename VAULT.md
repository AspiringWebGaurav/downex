# Downex Encrypted Project Vault Guide

This project uses a zero-cloud, zero-vendor **Encrypted Project Vault** (`downex-vault.enc`) to secure secret credentials, cryptographic signing keys, internal build & release scripts, AI agent guidelines, and proprietary reverse-engineering assets inside the Git repository matching the **GPN Security Suite**.

---

## Why the Encrypted Vault?
1. **Zero External Cloud Dependencies:** No reliance on Vercel Secrets, Doppler, Infisical, or 1Password APIs to run or build the project.
2. **Instant System Migration:** When moving to a new computer or virtual machine, cloning the repository and running `npm run vault:unpack` reconstructs the entire local state in seconds.
3. **Defense in Depth:** Plaintext credentials (`.env.local`), private keys (`.tauri/*.key`), agent instructions (`AGENTS.md`, `GEMINI.md`, `.agents/`), project maps (`PROJECT_MAP.json`), and proprietary scripts (`scripts/ship.mjs`, `scripts/build-base.mjs`) are strictly excluded by `.gitignore` and can never be pushed in plaintext to public GitHub.
4. **Hacker Defense Protocol:** Entering an invalid passphrase twice intentionally corrupts and permanently scrambles the local container on disk using `crypto.randomBytes(fileSize)`.

---

## Passphrase Handling
> [!IMPORTANT]
> **Zero Plaintext Secrets:** Passphrases must **NEVER** be committed to Git or pushed to GitHub.
> The vault unpacker interactively prompts with hidden input, or accepts the passphrase via the `DOWNEX_VAULT_PASS` environment variable or `--pass` argument.

---

## Quick Start Commands

### 1. Unpacking the Vault (Fresh Clone)
To restore all local files on a new machine:

#### Interactive Mode (Securely prompts for passphrase with hidden input):
```bash
npm run vault:unpack
```

#### Non-Interactive / Scripted:
```bash
npm run vault:unpack -- --pass <your_master_passphrase>
```
or via environment variable:
```bash
DOWNEX_VAULT_PASS="<your_master_passphrase>" npm run vault:unpack
```

#### Windows PowerShell One-Liner (Once unpacked):
```powershell
.\scripts\decrypt-vault.ps1
```

---

### 2. Updating / Re-packing the Vault
If you update `.env.local`, generate new signing keys, or add new local reference files:
```bash
npm run vault:pack
```
or with explicit password:
```bash
npm run vault:pack -- --pass <your_master_passphrase>
```

---

### 3. Full End-to-End Test Suite
Run the automated test verifying packing, 2-attempt hacker defense corruption, header rejection, and 100% SHA-256 match in an isolated sandbox:
```bash
node scripts/test-vault-e2e.mjs <your_master_passphrase>
```
or:
```bash
npm run vault:test -- <your_master_passphrase>
```

---

## Vault Internal File Mapping

When decrypted, the vault maps files to their exact relative paths in the workspace:

| Target File / Directory | Description | Reason in Vault |
|-------------------------|-------------|-----------------|
| `.env.local` | GPHost API Keys & OTA Distribution Endpoints | Live production credentials |
| `.tauri/downex.key` | Minisign Ed25519 Private Signing Key | Required to sign OTA app updates |
| `.tauri/downex.key.pub` | Minisign Ed25519 Public Verification Key | Paired with private key |
| `AGENTS.md`, `GEMINI.md` | Core AI Agent Instructions & Protocols | Private workspace instructions |
| `.agents/` | MCP Server Configs & Behavioral Rules | Internal development rules |
| `PROJECT_MAP.json` | Full architectural specification and SOP | Workspace blueprint |
| `Downex-Repair.cmd` | Autonomous client self-healing script | Local repair utility |
| `scripts/build-base.mjs` | Immutable base installer packager | Proprietary build script |
| `scripts/ship.mjs` | Live OTA release publisher & encryptor | Proprietary release pipeline |
| `scripts/ship-extension.mjs` | Chrome extension publisher | Proprietary release pipeline |
| `scripts/test-ota-e2e.mjs` | Live OTA verification test suite | Proprietary release test |
| `scripts/test-update-system.mjs` | In-process update supervisor test | Proprietary release test |
| `scripts/setup-playwright.mjs` | Playwright test setup helper | Local test utility |
| `scripts/decrypt-vault.ps1` | PowerShell helper launcher | Local utility |
| `reference/idm/` | Reverse engineering resources, binaries, and DLLs | Proprietary reference assets |
| `scratch/` | Diagnostic, extension locator, and test scripts | Developer scratch utilities |
| `releases/base/` | Compiled base installer binaries | Immutable binary packages |

---

## Container Architecture (`downex-vault.enc`)

```
+-----------------------------------------------------------------------------------------+
|                                  DWNXVALT Header (70 Bytes)                             |
+-------------------+----------------+---------------+----------------+-------------------+
| Magic (8B)        | Version (1B)   | Attempts (1B) | Salt (32B)     | IV (12B)          |
| DWNXVALT          | 0x01           | 0x00 / 0x01   | Random Bytes   | Random Bytes      |
+-------------------+----------------+---------------+----------------+-------------------+
| Auth Tag (16B)    | Ciphertext (Remaining Bytes)                                        |
+-------------------+---------------------------------------------------------------------+
                                                                     |
                                                                     v
                                                 [scrypt Key Derivation (N=16384, r=8)]
                                                                     |
                                                                     v
                                                   [AES-256-GCM Decrypt + Verify Tag]
                                                                     |
                                                                     v
                                                            [Gzip Decompress]
                                                                     |
                                                                     v
                                                   +-------------------------------------+
                                                   |         JSON Manifest Payload       |
                                                   +-------------------------------------+
                                                   | File 1: path, base64 data, size     |
                                                   | File 2: path, base64 data, size     |
                                                   | ...                                 |
                                                   +-------------------------------------+
```
