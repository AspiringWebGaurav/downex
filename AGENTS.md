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


