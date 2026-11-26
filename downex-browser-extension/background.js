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
let hasCompletedHealthCheck = false;
let activeHealthCheckPromise = null;

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

async function saveSessionToken(token) {
  cachedAuthToken = token || null;
  try {
    if (chrome.storage?.session) {
      if (token) {
        await chrome.storage.session.set({ bridgeAuthToken: token });
      } else {
        await chrome.storage.session.remove(['bridgeAuthToken']);
      }
    }
  } catch (_) {}
}

async function loadSessionToken() {
  if (cachedAuthToken) return cachedAuthToken;
  try {
    if (chrome.storage?.session) {
      const res = await chrome.storage.session.get(['bridgeAuthToken']);
      if (res?.bridgeAuthToken) {
        cachedAuthToken = res.bridgeAuthToken;
        return cachedAuthToken;
      }
    }
  } catch (_) {}
  return null;
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
  const changed = isDesktopRunning !== running;
  isDesktopRunning = running;
  if (changed) {
    try {
      chrome.storage?.local?.set({ isDownexRunning: running }).catch(() => {});
    } catch (_) {}
  }

  if (running) {
    disableBrowserDownloadUI();
  } else {
    void saveSessionToken(null);
    enableBrowserDownloadUI();
  }
}

// Fetch bridge auth token using POST /api/handshake so Chromium always includes Origin: chrome-extension://<id>
async function fetchHandshakeToken() {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 1200);
    const r = await fetch(`${DOWNEX_BRIDGE_URL}/api/handshake`, {
      method: 'POST',
      cache: 'no-store',
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (r.ok) {
      const data = await r.json().catch(() => ({}));
      const token = data.token || data.data?.token;
      if (token) {
        await saveSessionToken(token);
        return token;
      }
    }
  } catch (_) {}
  return null;
}

// Query local Downex Desktop bridge to verify whether app is running
async function checkDesktopHealth() {
  if (activeHealthCheckPromise) return activeHealthCheckPromise;

  activeHealthCheckPromise = (async () => {
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
        let token = data.token || data.data?.token;
        if (token) {
          await saveSessionToken(token);
        } else if (!cachedAuthToken) {
          await fetchHandshakeToken();
        }
        setDesktopRunning(true);
        hasCompletedHealthCheck = true;
        return true;
      }
    } catch (_) {}

    setDesktopRunning(false);
    hasCompletedHealthCheck = true;
    return false;
  })().finally(() => {
    activeHealthCheckPromise = null;
  });

  return activeHealthCheckPromise;
}

// Hydrate cached state immediately on service-worker wake-up before initial ping finishes
try {
  chrome.storage?.local?.get(['isDownexRunning'], (res) => {
    if (!hasCompletedHealthCheck && typeof res?.isDownexRunning === 'boolean') {
      isDesktopRunning = res.isDownexRunning;
    }
  });
} catch (_) {}
void loadSessionToken();

// Perform initial health check immediately
const initialHealthCheckPromise = checkDesktopHealth();
chrome.runtime.onStartup.addListener(() => { void checkDesktopHealth(); });
chrome.runtime.onInstalled.addListener(() => { void checkDesktopHealth(); });

// Periodic keep-alive ping when service worker is active
setInterval(() => { void checkDesktopHealth(); }, 4000);

// Use alarms for periodic check across service worker sleep cycles
try {
  chrome.alarms?.create('desktop-health-check', { periodInMinutes: 0.5 });
  chrome.alarms?.onAlarm.addListener((alarm) => {
    if (alarm.name === 'desktop-health-check') {
      void checkDesktopHealth();
    }
  });
} catch (_) {}

// Proactively check health when tabs navigate, activate, or window gains focus
try {
  chrome.tabs?.onActivated.addListener(() => {
    void checkDesktopHealth();
  });
  chrome.tabs?.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
      void checkDesktopHealth();
    }
  });
  chrome.windows?.onFocusChanged?.addListener(() => {
    void checkDesktopHealth();
  });
} catch (_) {}

async function getBridgeToken(forceRefresh = false) {
  if (!forceRefresh) {
    const existing = await loadSessionToken();
    if (existing) return existing;
  } else {
    await saveSessionToken(null);
  }

  const handshakeToken = await fetchHandshakeToken();
  if (handshakeToken) {
    setDesktopRunning(true);
    return handshakeToken;
  }

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
      const data = await r.json().catch(() => ({}));
      const token = data.token || data.data?.token;
      if (token) {
        await saveSessionToken(token);
        setDesktopRunning(true);
        return token;
      }
    }
  } catch (_) {}

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
    const token = await getBridgeToken(false);
    if (!token) {
      return false;
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Downex-Token': token,
    };

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
      const freshToken = await getBridgeToken(true);
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
    setDesktopRunning(false);
    return false;
  }
}

// 1. Toolbar Action: Clicking the icon focuses/opens Downex Desktop or checks health
chrome.action.onClicked.addListener(async () => {
  const isHealthy = await checkDesktopHealth();
  if (isHealthy) {
    try {
      const token = await getBridgeToken(false);
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

  // Ensure live health state even if service worker just woke from sleep
  const healthy = await checkDesktopHealth();
  if (!healthy) {
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

  // If bypassed or Downex Desktop is known not to be running:
  // DO NOT pause, DO NOT suppress browser download UI!
  if (isBypassed(downloadItem.id, url) || !isDesktopRunning) {
    if (hasCompletedHealthCheck && !isDesktopRunning) {
      enableBrowserDownloadUI();
    }
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

function finishWithBrowserDownload(downloadItem, suggest) {
  enableBrowserDownloadUI();
  try {
    if (downloadItem.filename) {
      suggest({ filename: downloadItem.filename });
    } else {
      suggest();
    }
  } catch (_) {}
}

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  if (!downloadItem || !downloadItem.url) return;

  const url = downloadItem.url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return;

  // If this download was explicitly bypassed, or we have already verified Downex is offline:
  if (isBypassed(downloadItem.id, url) || (hasCompletedHealthCheck && !isDesktopRunning)) {
    finishWithBrowserDownload(downloadItem, suggest);
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
    // If the service worker just woke up, verify desktop health before deciding
    if (!hasCompletedHealthCheck || !isDesktopRunning) {
      const alive = await (hasCompletedHealthCheck ? checkDesktopHealth() : initialHealthCheckPromise);
      if (!alive) {
        addBypass(downloadItem.id, url);
        recentUrls.delete(url);
        try {
          await chrome.downloads.resume(downloadItem.id);
        } catch (_) {}
        finishWithBrowserDownload(downloadItem, suggest);
        return;
      }
    }

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
      try {
        await chrome.downloads.resume(downloadItem.id);
      } catch (_) {}
      finishWithBrowserDownload(downloadItem, suggest);
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
      // Verify live health state if service worker just woke up or status was stale
      const healthy = hasCompletedHealthCheck && isDesktopRunning
        ? true
        : await checkDesktopHealth();

      if (!healthy) {
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
