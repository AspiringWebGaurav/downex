# Antigravity & AI Agent Instructions — Downex Repository

Welcome, Agent. This document defines the exact operational protocol for working on the **Downex** codebase across fresh clone environments, new systems, and CI/CD pipelines.

---

## 🚨 MANDATORY STEP 1: Fresh Clone Detection & Vault Unpack Protocol

**Before executing ANY task, code modification, dependency installation, or build command:**

### 1. Check Workspace State
Inspect whether the following private assets exist on disk:
- `.env.local`
- `.tauri/downex.key`
- `reference/`

### 2. If ANY Private Asset is Missing:
The repository is in a **Fresh Clone State**. All production credentials, OTA signing keys, and reverse-engineering references are safely stored in the encrypted container [`downex-vault.enc`](file:///c:/GITHUB/downex/downex-vault.enc).

**AGENT ACTION REQUIRED:**
- **DO NOT** create dummy credentials or attempt to build without unpacking.
- **DO NOT** attempt to brute-force or guess passphrases (the container has a 2-attempt self-defense scramble lifecycle).
- **Prompt the user immediately:**
  > "I detect a fresh clone of Downex with private assets locked in `downex-vault.enc`. Please provide your master vault passphrase (or run `npm run vault:unpack` in your terminal) so I can restore your `.env.local`, release signing keys, and reference catalog."
- Once the user provides the passphrase, run:
  ```bash
  node scripts/vault.mjs unpack --pass <user_passphrase>
  ```
  or:
  ```bash
  npm run vault:unpack -- --pass <user_passphrase>
  ```
- Confirm restoration of all 269 private files.

---

## 🛠️ Step 2: Architecture & Development Commands

Downex is an independent, multi-process desktop download manager consisting of:
1. **Frontend UI:** React 19 + TypeScript + Vite + Tailwind CSS v4 (`src/`)
2. **Desktop Shell & Backend:** Tauri 2 + Rust 2021 (`src-tauri/`)
3. **Browser Integration Extension:** Manifest V3 / V2 WebExtension (`downex-browser-extension/`)

### Standard Workflow Commands

- **Install Node Dependencies:**
  ```bash
  npm install
  ```

- **Run Frontend Dev Server (Browser UI Preview):**
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

- **Compile Native Base Installer (v0.0.0):**
  ```bash
  npm run build:base
  ```

- **Ship OTA Update Release to GPHost:**
  ```bash
  npm run ship <target_version> -m "<release_notes>"
  ```

- **Run Full Vault Integrity Test Suite:**
  ```bash
  node scripts/test-vault-e2e.mjs <passphrase>
  ```

- **Verify REA (Reverse Engineer Anything) MCP Health:**
  ```bash
  npm run rea:doctor
  ```

---

## 🔐 Step 3: Vault Maintenance & Zero-Leak Rules

- **Never Commit Plaintext Passwords:** Master passphrases must NEVER be written to documentation, commit messages, or scripts.
- **Re-pack After Changes:** If you or the user modify `.env.local`, generate new `.tauri/*.key` keys, or add files to `reference/` or `scratch/`, **ALWAYS re-pack the vault** before pushing to Git:
  ```bash
  npm run vault:pack
  ```
- **Strict Gitignore Compliance:** Never remove `.env.local`, `.tauri/`, `reference/`, or `scratch/` from `.gitignore`.
- **Reference Catalog:** Full architectural SOP and component mapping is maintained in [`PROJECT_MAP.json`](file:///c:/GITHUB/downex/PROJECT_MAP.json).

---

## 🛑 Step 4: Strict Git Push Permission Rule

- **NEVER PUSH WITHOUT USER PERMISSION:** Agents, scripts, and workflows must **NEVER** execute `git push`, publish branches, or push tags to GitHub/remote repositories without explicit, direct user permission in the active session.
- Always require the user to explicitly command or confirm a push before running `git push`.

---

## 🔬 Step 5: Terminology Rule — "REA" Definition

- **CRITICAL DEFINITION:** When the user writes **"REA"** in capital letters, it **ALWAYS** refers to **Reverse Engineering** / **Reverse Engineer Anything** (`morluto/rea`, `rea-agents`, binary analysis, disassemblies, or reverse engineering reference material).
- **NEVER** interpret all-caps **"REA"** as React or the frontend React framework. (The frontend UI framework is referred to as "React" with standard capitalization).


