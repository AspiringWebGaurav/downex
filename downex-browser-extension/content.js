/**
 * @file content.js
 * @package Downex — Enterprise Download Accelerator Companion (MV3)
 * @author Gaurav Patil <AspiringWebGaurav>
 * @license MIT
 * @copyright Copyright (c) 2026 Gaurav Patil. All rights reserved.
 * @description Pure IDM-style direct link click interceptor with intelligent fallback.
 *              When Downex Desktop is running, forwards clicks on downloadable files.
 *              When Downex Desktop is not running, lets browser download natively without interference.
 */

const DOWNLOAD_EXTENSIONS = new Set([
  // Archives & Compressed (IDM standard set)
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'z', 'iso', 'dmg', 'pkg',
  'ace', 'arj', 'lzh', 'sea', 'sit', 'sitx', 'tgz', 'tbz2', 'txz', 'cab',
  // Executables & Installers
  'exe', 'msi', 'apk', 'appimage', 'deb', 'rpm', 'bin', 'jar', 'msu',
  'appxbundle', 'msixbundle',
  // Video & Audio Media (IDM standard set)
  'mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv', 'm4v', '3gp', 'asf',
  'divx', 'mpe', 'mpeg', 'mpg', 'ogv', 'qt', 'rm', 'rmvb', 'vob',
  'mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a', 'wma', 'opus', 'aif', 'aiff',
  'mid', 'midi', 'mpa', 'ra',
  // Documents & eBooks
  'pdf', 'epub', 'mobi', 'azw3', 'pptx', 'pps',
  // Virtual Machines & Disk Images
  'img', 'vmdk', 'qcow2', 'vdi', 'torrent'
]);

let isDownexRunning = false;
let lastClickedUrl = '';
let lastClickTime = 0;

// 1. Sync live desktop engine state from local extension storage
function syncDesktopStatus() {
  try {
    chrome.storage?.local?.get(['isDownexRunning'], (result) => {
      if (typeof result?.isDownexRunning === 'boolean') {
        isDownexRunning = result.isDownexRunning;
      }
    });
  } catch (_) {}
}

syncDesktopStatus();

try {
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes.isDownexRunning) {
      isDownexRunning = Boolean(changes.isDownexRunning.newValue);
    }
  });
} catch (_) {}

// Proactively re-verify status whenever the tab or window gains focus
window.addEventListener('focus', syncDesktopStatus);

/**
 * Triggers native browser download fallback if interception failed or desktop unreachable
 */
function triggerBrowserFallback(url, filename, target) {
  try {
    const a = document.createElement('a');
    a.href = url;
    if (filename) a.setAttribute('download', filename);
    if (target) a.target = target;
    a.setAttribute('data-downex-bypass', 'true');
    a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a);
    a.click();
    setTimeout(() => {
      try { a.remove(); } catch (_) {}
    }, 200);
  } catch (_) {
    window.location.assign(url);
  }
}

// 2. Listen for direct fallback navigation commands from background service worker
try {
  chrome.runtime?.onMessage?.addListener((message) => {
    if (message?.type === 'BROWSER_DOWNLOAD_FALLBACK' && message.url) {
      triggerBrowserFallback(message.url, message.filename);
    }
  });
} catch (_) {}

// 3. Capture-phase link click interceptor
document.addEventListener('click', (event) => {
  const anchor = event.target.closest('a');
  if (!anchor || !anchor.href) return;

  const href = anchor.href;
  if (!href.startsWith('http://') && !href.startsWith('https://')) return;

  // Bypass download manager if user holds Alt key (Standard IDM suppression shortcut)
  if (event.altKey) {
    try {
      chrome.runtime?.sendMessage?.({
        type: 'BYPASS_URL',
        url: href,
      });
    } catch (_) {}
    return;
  }

  // Bypass if anchor is explicitly tagged for browser native fallback
  if (anchor.hasAttribute('data-downex-bypass') || anchor.dataset?.downexBypass === 'true') {
    return;
  }

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
    // CRITICAL DYNAMIC BEHAVIOR:
    // If Downex Desktop is NOT running, DO NOT intercept!
    // Let browser perform its native link navigation and download naturally.
    if (!isDownexRunning) {
      return;
    }

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
    const anchorTarget = anchor.target || undefined;

    try {
      chrome.runtime.sendMessage({
        type: 'INTERCEPT_LINK_CLICK',
        url: href,
        filename: suggestedName,
        referer: window.location.href,
      }, (response) => {
        // If desktop failed or extension responded with fallback instruction
        if (chrome.runtime.lastError || !response || (!response.success && !response.handledByBrowser)) {
          isDownexRunning = false;
          triggerBrowserFallback(href, suggestedName, anchorTarget);
        }
      });
    } catch (_) {
      // If extension context invalidated or unreachable, trigger immediate browser fallback
      isDownexRunning = false;
      triggerBrowserFallback(href, suggestedName, anchorTarget);
    }
  }
}, true);
