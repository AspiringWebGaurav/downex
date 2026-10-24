---
name: architecture
description: Downex architecture, multi-connection download engine, and OTA release pipeline guidelines.
---

# Downex Architecture Guidelines

## Core Principles
1. **Multi-Connection Rust Engine (`src-tauri/src/engine/`):**
   - Independent TCP sockets (forced HTTP/1.1 per worker, pool limit 64).
   - Dynamic segment work-stealing and positional file writes via `seek_write`.
   - SQLite WAL state machine for atomic resume and task persistence.

2. **Browser Integration Extension (`downex-browser-extension/`):**
   - Manifest V3 / V2 WebExtension.
   - Shadow-DOM floating media pill directly on HTML5 video players.
   - Stream sniffer intercepting DASH (`.mpd`), HLS (`.m3u8`), and adaptive video streams.
   - Native Messaging stdio host protocol connecting to Tauri application.

3. **Desktop Shell (`src/` & `src-tauri/`):**
   - GPN-Style centered frameless window with close 'X', minimize, and drag regions.
   - System tray docking with dynamic progress icon states.

4. **In-Process OTA Release Pipeline (`scripts/ship.mjs`):**
   - Targets GPHost Cloudflare R2 bucket (`downex/` folder).
   - Encrypted container `update<version>.downex.bin` signed with Minisign Ed25519 (`.tauri/downex.key`).
   - Base installer `v0.0.0` is permanently immutable. Releases start at `0.1.0+`.
