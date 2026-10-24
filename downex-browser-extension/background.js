/**
 * @file background.js
 * @package Downex — Enterprise Download Accelerator Companion (MV3)
 * @author Gaurav Patil <AspiringWebGaurav>
 * @license MIT
 * @copyright Copyright (c) 2026 Gaurav Patil. All rights reserved.
 * @description High-performance, lifecycle-optimized service worker for Downex.
 *              Intercepts browser downloads, extracts cookies/headers, and bridges
 *              to the local Downex engine via air-gapped 127.0.0.1:18888 loopback.
 * @security Zero cloud telemetry. No external network transmission. All data local.
 */

const DOWNEX_BRIDGE_URL = 'http://127.0.0.1:18888';
const CACHE_TTL_MS = 5000;

// Default configuration schema
const DEFAULT_CONFIG = {
  interceptDownloads: true,
  enableMediaGrabber: true,
  showNotifications: false,
  minFileSizeForIntercept: 1048576, // 1MB minimum
  ignoredExtensions: ['html', 'htm', 'php', 'asp', 'jsp', 'json', 'xml', 'js', 'css', 'torrent'],
};

// In-memory runtime state (ephemeral, refreshed per lifecycle activation)
let engineStatusCache = {
  isAlive: false,
  lastChecked: 0,
  version: null,
};

// Tab media metadata cache (tabId -> { count, quality, title })
const tabMediaMap = new Map();

/* =========================================================================
   1. LIFECYCLE MANAGEMENT: INSTALLATION, STARTUP & CONTEXT MENUS
   ========================================================================= */

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'downex-download-link',
      title: 'Download with Downex',
      contexts: ['link'],
    });

    chrome.contextMenus.create({
      id: 'downex-download-media',
      title: 'Download Media with Downex',
      contexts: ['video', 'audio', 'image'],
    });

    chrome.contextMenus.create({
      id: 'downex-grab-page-links',
      title: 'Download All Links on Page with Downex',
      contexts: ['page'],
    });
  });
}

// Lifecycle: Fresh Install or Unpacked Extension Reload in Dev Mode
chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.local.get(['config'], (result) => {
    if (!result.config) {
      chrome.storage.local.set({ config: DEFAULT_CONFIG });
    } else {
      chrome.storage.local.set({ config: { ...DEFAULT_CONFIG, ...result.config } });
    }
  });

  setupContextMenus();
  refreshEngineStatus(true);
});

// Lifecycle: Browser Startup
chrome.runtime.onStartup.addListener(() => {
  setupContextMenus();
  refreshEngineStatus(true);
});

/* =========================================================================
   2. CONTEXT MENU ACTIONS
   ========================================================================= */

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.linkUrl || info.srcUrl;
  if (info.menuItemId === 'downex-download-link' || info.menuItemId === 'downex-download-media') {
    if (url) {
      await handoffToDownex({
        url,
        referer: tab?.url,
      });
    }
  } else if (info.menuItemId === 'downex-grab-page-links' && tab?.id) {
    try {
      chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_ALL_LINKS' });
    } catch (e) {
      console.warn('[Downex] Failed to message tab for link extraction:', e);
    }
  }
});

/* =========================================================================
   3. ENGINE PING & STATUS HEARTBEAT WITH FAST CACHING
   ========================================================================= */

async function pingDownexEngine(force = false) {
  const now = Date.now();
  if (!force && now - engineStatusCache.lastChecked < CACHE_TTL_MS) {
    return engineStatusCache.isAlive;
  }

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 600); // 600ms fast abort
    const resp = await fetch(`${DOWNEX_BRIDGE_URL}/api/ping`, {
      method: 'GET',
      signal: ctrl.signal,
    });
    clearTimeout(timeout);

    if (resp.ok) {
      const data = await resp.json();
      engineStatusCache = {
        isAlive: data && data.success === true,
        lastChecked: now,
        version: data?.data?.version || '0.0.0',
      };
    } else {
      engineStatusCache = { isAlive: false, lastChecked: now, version: null };
    }
  } catch (err) {
    engineStatusCache = { isAlive: false, lastChecked: now, version: null };
  }

  return engineStatusCache.isAlive;
}

async function refreshEngineStatus(force = false) {
  const isAlive = await pingDownexEngine(force);
  if (isAlive) {
    chrome.action.setTitle({
      title: `Downex: Desktop Engine Connected (v${engineStatusCache.version || '0.0.0'})`,
    });
  } else {
    chrome.action.setTitle({
      title: 'Downex: Desktop App Not Connected (Launch Downex to enable acceleration)',
    });
  }
  return isAlive;
}

/* =========================================================================
   4. BROWSER DOWNLOAD INTERCEPTION (onDeterminingFilename & onCreated)
   ========================================================================= */

// Track intercepted download IDs to prevent duplicate triggers
const handledDownloadIds = new Set();

async function handleDownloadInterception(downloadItem, isDeterminingFilename = false) {
  if (!downloadItem || !downloadItem.id) return false;
  if (handledDownloadIds.has(downloadItem.id)) return false;

  const { config } = await chrome.storage.local.get(['config']);
  const currentConfig = { ...DEFAULT_CONFIG, ...(config || {}) };

  if (!currentConfig.interceptDownloads) {
    return false;
  }

  const targetUrl = downloadItem.finalUrl || downloadItem.url;
  if (!targetUrl || targetUrl.startsWith('blob:') || targetUrl.startsWith('data:') || targetUrl.startsWith('filesystem:') || targetUrl.startsWith('chrome-extension:')) {
    return false;
  }

  // Resolve filename from downloadItem or URL
  const rawFilename = downloadItem.filename ? downloadItem.filename.split(/[\\/]/).pop() : targetUrl.split('?')[0].split('/').pop();
  const filename = rawFilename && rawFilename.trim().length > 0 ? rawFilename.trim() : 'download.bin';
  const extension = filename.split('.').pop()?.toLowerCase();

  // Web pages, HTML, and script files should not be intercepted as downloads
  const isWebPageMime = downloadItem.mime && (downloadItem.mime.includes('text/html') || downloadItem.mime.includes('application/xhtml'));
  if (isWebPageMime || (extension && currentConfig.ignoredExtensions.includes(extension))) {
    return false;
  }

  // Quick cached engine status check (prevents hanging the browser download if Downex is closed)
  const isAlive = await pingDownexEngine();
  if (!isAlive) {
    return false;
  }

  handledDownloadIds.add(downloadItem.id);
  if (handledDownloadIds.size > 200) {
    const first = handledDownloadIds.values().next().value;
    handledDownloadIds.delete(first);
  }

  // Dual-stage Cookie Extraction (targetUrl + initial downloadItem.url + Referrer URL)
  let cookiesHeader = '';
  try {
    const cookies = await chrome.cookies.getAll({ url: targetUrl });
    cookiesHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

    if (!cookiesHeader && downloadItem.url && downloadItem.url !== targetUrl) {
      const initCookies = await chrome.cookies.getAll({ url: downloadItem.url });
      cookiesHeader = initCookies.map((c) => `${c.name}=${c.value}`).join('; ');
    }

    if (!cookiesHeader && downloadItem.referrer) {
      const refCookies = await chrome.cookies.getAll({ url: downloadItem.referrer });
      cookiesHeader = refCookies.map((c) => `${c.name}=${c.value}`).join('; ');
    }
  } catch (e) {
    console.warn('[Downex] Cookie extraction notice:', e);
  }

  const payload = {
    url: targetUrl,
    filename: filename || undefined,
    cookies: cookiesHeader || undefined,
    referer: downloadItem.referrer || downloadItem.url || undefined,
    user_agent: navigator.userAgent,
    show_dialog: true,
  };

  const success = await sendDownloadRequest(payload);
  if (success) {
    // Cancel and purge slow browser single-threaded download
    try {
      await chrome.downloads.cancel(downloadItem.id);
      await chrome.downloads.erase({ id: downloadItem.id });
    } catch (e) {
      // Ignored if already cleaned
    }
    return true;
  } else {
    handledDownloadIds.delete(downloadItem.id);
    return false;
  }
}

// 1. Primary Hook: onDeterminingFilename has the final resolved redirect URL, MIME type & real filename
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  handleDownloadInterception(downloadItem, true).then((intercepted) => {
    if (!intercepted) {
      suggest();
    }
  });
  return true; // asynchronous suggest
});

// 2. Fast Fallback Hook: onCreated for instant direct file URL interception
chrome.downloads.onCreated.addListener(async (downloadItem) => {
  const url = downloadItem.url || downloadItem.finalUrl;
  if (!url) return;
  const cleanUrl = url.split('?')[0];
  const ext = cleanUrl.split('.').pop()?.toLowerCase();
  const DIRECT_DOWNLOAD_EXTS = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'iso', 'exe', 'msi', 'apk', 'dmg', 'mp4', 'mkv', 'avi'];
  if (ext && DIRECT_DOWNLOAD_EXTS.includes(ext)) {
    await handleDownloadInterception(downloadItem, false);
  }
});

/* =========================================================================
   5. EXTENSION MESSAGING BUS
   ========================================================================= */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 1. Engine Connectivity Check
  if (message.type === 'PING_ENGINE') {
    pingDownexEngine(true).then((isAlive) => {
      sendResponse({ isAlive, version: engineStatusCache.version });
    });
    return true;
  }

  // 2. Direct Download Handoff
  if (message.type === 'SEND_DOWNLOAD') {
    handoffToDownex(message.data).then((res) => sendResponse(res));
    return true;
  }

  // 3. Adaptive Video/Audio Handoff (YouTube / DASH / HLS)
  if (message.type === 'SEND_ADAPTIVE_MEDIA') {
    sendAdaptiveMediaRequest(message.data).then((res) => sendResponse(res));
    return true;
  }

  // 4. Media Detected by Content Script on a Tab
  if (message.type === 'MEDIA_DETECTED') {
    const tabId = sender.tab?.id;
    if (tabId && message.data) {
      tabMediaMap.set(tabId, message.data);
      updateTabBadge(tabId, message.data);
    }
    sendResponse({ received: true });
    return false;
  }

  // 5. Get Active Tab Cookies
  if (message.type === 'GET_TAB_COOKIES') {
    const targetUrl = message.url || sender.tab?.url;
    if (targetUrl) {
      chrome.cookies.getAll({ url: targetUrl }, (cookies) => {
        const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
        sendResponse({ cookies: cookieString });
      });
      return true;
    }
    sendResponse({ cookies: '' });
    return false;
  }

  // 6. Get Desktop Engine Status Details
  if (message.type === 'GET_ENGINE_DETAILS') {
    fetch(`${DOWNEX_BRIDGE_URL}/api/status`)
      .then((r) => r.json())
      .then((data) => sendResponse({ success: true, data: data.data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// Update Action Badge per Tab (shows HD/4K/count)
function updateTabBadge(tabId, mediaData) {
  try {
    if (!mediaData || mediaData.count === 0) {
      chrome.action.setBadgeText({ text: '', tabId });
      return;
    }

    const badgeText = mediaData.topQuality || String(mediaData.count);
    chrome.action.setBadgeText({ text: badgeText, tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#8b5cf6', tabId });
  } catch (e) {
    // Tab might be closing
  }
}

// Clean up closed tabs from memory
chrome.tabs.onRemoved.addListener((tabId) => {
  tabMediaMap.delete(tabId);
});

// Tab switched - refresh badge
chrome.tabs.onActivated.addListener((activeInfo) => {
  const media = tabMediaMap.get(activeInfo.tabId);
  if (media) {
    updateTabBadge(activeInfo.tabId, media);
  }
});

/* =========================================================================
   6. BRIDGE HTTP COMMUNICATION HELPERS
   ========================================================================= */

async function sendDownloadRequest(payload) {
  try {
    const resp = await fetch(`${DOWNEX_BRIDGE_URL}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    return data && data.success === true;
  } catch (err) {
    console.error('[Downex] Failed to send download to engine:', err);
    return false;
  }
}

async function sendAdaptiveMediaRequest(payload) {
  try {
    const resp = await fetch(`${DOWNEX_BRIDGE_URL}/api/download-adaptive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await resp.json();
  } catch (err) {
    console.error('[Downex] Failed to send adaptive media:', err);
    return { success: false, error: err.message };
  }
}

async function handoffToDownex(item) {
  let cookiesHeader = item.cookies || '';
  if (!cookiesHeader && item.url) {
    try {
      const cookies = await chrome.cookies.getAll({ url: item.url });
      cookiesHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      if (!cookiesHeader && item.referer) {
        const refCookies = await chrome.cookies.getAll({ url: item.referer });
        cookiesHeader = refCookies.map((c) => `${c.name}=${c.value}`).join('; ');
      }
    } catch (e) {}
  }

  const payload = {
    url: item.url,
    filename: item.filename,
    cookies: cookiesHeader || undefined,
    referer: item.referer,
    user_agent: navigator.userAgent,
    destination_folder: item.destinationFolder,
    queue_id: item.queue_id,
    download_later: item.download_later,
  };

  const success = await sendDownloadRequest(payload);
  if (success && item.showToast !== false) {
    try {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Downex Download Added',
        message: item.filename ? `Queued: ${item.filename}` : 'Download queued successfully',
        silent: true,
      });
    } catch (e) {}
  }
  return success;
}
