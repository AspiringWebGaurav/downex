# Downex Browser Extension (MV3)

High-performance browser companion for the **Downex** Windows Download Manager.

## Features vs IDM Comparison

| Feature | Internet Download Manager (IDM) | Downex Browser Extension |
|---|---|---|
| **Media Grabber** | Flickering Win32 layered overlay that drifts when scrolling | In-DOM Shadow-DOM floating pill smoothly anchored to HTML5 video/audio |
| **YouTube 1080p/4K** | Frequently breaks when YouTube changes scripts; requires assembly | Automatic DASH/HLS adaptive stream sniffer (video + audio itags separation) |
| **Browser Interception** | Hooks deep Windows network driver | Clean `chrome.downloads.onCreated` interceptor with full cookie preservation |
| **Bridge Communication** | Fragile COM/Registry dependency | Dual Mode: Loopback HTTP (`127.0.0.1:18888`) + Native Messaging (`stdio`) |
| **UI Aesthetics** | Legacy 1990s Win32 dialogs | Sleek glassmorphism / GPN centered dark mode matching desktop shell |

---

## Installation Guide

### 1. Load Unpacked in Chrome / Edge / Brave
1. Open `chrome://extensions` or `edge://extensions` in your browser.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the `c:\GITHUB\downex\downex-browser-extension\` folder.

### 2. Optional: Register Native Messaging Host
- Double-click `install-host.bat` to register the host manifest in the Windows Registry for Chrome, Edge, and Brave.
- Note: Downex also automatically serves the loopback bridge on `http://127.0.0.1:18888`, allowing immediate zero-configuration operation.

---

## Enterprise Specification & Developer Information

- **Developer / Maintainer:** Gaurav Patil ([@AspiringWebGaurav](https://github.com/AspiringWebGaurav))
- **Project Repository:** [github.com/AspiringWebGaurav/downex](https://github.com/AspiringWebGaurav/downex)
- **License:** MIT License ([LICENSE](LICENSE))
- **Security & Privacy:**
  - **Zero Telemetry:** Downex does not transmit cookies, URLs, browsing history, or file data to any remote server or third party.
  - **Air-Gapped Communication:** All bridge calls run over strict local loopback on `http://127.0.0.1:18888`.
  - **Memory Safety:** Scoped Shadow-DOM sandbox prevents CSS pollution of web pages, and WeakMaps prevent DOM memory leaks.

