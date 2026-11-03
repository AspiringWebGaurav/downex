/**
 * @file background.js
 * @package Downex — Enterprise Download Accelerator Companion (MV3)
 * @author Gaurav Patil <AspiringWebGaurav>
 * @license MIT
 * @copyright Copyright (c) 2026 Gaurav Patil. All rights reserved.
 * @description Lightweight, air-gapped service worker for Downex.
 *              Intercepts browser downloads, context-menu links, and clicks,
 *              bridging them to the local Downex engine via 127.0.0.1:18888.
 *              Dynamically grabs links when Downex is running, and falls back
 *              cleanly to native browser downloads when Downex is closed.
 * @security Zero cloud telemetry. No external network requests. Air-gapped local loopback only.
 */

const DOWNEX_BRIDGE_URL = 'http://127.0.0.1:18888';
let cachedAuthToken = null;
let isDesktopRunning = false;

// Sets to track fallback URLs/IDs and prevent infinite re-interception loops
const bypassedUrls = new Set();
const bypassedDownloadIds = new Set();

function isBypassed(id, url) {
  if (id && bypassedDownloadIds.has(id)) return true;
  if (url && bypassedUrls.has(url)) return true;
  return false;
}

function addBypass(id, url) {
  if (id) {
    bypassedDownloadIds.add(id);
    setTimeout(() => bypassedDownloadIds.delete(id), 60000);
  }
  if (url) {
    bypassedUrls.add(url);
    setTimeout(() => bypassedUrls.delete(url), 60000);
  }
}

// Enable browser native download UI (bubble and shelf) when Downex Desktop is not running
function enableBrowserDownloadUI() {
  try {
    if (chrome.downloads?.setUiOptions) {
      chrome.downloads.setUiOptions({ enabled: true }).catch(() => {});
    }
  } catch (_) {}
  try {
    if (chrome.downloads?.setShelfEnabled) {
      chrome.downloads.setShelfEnabled(true);
    }
  } catch (_) {}
}

// Suppress native browser download UI (bubble and shelf) when Downex Desktop is running (IDM pattern)
function disableBrowserDownloadUI() {
  try {
    if (chrome.downloads?.setUiOptions) {
      chrome.downloads.setUiOptions({ enabled: false }).catch(() => {});
    }
  } catch (_) {}
  try {
    if (chrome.downloads?.setShelfEnabled) {
      chrome.downloads.setShelfEnabled(false);
    }
  } catch (_) {}
}

// Updates desktop running state and synchronizes to local storage for content scripts
function setDesktopRunning(running) {
  if (isDesktopRunning === running) return;
  isDesktopRunning = running;
  try {
    chrome.storage?.local?.set({ isDownexRunning: running }).catch(() => {});
  } catch (_) {}

  if (running) {
    disableBrowserDownloadUI();
  } else {
    cachedAuthToken = null;
    enableBrowserDownloadUI();
  }
}

// Query local Downex Desktop bridge to verify whether app is running
async function checkDesktopHealth() {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 1000);
    const r = await fetch(`${DOWNEX_BRIDGE_URL}/api/ping`, {
      method: 'GET',
      cache: 'no-store',
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (r.ok) {
      const data = await r.json().catch(() => ({}));
      const token = data.token || data.data?.token;
      if (token) cachedAuthToken = token;
      setDesktopRunning(true);
      return true;
    }
  } catch (_) {}

  cachedAuthToken = null;
  setDesktopRunning(false);
  return false;
}

// Perform initial health check immediately
checkDesktopHealth();
chrome.runtime.onStartup.addListener(checkDesktopHealth);
chrome.runtime.onInstalled.addListener(checkDesktopHealth);

// Periodic keep-alive ping when service worker is active
setInterval(checkDesktopHealth, 4000);

// Use alarms for periodic check across service worker sleep cycles
try {
  chrome.alarms?.create('desktop-health-check', { periodInMinutes: 0.5 });
  chrome.alarms?.onAlarm.addListener((alarm) => {
    if (alarm.name === 'desktop-health-check') {
      checkDesktopHealth();
    }
  });
} catch (_) {}

// Proactively check health when tabs navigate, activate, or window gains focus
try {
  chrome.tabs?.onActivated.addListener(() => {
    checkDesktopHealth();
  });
  chrome.tabs?.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
      checkDesktopHealth();
    }
  });
  chrome.windows?.onFocusChanged?.addListener(() => {
    checkDesktopHealth();
  });
} catch (_) {}

async function getBridgeToken() {
  if (cachedAuthToken) return cachedAuthToken;
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 1200);
    const r = await fetch(`${DOWNEX_BRIDGE_URL}/api/ping`, {
      method: 'GET',
      cache: 'no-store',
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (r.ok) {
      const data = await r.json();
      const token = data.token || data.data?.token;
      if (token) {
        cachedAuthToken = token;
        setDesktopRunning(true);
        return token;
      }
    }
  } catch (_) {}
  cachedAuthToken = null;
  setDesktopRunning(false);
  return null;
}

// Fall back to native browser download when Downex Desktop is not running
async function fallbackToBrowserDownload(url, filename, tabId) {
  if (!url) return false;
  addBypass(null, url);
  enableBrowserDownloadUI();

  return new Promise((resolve) => {
    try {
      const options = { url, saveAs: false };
      if (filename) options.filename = filename;

      chrome.downloads.download(options, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.warn('[Downex Fallback] chrome.downloads.download failed:', chrome.runtime.lastError.message);
          // If downloads API failed (e.g., scheme or sandbox restriction), instruct tab to navigate
          if (tabId) {
            chrome.tabs.sendMessage(tabId, {
              type: 'BROWSER_DOWNLOAD_FALLBACK',
              url,
              filename,
            }).catch(() => {});
          }
          resolve(false);
        } else {
          if (downloadId) addBypass(downloadId, url);
          resolve(true);
        }
      });
    } catch (e) {
      console.warn('[Downex Fallback] Exception triggering browser fallback:', e);
      if (tabId) {
        chrome.tabs.sendMessage(tabId, {
          type: 'BROWSER_DOWNLOAD_FALLBACK',
          url,
          filename,
        }).catch(() => {});
      }
      resolve(false);
    }
  });
}

// Send download payload to Downex Desktop bridge
async function sendToDownex(payload) {
  try {
    const token = await getBridgeToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['X-Downex-Token'] = token;
    }

    const bodyData = {
      url: payload.url,
      filename: payload.filename || undefined,
      referer: payload.referer || undefined,
      cookies: payload.cookies || undefined,
      user_agent: navigator.userAgent,
      show_dialog: true,
    };

    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 2500);

    let resp = await fetch(`${DOWNEX_BRIDGE_URL}/api/download`, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyData),
      signal: ctrl.signal,
    });
    clearTimeout(tid);

    if (resp.status === 401) {
      cachedAuthToken = null;
      const freshToken = await getBridgeToken();
      if (freshToken) {
        headers['Authorization'] = `Bearer ${freshToken}`;
        headers['X-Downex-Token'] = freshToken;
        const ctrl2 = new AbortController();
        const tid2 = setTimeout(() => ctrl2.abort(), 2500);
        resp = await fetch(`${DOWNEX_BRIDGE_URL}/api/download`, {
          method: 'POST',
          headers,
          body: JSON.stringify(bodyData),
          signal: ctrl2.signal,
        });
        clearTimeout(tid2);
      }
    }

    if (resp.ok) {
      setDesktopRunning(true);
      return true;
    }
    return false;
  } catch (err) {
    cachedAuthToken = null;
    setDesktopRunning(false);
    return false;
  }
}

// 1. Toolbar Action: Clicking the icon focuses/opens Downex Desktop or checks health
chrome.action.onClicked.addListener(async () => {
  const isHealthy = await checkDesktopHealth();
  if (isHealthy) {
    try {
      const token = await getBridgeToken();
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      await fetch(`${DOWNEX_BRIDGE_URL}/api/ping`, { method: 'GET', headers });
    } catch (_) {}
  }
});

// 2. Context Menu: "Download with Downex"
chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'downex-download-link',
        title: 'Download with Downex',
        contexts: ['link', 'image', 'video', 'audio'],
      });
    });
  } catch (_) {}
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const targetUrl = info.linkUrl || info.srcUrl;
  if (!targetUrl) return;

  // If Downex Desktop is not running, fall back directly to browser download
  if (!isDesktopRunning) {
    await fallbackToBrowserDownload(targetUrl, undefined, tab?.id);
    return;
  }

  let cookiesStr = '';
  try {
    const cookies = await chrome.cookies.getAll({ url: targetUrl });
    if (cookies && cookies.length > 0) {
      cookiesStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    }
  } catch (_) {}

  const success = await sendToDownex({
    url: targetUrl,
    referer: tab?.url,
    cookies: cookiesStr,
  });

  if (!success) {
    // Desktop was not running or failed -> fall back to browser download!
    await fallbackToBrowserDownload(targetUrl, undefined, tab?.id);
  }
});

// 3. Early OnCreated Download Interception
chrome.downloads.onCreated.addListener((downloadItem) => {
  if (!downloadItem || !downloadItem.url) return;
  const url = downloadItem.url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return;

  // If bypassed or Downex Desktop is not running:
  // DO NOT pause, DO NOT suppress browser download UI!
  if (isBypassed(downloadItem.id, url) || !isDesktopRunning) {
    enableBrowserDownloadUI();
    return;
  }

  disableBrowserDownloadUI();

  // Immediately pause the browser download to suppress any download bubble/animation
  try {
    chrome.downloads.pause(downloadItem.id, () => {
      if (chrome.runtime.lastError) {}
    });
  } catch (_) {}
});

// 4. Authoritative onDeterminingFilename Download Interception
const handledDownloadIds = new Set();
const recentUrls = new Map();

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  if (!downloadItem || !downloadItem.url) return;

  const url = downloadItem.url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return;

  // If this download was triggered as a browser fallback, or if Downex is not running:
  if (isBypassed(downloadItem.id, url) || !isDesktopRunning) {
    enableBrowserDownloadUI();
    try {
      if (downloadItem.filename) {
        suggest({ filename: downloadItem.filename });
      } else {
        suggest();
      }
    } catch (_) {}
    return;
  }

  if (handledDownloadIds.has(downloadItem.id)) {
    return;
  }

  // Deduplicate rapid triggers (within 3 seconds)
  const now = Date.now();
  for (const [u, ts] of recentUrls.entries()) {
    if (now - ts > 3000) recentUrls.delete(u);
  }
  if (recentUrls.has(url)) {
    try {
      chrome.downloads.cancel(downloadItem.id, () => {
        chrome.downloads.erase({ id: downloadItem.id });
      });
    } catch (_) {}
    return;
  }
  recentUrls.set(url, now);
  handledDownloadIds.add(downloadItem.id);

  // Prevent memory leak by bounding handled IDs
  if (handledDownloadIds.size > 1000) {
    handledDownloadIds.clear();
  }

  (async () => {
    let cookiesStr = '';
    try {
      const cookies = await chrome.cookies.getAll({ url });
      if (cookies && cookies.length > 0) {
        cookiesStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      }
    } catch (_) {}

    const success = await sendToDownex({
      url,
      filename: downloadItem.filename || undefined,
      referer: downloadItem.referrer || undefined,
      cookies: cookiesStr,
    });

    if (success) {
      try {
        await chrome.downloads.cancel(downloadItem.id);
        await chrome.downloads.erase({ id: downloadItem.id });
      } catch (_) {}
    } else {
      // Fallback: If Downex desktop is not running, resume normal browser download
      addBypass(downloadItem.id, url);
      recentUrls.delete(url);
      setDesktopRunning(false);
      enableBrowserDownloadUI();
      try {
        await chrome.downloads.resume(downloadItem.id);
      } catch (_) {}
      try {
        if (downloadItem.filename) {
          suggest({ filename: downloadItem.filename });
        } else {
          suggest();
        }
      } catch (_) {}
    }
  })();

  return true;
});

// 5. Content Script Link-Click and Bypass Message Interceptor
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'BYPASS_URL' && message.url) {
    addBypass(null, message.url);
    enableBrowserDownloadUI();
    sendResponse({ bypassed: true });
    return true;
  }

  if (message.type === 'INTERCEPT_LINK_CLICK' && message.url) {
    (async () => {
      // If we already know Downex Desktop is not running, immediately fall back to browser download
      if (!isDesktopRunning) {
        const handled = await fallbackToBrowserDownload(message.url, message.filename, sender.tab?.id);
        sendResponse({ success: false, handledByBrowser: handled });
        return;
      }

      let cookiesStr = '';
      try {
        const cookies = await chrome.cookies.getAll({ url: message.url });
        if (cookies && cookies.length > 0) {
          cookiesStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
        }
      } catch (_) {}

      const success = await sendToDownex({
        url: message.url,
        filename: message.filename,
        referer: message.referer || sender.tab?.url,
        cookies: cookiesStr,
      });

      if (!success) {
        // Desktop is not running or rejected -> fallback to browser download!
        const handled = await fallbackToBrowserDownload(message.url, message.filename, sender.tab?.id);
        sendResponse({ success: false, handledByBrowser: handled });
      } else {
        sendResponse({ success: true, handledByBrowser: false });
      }
    })();
    return true;
  }
});
