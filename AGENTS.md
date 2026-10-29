# Antigravity & AI Agent Instructions — Downex Repository

Welcome, Agent. This document defines the protocol for working on the **Downex** codebase across fresh clone environments, new systems, and CI/CD pipelines.

---

## 🔒 Master Step 1: Unpack Project Vault on Fresh Clone

Downex utilizes an authenticated **AES-256-GCM** encrypted container with memory-hard **scrypt** key derivation and a strict **2-attempt hacker defense lifecycle** (`downex-vault.enc`) to store local development secrets, private signing keys, and proprietary reverse-engineering reference data without depending on cloud secrets managers or unencrypted environment files in version control.

### Decryption / Unpack Command
Whenever you clone this repository fresh or detect missing `.env.local` / `.tauri/downex.key` / `reference/` files, run:

```bash
npm run vault:unpack
```
or via CLI:
```bash
node scripts/vault.mjs unpack
```
*(If prompted, enter your master vault passphrase, or provide via `DOWNEX_VAULT_PASS` environment variable)*

- **Container Path:** `downex-vault.enc`
- **Vault Specification:** AES-256-GCM + scrypt (N: 16384, r: 8, p: 1) + Gzip Level 9.
- **Hacker Defense Protocol:** Entering an invalid passphrase twice intentionally corrupts and permanently scrambles the local container on disk.

### Restored File Map
The vault automatically extracts and maps files to their exact relative project locations:
1. `.env.local` — Live GPHost API credentials and OTA endpoints.
2. `.tauri/downex.key` — Minisign Ed25519 private signing key for Tauri OTA releases.
3. `.tauri/downex.key.pub` — Public verification key.
4. `reference/idm/` — Proprietary reverse-engineering references, disassemblies, DLLs, and resources.
5. `scratch/` — Local extension, diagnostic, and asset generation scripts.
6. `PROJECT_MAP.json` — Architectural blueprint and SOP.

---

## 🛠️ Step 2: Architecture & Development Commands

Downex is a multi-process desktop download manager consisting of:
1. **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS (`src/`)
2. **Desktop Shell & Backend:** Tauri 2 + Rust 2021 (`src-tauri/`)
3. **Browser Integration Extension:** Manifest V3 / V2 WebExtension (`downex-browser-extension/`)

### Common Development Tasks

- **Install Node Dependencies:**
  ```bash
  npm install
  ```

- **Run Frontend Dev Server:**
  ```bash
  npm run dev:frontend
  ```

- **Run Full Tauri Desktop Application:**
  ```bash
  npm run dev
  ```

- **Compile Production Frontend Bundle:**
  ```bash
  npm run build:frontend
  ```

- **Package Immutable Base Installer (v0.0.0):**
  ```bash
  npm run build:base
  ```

- **Publish OTA Update Release:**
  ```bash
  npm run ship <target_version> -m "Release notes"
  ```

- **Run Full Vault Verification Test:**
  ```bash
  npm run vault:test -- <your_passphrase>
  ```

- **Verify REA (Reverse Engineer Anything) MCP Health:**
  ```bash
  npm run rea:doctor
  ```

---

## 🔐 Step 3: Vault Maintenance Rules

- If you or the user modify `.env.local`, generate new `.tauri/*.key` keys, or add files to `reference/` or `scratch/`, **ALWAYS re-pack the vault** before pushing to Git:
  ```bash
  npm run vault:pack
  ```
- **NEVER** remove `.env.local`, `.tauri/`, `reference/`, or `scratch/` from `.gitignore`.
- **NEVER** commit unencrypted secrets, private keys, or passwords in plaintext to GitHub.

---

## 🛑 Step 4: Strict Git Push Permission Rule

- **NEVER PUSH WITHOUT USER PERMISSION:** Agents, scripts, and workflows must **NEVER** execute `git push`, publish branches, or push tags to GitHub/remote repositories without explicit, direct user permission in the active session.
- Always require the user to explicitly command or confirm a push before running `git push`.

---

## 🔬 Step 5: Terminology Rule — "REA" Definition

- **CRITICAL DEFINITION:** When the user writes **"REA"** in capital letters, it **ALWAYS** refers to **Reverse Engineering** / **Reverse Engineer Anything** (`morluto/rea`, `rea-agents`, binary analysis, disassemblies, or reverse engineering reference material).
- **NEVER** interpret all-caps **"REA"** as React or the frontend React framework. (The frontend UI framework is referred to as "React" with standard capitalization).

---

## 📦 Step 6: Strict Sequential Versioning & Release Retention Rules

- **Strict Sequential Semver:** Never use arbitrary or jumping version orders (e.g., jumping from `0.0.0` directly to `0.1.0`). Release versions must strictly follow monotonic sequential patch numbers:
  - **Base App:** `0.0.0` (immutable base installer).
  - **First OTA Update:** `0.0.1`.
  - **Next OTA Update:** `0.0.2` (then `0.0.3`, `0.0.4`, etc.).
- **Independent Release Retention (Never Delete Releases):**
  - Every release is stored independently without replacing, overwriting, or destroying previous releases.
  - Active releases reside in `downex-dynamic-binaries/releases/v<version>/`.
  - Outdated binaries MUST be safely moved to and retained in their respective old release folders: `downex-dynamic-binaries/OLD/v<version>/`.
  - NEVER execute blanket deletion, unlinking, or purging of release binaries from storage.

---

## 🛑 Step 7: Strict Binary Push & Release Permission Rule

- **NEVER PUSH OR SHIP BINARIES WITHOUT EXPLICIT PERMISSION:** Agents, scripts, and workflows must **NEVER** execute `npm run ship`, compile/publish OTA release binaries, or upload installers to GPHost / Cloudflare R2 / remote release endpoints without explicit, direct user permission in the active session.
- Even if a fix or feature is fully developed, tested, and verified, all changes must **REMAIN STRICTLY LOCAL** until the user explicitly commands: *"Push binary"* or *"Ship binary"*.
- **Never auto-ship on bug fixes:** Never assume that diagnosing and fixing a bug entitles the agent to publish a live production binary.

---

## 🛡️ Step 8: Strict Base App Isolation & Permanent Immutability Rules

- **Zero-Deletion & Absolute Immutability:**
  - The Base 0.0.0 application installer (`Downex-0.0.0-Setup.exe`, slug: `downex-desktop`) and companion extension (`downex-extension.zip`, slug: `downex-extension`) MUST remain permanently immutable.
  - **NEVER** delete, overwrite, move, rename, disassociate, or modify the original base application binary under any circumstance.
- **Total Storage Folder Hierarchy:**
  - The immutable Base 0.0.0 installer and companion assets MUST strictly reside in their dedicated isolated folder: `downex-immutable-base/`.
  - Active OTA update releases MUST strictly reside in their dedicated version folder: `downex-dynamic-binaries/releases/v<version>/`.
  - Outdated releases MUST be safely preserved in: `downex-dynamic-binaries/OLD/v<version>/`.
  - `ship.mjs` is strictly prohibited from touching, modifying, archiving, or deleting any file within `downex-immutable-base/` or matching protected base file IDs/slugs.
- **Mandatory Pre-Flight Guard:**
  - Every release pipeline script (`ship.mjs`) MUST execute a Pre-Flight smoke test against `https://gphost.eu.cc/raw/downex-desktop`.
  - If the base binary is unreachable or missing from GPHost, the release pipeline MUST fail-closed and abort immediately.
- **Permanent Expiry Preset & Explicit Base Registration:**
  - All base app assets uploaded to GPHost / Cloudflare R2 MUST explicitly include `expiry_preset: 'never'` and `isPermanent: true`.
  - When publishing releases via `POST /api/v1/releases/downex/publish`, `baseFileId` pointing to the verified Base 0.0.0 file MUST ALWAYS be explicitly included in the payload.
- **Prohibition of Indiscriminate Wipe Scripts:**
  - Never author or run wildcard deletion scripts (such as blanket regex filters matching `downex`) that could delete the base binary.

---

## 🛡️ Step 9: Antivirus & Windows Defender Heuristic Safety Protocols (Zero False Positives)

To permanently eliminate false positive malware triggers (such as Microsoft Defender `Trojan:Win32/Commando.A!ml` or AMSI heuristic behavioral flags) across local development, release pipelines, and GitHub pushes:

1. **PROHIBITION OF INLINE COMMAND-LINE EVALUATION (`node -e` / `powershell -c`):**
   - **NEVER** execute inline scripts performing network fetch, download, or payload execution via `node -e "..."` or PowerShell one-liners from the command line.
   - Windows Defender heuristic ML engines monitor command lines (`CmdLine`). Launching `node.exe -e` with inline fetch/network calls triggers automated trojan dropper heuristics (`Commando.A!ml`).
   - All tests, probes, and release routines MUST be authored as dedicated, well-structured `.mjs` or `.ts` files on disk (in `scripts/` or `scratch/`) and executed as `node scripts/<script>.mjs`.

2. **LEGITIMATE USER-AGENT & HEADER HYGIENE:**
   - **NEVER** hardcode, spoof, or copy-paste CLI/scraper User-Agents like `'User-Agent': 'curl/8.4.0'` into application source code, Rust HTTP clients (`reqwest`), or automation scripts.
   - Use authentic application identifiers or standard browser headers:
     - For Desktop App / Rust reqwest: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36`
     - For Release Scripts / Pipelines: `Downex-ReleasePipeline/1.0 (Windows NT 10.0; Win64; x64)`

3. **CLEAN BINARY ARTIFACT & SIGNATURE HYGIENE:**
   - Always sign release containers with authentic Minisign Ed25519 keys (`.tauri/downex.key`).
   - Never commit or stage dynamic eval wrappers, dropper patterns, or unverified base64 binaries in the repository.
   - Audit all code and scripts prior to Git push to eliminate false positive flags.
