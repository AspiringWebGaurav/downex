# Downex — High-Performance Windows Download Manager

<div align="center">

**An independent, next-generation Windows download manager combining a multi-connection Rust engine, an advanced browser integration extension, and zero-cloud encrypted credentials.**

[![Rust](https://img.shields.io/badge/Rust-2021-orange.svg)](https://www.rust-lang.org/)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.0-blue.svg)](https://tauri.app/)
[![React 19](https://img.shields.io/badge/React-19.0-61dafb.svg)](https://react.dev/)
[![Tailwind CSS 4](https://img.shields.io/badge/Tailwind-4.0-38bdf8.svg)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## ⚡ Core Features

- **🚀 Multi-Connection Rust Engine:** IDM-style independent TCP socket connections (`tokio`, `reqwest`, `rusqlite`) with dynamic segment work-stealing and high-speed positional file writing.
- **🎬 DASH & HLS Stream Muxer:** Built-in manifest parser that simultaneously downloads video + audio streams (including YouTube 4K/1080p 60fps adaptive formats) and remuxes them in-flight into pristine MP4/MKV files.
- **🧩 Advanced Browser Extension (MV3 / MV2):** 
  - **Shadow-DOM Media Pill:** Direct on-player floating download widget with zero layout shift or Win32 flicker.
  - **Download Interceptor:** Automatically captures browser downloads with full session cookies and referrers.
  - **Batch Link Grabber:** Filter and batch download links across any webpage.
- **🎨 GPN-Style Frameless Desktop UI:** Compact, centered frameless window with smooth system tray docking, active progress rings, and queue scheduling.
- **🔒 Zero-Cloud Encrypted Project Vault:** Secrets, OTA release signing keys, and proprietary references are stored in an authenticated **AES-256-GCM + scrypt** container right in the repo with a 2-attempt intrusion defense lifecycle.
- **📦 In-Process OTA Pipeline:** Self-updating client utilizing Minisign Ed25519 cryptographic signatures and GPHost R2 atomic releases (`npm run ship`).

---

## 🚀 Quick Start (Fresh Clone)

### 1. Clone the Repository
```bash
git clone https://github.com/AspiringWebGaurav/downex.git
cd downex
```

### 2. Unpack the Project Vault
Restore `.env.local`, OTA signing keys, and project assets from the encrypted container:

```bash
npm run vault:unpack
```
*(Enter your master vault passphrase when prompted)*

Or non-interactively via environment variable:
```bash
DOWNEX_VAULT_PASS="<your_master_passphrase>" npm run vault:unpack
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Run Development Environment
To launch the full Tauri 2 desktop application:
```bash
npm run dev
```

To run the frontend in the browser only:
```bash
npm run dev:frontend
```

---

## 📂 Project Architecture

```
downex/
├── downex-browser-extension/     # Chrome / Brave / Edge extension (MV3 / MV2)
│   ├── background.js             # Service worker & Native Messaging bridge
│   ├── content.js                # DOM media detector & video overlay
│   ├── manifest.json             # WebExtension manifest
│   └── page-hook.js              # In-page stream sniffer (DASH / HLS)
├── src/                          # Desktop UI (React 19 + TypeScript + Vite)
│   ├── components/               # Modal windows, download lists, add URL dialogs
│   ├── stores/                   # Zustand state management
│   └── utils/                    # Formatting helpers
├── src-tauri/                    # Native Engine & Desktop Shell (Rust 2021)
│   ├── src/bridge/               # Native Messaging stdio host protocol
│   ├── src/engine/               # Multi-connection worker pool & stream muxer
│   ├── src/db/                   # SQLite WAL persistence layer
│   ├── src/ota/                  # In-process update check & binary patcher
│   └── tauri.conf.json           # Tauri v2 configuration
├── scripts/                      # Build, release, and vault scripts
│   ├── vault.mjs                 # AES-256-GCM + scrypt project vault manager
│   ├── decrypt-vault.ps1         # Windows PowerShell decrypt launcher
│   ├── ship.mjs                  # In-process OTA release pipeline
│   ├── build-base.mjs            # Base v0.0.0 installer builder
│   └── test-vault-e2e.mjs        # End-to-end vault & hacker defense test suite
├── downex-vault.enc              # Authenticated AES-256-GCM encrypted container
├── AGENTS.md                     # Instructions for Antigravity & AI agents
├── VAULT.md                      # Detailed project vault documentation
├── PROJECT_MAP.json              # Full architectural specification and SOP
└── .env.example                  # Template environment variables
```

---

## 🔒 Managing Secrets with the Project Vault

| Task | Command |
|------|---------|
| **Unpack Vault (Restore Files)** | `npm run vault:unpack` |
| **Re-pack Vault (Save Changes)** | `npm run vault:pack` |
| **Inspect Vault Status** | `npm run vault:status` |
| **Run Security Test Suite** | `npm run vault:test -- <passphrase>` |

For full security specs and technical breakdown, see [`VAULT.md`](VAULT.md) and [`PROJECT_MAP.json`](PROJECT_MAP.json).

---

## 🚢 Shipping OTA Updates

To compile, encrypt into an OTA container, generate an Ed25519 signature, stream to GPHost R2, and publish the release manifest:

```bash
npm run ship 0.1.0 -m "v0.1.0: Multi-connection engine and browser extension release"
```

---

## 📄 License

Downex is licensed under the [MIT License](LICENSE).
