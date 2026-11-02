/**
 * @file background.js
 * @package Downex — Enterprise Download Accelerator Companion (MV3)
 * @author Gaurav Patil <AspiringWebGaurav>
 * @license MIT
 * @copyright Copyright (c) 2026 Gaurav Patil. All rights reserved.
 * @description Lightweight, air-gapped service worker for Downex.
 *              Intercepts browser downloads, context-menu links, and clicks,
 *              bridging them to the local Downex engine via 127.0.0.1:18888.
 *              Cleanly suppresses Chrome/Edge browser download shelf & bubble.
 * @security Zero cloud telemetry. No external network requests. Air-gapped local loopback only.
 */

const DOWNEX_BRIDGE_URL = 'http://127.0.0.1:18888';
let cachedAuthToken = null;

// Suppress native browser download UI (bubble and shelf) completely (REA IDM pattern)
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

// Ensure browser download UI is disabled on startup and install
disableBrowserDownloadUI();
chrome.runtime.onStartup.addListener(disableBrowserDownloadUI);
chrome.runtime.onInstalled.addListener(disableBrowserDownloadUI);

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
        return token;
      }
    }
  } catch (_) {}
  return null;
}

// Send download to Downex Desktop
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

    let resp = await fetch(`${DOWNEX_BRIDGE_URL}/api/download`, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyData),
    });

    if (resp.status === 401) {
      cachedAuthToken = null;
      const freshToken = await getBridgeToken();
      if (freshToken) {
        headers['Authorization'] = `Bearer ${freshToken}`;
        headers['X-Downex-Token'] = freshToken;
        resp = await fetch(`${DOWNEX_BRIDGE_URL}/api/download`, {
          method: 'POST',
          headers,
          body: JSON.stringify(bodyData),
        });
      }
    }

    return resp.ok;
  } catch (err) {
    console.warn('[Downex Bridge] Desktop engine unreachable on 127.0.0.1:18888:', err.message);
    return false;
  }
}

// 1. Toolbar Action: Clicking the icon focuses/opens Downex Desktop
chrome.action.onClicked.addListener(async () => {
  try {
    const token = await getBridgeToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    await fetch(`${DOWNEX_BRIDGE_URL}/api/ping`, { method: 'GET', headers });
  } catch (_) {}
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

  let cookiesStr = '';
  try {
    const cookies = await chrome.cookies.getAll({ url: targetUrl });
    if (cookies && cookies.length > 0) {
      cookiesStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    }
  } catch (_) {}

  await sendToDownex({
    url: targetUrl,
    referer: tab?.url,
    cookies: cookiesStr,
  });
});

// 3. Early OnCreated Download Interception (Immediately pause to prevent browser UI)
chrome.downloads.onCreated.addListener((downloadItem) => {
  if (!downloadItem || !downloadItem.url) return;
  const url = downloadItem.url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return;

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
  if (!downloadItem || !downloadItem.url || handledDownloadIds.has(downloadItem.id)) {
    return;
  }

  const url = downloadItem.url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return;

  disableBrowserDownloadUI();

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
      try {
        await chrome.downloads.resume(downloadItem.id);
      } catch (_) {}
      try {
        suggest();
      } catch (_) {}
    }
  })();

  return true;
});

// 5. Content Script Link-Click Message Interceptor
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'INTERCEPT_LINK_CLICK' && message.url) {
    (async () => {
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

      sendResponse({ success });
    })();
    return true;
  }
});
