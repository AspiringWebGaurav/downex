# Downex Browser Extension (Chrome, Edge & Brave)

Official browser companion for **Downex** — catches download links automatically and hands them off to the Downex Windows desktop app for fast multi-threaded downloading.

---

## How to Install (Load Unpacked — Takes 30 Seconds)

1. **Keep This Folder Extracted**
   - Make sure you extracted the `.zip` archive so this **`downex-browser-extension`** folder sits in a permanent location you won't accidentally delete (for example `Documents\downex-browser-extension`).
2. **Open Your Browser Extensions Page**
   - Google Chrome: open `chrome://extensions`
   - Microsoft Edge: open `edge://extensions`
   - Brave: open `brave://extensions`
3. **Enable Developer Mode**
   - Turn ON the **Developer mode** switch (top-right in Chrome/Brave, left sidebar in Edge).
4. **Click "Load unpacked"**
   - Click **Load unpacked** and select this **`downex-browser-extension`** folder (the folder containing `manifest.json` and this `README.md`).
   - Done! You should now see **Downex — Download Accelerator Companion** enabled in your extensions list.

---

## How It Works

- **When Downex Desktop Is Running:** Download clicks and browser file downloads are caught cleanly and sent straight to the Downex app over your local machine (`http://127.0.0.1:18888`) with full cookie and referer support.
- **When Downex Desktop Is Closed:** The extension stays completely out of your way and lets Chrome/Edge/Brave download files natively.
- **Bypass Any Single Link (`Alt + Click`):** Hold `Alt` while clicking any download link to let your browser handle that link directly instead of sending it to Downex.

---

## Privacy & Details

- **100% Local & Private:** Communicates only with the local Downex desktop bridge on `127.0.0.1:18888`. No analytics, no tracking, and no browsing history leaves your computer.
- **Supported Browsers:** Google Chrome, Microsoft Edge, Brave, and Chromium-based browsers (Manifest V3).
- **License:** MIT License ([LICENSE](LICENSE))
- **Official Website:** [https://downex.apps.gauravpatil.site](https://downex.apps.gauravpatil.site)
- **Portfolio:** [https://gauravpatil.site](https://gauravpatil.site)
- **Source Code:** [https://github.com/AspiringWebGaurav/downex](https://github.com/AspiringWebGaurav/downex)
