# Downex — High-Performance Windows Download Manager

<div align="center">

**An independent, lightweight Windows download manager combining a multi-connection Rust engine, a UI-less companion browser extension, and zero-cloud encrypted credentials.**

[![Rust](https://img.shields.io/badge/Rust-2021-orange.svg)](https://www.rust-lang.org/)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.0-blue.svg)](https://tauri.app/)
[![React 19](https://img.shields.io/badge/React-19.0-61dafb.svg)](https://react.dev/)
[![Tailwind CSS 4](https://img.shields.io/badge/Tailwind-4.0-38bdf8.svg)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## ⚡ Core Features

- **🚀 Multi-Connection Rust Engine:** IDM-style independent HTTP/1.1 TCP socket connections (`tokio`, `reqwest`, `rusqlite`) with dynamic segment work-stealing and positional file writing.
- **🧩 UI-Less Companion Browser Extension (MV3):** Pure background link catcher (`content.js`, `chrome.downloads` interception, and context-menu integration) bridging cleanly to `127.0.0.1:18888` via `POST /api/handshake` with automatic native browser fallback when Downex is closed.
- **🎨 Compact Frameless Desktop UI:** Centered frameless window with system tray docking, per-task progress icons, live inline speed limiter, and dedicated link-grabber / completion dialogs.
- **⚡ 1-by-1 Queue & Auto-Shutdown:** Clean queue scheduling with physical disk-length verification and a 30-second safety countdown modal.
- **🔒 Zero-Cloud Encrypted Project Vault:** Secrets, OTA release signing keys, and references stored in an authenticated **AES-256-GCM + scrypt** container (`downex-vault.enc`) with a 2-attempt self-defense lifecycle.
- **📦 Fast In-Process OTA Pipeline (`<60s`):** Self-updating client utilizing AES-256-GCM containers, Minisign Ed25519 signatures, two 0.75s quiet-stop handoffs (`updater.exe`), autonomous boot probation rollback (`DownexRecovery.exe`), and fast `[profile.ota]` builds (`npm run ship`).

---

## 🚀 Quick Start (Fresh Clone)

### 1. Clone the Repository
```bash
git clone https://github.com/AspiringWebGaurav/downex.git
cd downex
```

### 2. Automated Setup
```bash
Setup.cmd
```
*(Or manually: `npm install && npm run vault:unpack`)*

### 3. Run Development Environment
Full Tauri 2 desktop application:
```bash
npm run dev
```

Frontend browser preview only:
```bash
npm run dev:frontend
```

---

## 📂 Project Architecture

```
downex/
├── downex-browser-extension/     # UI-less Chrome / Edge / Brave extension (MV3)
│   ├── background.js             # Service worker, POST handshake & download interception
│   ├── content.js                # Direct link-click interceptor with Alt bypass
│   └── manifest.json             # WebExtension manifest
├── src/                          # Desktop UI (React 19 + TypeScript + Vite)
│   ├── components/               # Sidebar, table, settings, speedtest, modals
│   ├── windows/                  # DownloadDialogWindow & DownloadCompleteWindow
│   ├── stores/                   # Zustand state stores
│   └── services/                 # Tauri IPC, OTA, and hardware event services
├── src-tauri/                    # Native Engine & Desktop Shell (Rust 2021)
│   ├── src/bridge/               # Loopback HTTP bridge & Native Messaging host
│   ├── src/engine/               # Multi-connection worker pool, probe, limiter & writer
│   ├── src/db/                   # SQLite WAL persistence layer
│   ├── src/ota/                  # In-process update check, verification & recovery
│   ├── src/bin/                  # updater, downex_service, downex_recovery, downex_bridge
│   └── tauri.conf.json           # Tauri v2 configuration
├── scripts/                      # Build, fast OTA release, dev supervisor & vault scripts
│   ├── dev.mjs / predev.mjs      # Direct Tauri dev supervisor & port cleaner
│   ├── ship.mjs                  # Fast (<60s) OTA release pipeline ([profile.ota])
│   ├── build-base.mjs            # Immutable Base v0.0.1 NSIS installer builder
│   ├── package-base-extension.mjs# Immutable companion extension zip packager
│   └── vault.mjs                 # AES-256-GCM + scrypt project vault manager
├── downex-vault.enc              # Authenticated AES-256-GCM encrypted container
├── AGENTS.md / GEMINI.md         # Agent & workflow protocols
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

For full security specs, see [`VAULT.md`](VAULT.md) and [`PROJECT_MAP.json`](PROJECT_MAP.json).

---

## 🚢 Shipping OTA Updates (Authorized Releases Only)

Uses `[profile.ota]`, smart frontend hash caching, and in-memory PE version stamping (`~23s–42s` end-to-end):

```bash
npm run ship 0.0.2 -m "v0.0.2: Performance and stability release"
```

---

## 📄 License

Downex is licensed under the [MIT License](LICENSE).
