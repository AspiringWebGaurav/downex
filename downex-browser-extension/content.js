/**
 * @file content.js
 * @package Downex — Enterprise Download Accelerator Companion (MV3)
 * @author Gaurav Patil <AspiringWebGaurav>
 * @license MIT
 * @copyright Copyright (c) 2026 Gaurav Patil. All rights reserved.
 * @description Pure IDM-style direct link click interceptor.
 *              Catches clicks on downloadable file types and forwards to Downex Desktop.
 */

const DOWNLOAD_EXTENSIONS = new Set([
  // Archives & Compressed
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'z', 'iso', 'dmg', 'pkg',
  // Executables & Installers
  'exe', 'msi', 'apk', 'appimage', 'deb', 'rpm', 'bin', 'jar',
  // Video & Audio Media
  'mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv', 'm4v',
  'mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a', 'wma', 'opus',
  // Documents & eBooks
  'pdf', 'epub', 'mobi', 'azw3',
  // Virtual Machines & Disk Images
  'img', 'vmdk', 'qcow2', 'vdi', 'torrent'
]);

let lastClickedUrl = '';
let lastClickTime = 0;

document.addEventListener('click', (event) => {
  // 1. Bypass download manager if user holds Alt key (Standard IDM suppression shortcut)
  if (event.altKey) return;

  const anchor = event.target.closest('a');
  if (!anchor || !anchor.href) return;

  const href = anchor.href;
  if (!href.startsWith('http://') && !href.startsWith('https://')) return;

  // Check URL pathname or download attribute
  const hasDownloadAttr = anchor.hasAttribute('download');
  let ext = '';
  try {
    const parsed = new URL(href);
    const pathname = parsed.pathname;
    const dotIdx = pathname.lastIndexOf('.');
    if (dotIdx !== -1 && dotIdx < pathname.length - 1) {
      ext = pathname.slice(dotIdx + 1).toLowerCase();
    }
  } catch (_) {}

  if (hasDownloadAttr || DOWNLOAD_EXTENSIONS.has(ext)) {
    const now = Date.now();
    if (lastClickedUrl === href && now - lastClickTime < 1500) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    lastClickedUrl = href;
    lastClickTime = now;

    event.preventDefault();
    event.stopPropagation();

    const suggestedName = anchor.getAttribute('download') || anchor.textContent?.trim().slice(0, 100) || undefined;

    chrome.runtime.sendMessage({
      type: 'INTERCEPT_LINK_CLICK',
      url: href,
      filename: suggestedName,
      referer: window.location.href,
    });
  }
}, true);
