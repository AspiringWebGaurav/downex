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
const EXTENSION_VERSION = '0.0.0';
const EXTENSION_ARCH = 'base-release';

// Default configuration schema
const DEFAULT_CONFIG = {
  interceptDownloads: true,
  enableMediaGrabber: true,
  showInPlayerPill: true,
  showQualityBadge: true,
  altKeyBypass: true,
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

let cachedAuthToken = null;

// Tab media metadata cache (tabId -> { count, quality, title })
const tabMediaMap = new Map();

/* =========================================================================
   1. BRIDGE SECURITY & TOKEN HANDSHAKE
   ========================================================================= */

async function getBridgeToken(forceRefresh = false) {
  if (cachedAuthToken && !forceRefresh) {
    return cachedAuthToken;
  }

  // 1. Check local extension storage
  if (!forceRefresh) {
    try {
      const stored = await chrome.storage.local.get(['downex_auth_token']);
      if (stored && stored.downex_auth_token) {
        cachedAuthToken = stored.downex_auth_token;
        return cachedAuthToken;
      }
    } catch (_) { }
  }

  // 2. Query /api/ping or /api/handshake on loopback (< 1ms)
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 1200);
    const resp = await fetch(`${DOWNEX_BRIDGE_URL}/api/ping`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: ctrl.signal,
    });
    clearTimeout(timeout);

    if (resp.ok) {
      const data = await resp.json();

      // Modular Auto-Update: If Downex Desktop updated extension files on disk, reload immediately!
        if (data && data.should_reload_extension === true) {
          console.warn(`[Downex Extension] ⚡ Desktop engine signaled updated extension files on disk (${data.latest_extension_version || 'latest'}). Executing hot-reload...`);
          chrome.runtime.reload();
          return true;
        }
        const token = data?.token || data?.data?.token;
        if (data && data.success && token) {
          cachedAuthToken = token;
          chrome.storage.local.set({ downex_auth_token: cachedAuthToken });
          return cachedAuthToken;
        }
      }
    } catch (err) {
      // Desktop engine may not be running yet
    }

    // 3. Fallback to /api/handshake
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 1200);
      const resp = await fetch(`${DOWNEX_BRIDGE_URL}/api/handshake`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: ctrl.signal,
      });
      clearTimeout(timeout);

      if (resp.ok) {
        const data = await resp.json();
        const token = data?.token || data?.data?.token;
        if (data && data.success && token) {
          cachedAuthToken = token;
          chrome.storage.local.set({ downex_auth_token: cachedAuthToken });
          return cachedAuthToken;
        }
      }
    } catch (_) { }

    // 4. Fallback to Native Messaging Host if registered
    try {
      const nativeResp = await new Promise((resolve) => {
        if (chrome.runtime.sendNativeMessage) {
          chrome.runtime.sendNativeMessage('com.downex.host', { action: 'get_auth_token' }, (res) => {
            if (chrome.runtime.lastError) resolve(null);
            else resolve(res);
          });
        } else {
          resolve(null);
        }
      });
      if (nativeResp && nativeResp.success && nativeResp.token) {
        cachedAuthToken = nativeResp.token;
        chrome.storage.local.set({ downex_auth_token: cachedAuthToken });
        return cachedAuthToken;
      }
    } catch (_) { }

    return cachedAuthToken;
  }

/* =========================================================================
   2. LIFECYCLE MANAGEMENT: INSTALLATION, STARTUP & CONTEXT MENUS
   ========================================================================= */

async function setupContextMenus(overrideConfig) {
    let cfg = overrideConfig;
    if (!cfg) {
      try {
        const res = await chrome.storage.local.get(['config']);
        cfg = res?.config ? { ...DEFAULT_CONFIG, ...res.config } : DEFAULT_CONFIG;
      } catch (_) {
        cfg = DEFAULT_CONFIG;
      }
    }

    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'downex-download-link',
        title: 'Download with Downex',
        contexts: ['link'],
      });

      if (cfg.enableMediaGrabber !== false) {
        chrome.contextMenus.create({
          id: 'downex-download-media',
          title: 'Download Media with Downex',
          contexts: ['video', 'audio', 'image'],
        });
      }

      chrome.contextMenus.create({
        id: 'downex-grab-page-links',
        title: 'Download All Links on Page with Downex',
        contexts: ['page'],
      });
    });
  }

  // Lifecycle: Storage change listener (Dynamic real-time reactivity without refresh)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.config) {
      const newCfg = changes.config.newValue || {};
      const oldCfg = changes.config.oldValue || {};

      if (newCfg.enableMediaGrabber !== oldCfg.enableMediaGrabber) {
        setupContextMenus(newCfg);
      }

      // If media grabber or quality badge is turned OFF, clear all tab badges immediately
      if (newCfg.enableMediaGrabber === false || newCfg.showQualityBadge === false) {
        tabMediaMap.clear();
        chrome.tabs.query({}, (tabs) => {
          if (tabs) {
            for (const tab of tabs) {
              chrome.action.setBadgeText({ text: '', tabId: tab.id });
            }
          }
        });
      }
    }
  });

  // Lifecycle: Fresh Install or Unpacked Extension Reload in Dev Mode
  chrome.runtime.onInstalled.addListener((details) => {
    chrome.storage.local.get(['config'], (result) => {
      const fullConfig = result?.config ? { ...DEFAULT_CONFIG, ...result.config } : DEFAULT_CONFIG;
      chrome.storage.local.set({ config: fullConfig });
      setupContextMenus(fullConfig);
    });

    refreshEngineStatus(true);
  });

  // Lifecycle: Browser Startup
  chrome.runtime.onStartup.addListener(() => {
    setupContextMenus();
    refreshEngineStatus(true);
  });

  /* =========================================================================
     3. CONTEXT MENU ACTIONS
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
     4. ENGINE PING & STATUS HEARTBEAT WITH FAST CACHING
     ========================================================================= */

  async function pingDownexEngine(force = false) {
    const now = Date.now();
    if (!force && now - engineStatusCache.lastChecked < CACHE_TTL_MS) {
      return engineStatusCache.isAlive;
    }

    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 2500); // Robust 2.5s abort to handle load on slower processors
      const resp = await fetch(`${DOWNEX_BRIDGE_URL}/api/ping`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-Downex-Extension-Version': EXTENSION_VERSION,
        },
        signal: ctrl.signal,
      });
      clearTimeout(timeout);

      if (resp.ok) {
        const data = await resp.json();
        const alive = data && data.success === true;
        const version = data?.data?.version || '0.0.0';
        const token = data?.token || data?.data?.token;

        if (token) {
          cachedAuthToken = token;
        }

        engineStatusCache = {
          isAlive: alive,
          lastChecked: now,
          version: version,
        };

        const storagePayload = {
          engineAlive: alive,
          engineVersion: version,
          engineActiveCount: data?.data?.active_count || 0,
          engineSpeed: data?.data?.total_speed_bytes_sec || 0,
          engineLastChecked: now,
          latest_extension_version: data?.latest_extension_version || data?.data?.extension_version || null,
          should_reload_extension: Boolean(data?.should_reload_extension),
        };
        if (token) {
          storagePayload.downex_auth_token = token;
        }
        chrome.storage.local.set(storagePayload);
      } else {
        engineStatusCache = { isAlive: false, lastChecked: now, version: null };
        chrome.storage.local.set({ engineAlive: false });
      }
    } catch (err) {
      engineStatusCache = { isAlive: false, lastChecked: now, version: null };
      chrome.storage.local.set({ engineAlive: false });
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
     4. BROWSER DOWNLOAD INTERCEPTION (Authoritative onDeterminingFilename)
     ========================================================================= */

  // Track intercepted download IDs and URLs to prevent duplicate triggers
  const handledDownloadIds = new Set();
  const recentInterceptionUrls = new Map();

  function isUrlRecentlyIntercepted(url) {
    if (!url) return false;
    const now = Date.now();
    for (const [u, ts] of recentInterceptionUrls.entries()) {
      if (now - ts > 2500) recentInterceptionUrls.delete(u);
    }
    const clean = url.split('#')[0].replace(/([?&])(_t|t|buster|ts|time)=\d+/g, '').replace(/[?&]$/, '').toLowerCase();
    if (recentInterceptionUrls.has(clean)) {
      return true;
    }
    recentInterceptionUrls.set(clean, now);
    return false;
  }

  async function handleDownloadInterception(downloadItem) {
    if (!downloadItem || !downloadItem.id) return false;
    if (handledDownloadIds.has(downloadItem.id)) return false;
    handledDownloadIds.add(downloadItem.id);


    const { config } = await chrome.storage.local.get(['config']);
    const currentConfig = { ...DEFAULT_CONFIG, ...(config || {}) };

    if (!currentConfig.interceptDownloads) {
      return false;
    }

    const targetUrl = downloadItem.finalUrl || downloadItem.url;
    if (!targetUrl || targetUrl.startsWith('blob:') || targetUrl.startsWith('data:') || targetUrl.startsWith('filesystem:') || targetUrl.startsWith('chrome-extension:')) {
      return false;
    }

    // Check if URL was already intercepted within the last 2.5s (e.g. by content-script click)
    if (isUrlRecentlyIntercepted(targetUrl)) {
      try {
        await chrome.downloads.cancel(downloadItem.id);
        setTimeout(() => {
          chrome.downloads.erase({ id: downloadItem.id }).catch(() => {});
        }, 150);
      } catch (_) {}
      return true;
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
      download_later: false,
    };



    const success = await sendDownloadRequest(payload);
    if (success) {
      // Task created in Downex: cleanly cancel and erase browser's single-threaded download
      try {
        await chrome.downloads.cancel(downloadItem.id);
        setTimeout(() => {
          chrome.downloads.erase({ id: downloadItem.id }).catch(() => { });
        }, 150);
      } catch (e) {
        // Ignored if already cleaned
      }

      try {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'Downex Download Added',
          message: filename ? `Queued: ${filename}` : 'Download queued successfully',
          silent: true,
        });
      } catch (_) { }

      return true;
    } else {
      handledDownloadIds.delete(downloadItem.id);
      return false;
    }
  }

  // Single Authoritative Hook: onDeterminingFilename has the final resolved redirect URL, MIME type & real filename
  // Eliminates race conditions with onCreated and ensures zero broken or hanging downloads.
  chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
    handleDownloadInterception(downloadItem)
      .then((intercepted) => {
        if (!intercepted) {
          suggest();
        }
      })
      .catch(() => {
        suggest();
      });
    return true; // asynchronous suggest
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
      chrome.storage.local.get(['config'], (res) => {
        const cfg = res?.config || DEFAULT_CONFIG;
        if (cfg.enableMediaGrabber === false || cfg.showQualityBadge === false) {
          return;
        }
        const tabId = sender.tab?.id;
        if (tabId && message.data) {
          tabMediaMap.set(tabId, message.data);
          updateTabBadge(tabId, message.data);
        }
      });
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
      (async () => {
        try {
          const token = await getBridgeToken();
          const headers = { 'Accept': 'application/json' };
          if (token) headers['Authorization'] = `Bearer ${token}`;

          let r = await fetch(`${DOWNEX_BRIDGE_URL}/api/status`, { headers });
          if (r.status === 401) {
            const freshToken = await getBridgeToken(true);
            if (freshToken) headers['Authorization'] = `Bearer ${freshToken}`;
            r = await fetch(`${DOWNEX_BRIDGE_URL}/api/status`, { headers });
          }
          const data = await r.json();
          sendResponse({ success: true, data: data.data });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    // 7. Get Active Bridge Token
    if (message.type === 'GET_BRIDGE_TOKEN') {
      getBridgeToken(!!message.forceRefresh).then((token) => {
        sendResponse({ token });
      });
      return true;
    }

    // 8. Robust Loopback Probe URL (Proxies through background to avoid CORS & handle auth retries)
    if (message.type === 'PROBE_URL') {
      (async () => {
        try {
          const token = await getBridgeToken();
          const headers = { 'Content-Type': 'application/json' };
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
            headers['X-Downex-Token'] = token;
          }

          let resp = await fetch(`${DOWNEX_BRIDGE_URL}/api/probe`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ url: message.url, referer: message.referer }),
          });

          if (resp.status === 401) {
            const freshToken = await getBridgeToken(true);
            if (freshToken) {
              headers['Authorization'] = `Bearer ${freshToken}`;
              headers['X-Downex-Token'] = freshToken;
              resp = await fetch(`${DOWNEX_BRIDGE_URL}/api/probe`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ url: message.url, referer: message.referer }),
              });
            }
          }

          const data = await resp.json();
          sendResponse(data);
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    // 9. Trigger Extension Update via Downex Desktop
    if (message.type === 'TRIGGER_EXTENSION_UPDATE') {
      (async () => {
        try {
          const token = await getBridgeToken();
          const headers = { 'Content-Type': 'application/json' };
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
            headers['X-Downex-Token'] = token;
          }

          const resp = await fetch(`${DOWNEX_BRIDGE_URL}/api/extension/update`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ current_version: EXTENSION_VERSION }),
          });

          if (resp.ok) {
            const res = await resp.json();
            sendResponse({ success: true, version: res.version, message: res.message });
            setTimeout(() => {
              chrome.runtime.reload();
            }, 400);
          } else {
            const errText = await resp.text();
            sendResponse({ success: false, error: `Server error: HTTP ${resp.status}: ${errText}` });
          }
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    // 10. Self-Repair & Comprehensive Diagnostic Routine
    if (message.type === 'SELF_REPAIR') {
      (async () => {
        const report = {
          timestamp: Date.now(),
          steps: [],
          desktopRunning: false,
          tokenValid: false,
          version: null,
          success: false,
        };

        report.steps.push({ step: 'clear_cache', status: 'done', message: 'Cleared stale auth tokens and cache.' });
        cachedAuthToken = null;
        await chrome.storage.local.remove(['downex_auth_token']);

        try {
          const ctrl = new AbortController();
          const timeout = setTimeout(() => ctrl.abort(), 1500);
          const resp = await fetch(`${DOWNEX_BRIDGE_URL}/api/ping`, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'X-Downex-Extension-Version': EXTENSION_VERSION,
            },
            signal: ctrl.signal,
          });
          clearTimeout(timeout);

          if (resp.ok) {
            const data = await resp.json();
            report.desktopRunning = true;
            report.version = data?.data?.version || '0.0.0';
            const token = data?.token || data?.data?.token;
            if (token) {
              cachedAuthToken = token;
              report.tokenValid = true;
              await chrome.storage.local.set({
                downex_auth_token: token,
                engineAlive: true,
                engineVersion: report.version,
              });
            }
            report.steps.push({ step: 'loopback_ping', status: 'success', message: `Connected to Downex v${report.version} on 127.0.0.1:18888.` });
            report.success = true;
          } else {
            report.steps.push({ step: 'loopback_ping', status: 'failed', message: `Port 18888 responded with HTTP ${resp.status}.` });
          }
        } catch (netErr) {
          report.steps.push({ step: 'loopback_ping', status: 'unreachable', message: 'Downex app is not running or port 18888 is unreachable.' });
        }

        if (report.success) {
          chrome.action.setTitle({ title: `Downex: Desktop Engine Connected (v${report.version})` });
        } else {
          chrome.action.setTitle({ title: 'Downex: Desktop App Not Connected (Launch Downex to enable)' });
        }

        sendResponse(report);
      })();
      return true;
    }

    // 11. Force Immediate Connection Retry
    if (message.type === 'RETRY_CONNECTION') {
      (async () => {
        const isAlive = await pingDownexEngine(true);
        sendResponse({ isAlive, version: engineStatusCache.version });
      })();
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
      const token = await getBridgeToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['X-Downex-Token'] = token;
      }

      let resp = await fetch(`${DOWNEX_BRIDGE_URL}/api/download`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (resp.status === 401) {
        const freshToken = await getBridgeToken(true);
        if (freshToken) {
          headers['Authorization'] = `Bearer ${freshToken}`;
          headers['X-Downex-Token'] = freshToken;
          resp = await fetch(`${DOWNEX_BRIDGE_URL}/api/download`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
          });
        }
      }

      const data = await resp.json();
      return data && data.success === true;
    } catch (err) {
      // Layer 3 Connection Self-Healing: Instant retry with fresh handshake token
      try {
        await new Promise((r) => setTimeout(r, 120));
        const freshToken = await getBridgeToken(true);
        const headers = { 'Content-Type': 'application/json' };
        if (freshToken) {
          headers['Authorization'] = `Bearer ${freshToken}`;
          headers['X-Downex-Token'] = freshToken;
        }
        const retryResp = await fetch(`${DOWNEX_BRIDGE_URL}/api/download`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
        const data = await retryResp.json();
        return data;
      } catch (_) {
        console.warn('[Downex] Notice: engine unreachable after retry:', err.message);
        return false;
      }
    }
  }

  async function sendAdaptiveMediaRequest(payload) {
    try {
      const token = await getBridgeToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['X-Downex-Token'] = token;
      }

      let resp = await fetch(`${DOWNEX_BRIDGE_URL}/api/download-adaptive`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (resp.status === 401) {
        const freshToken = await getBridgeToken(true);
        if (freshToken) {
          headers['Authorization'] = `Bearer ${freshToken}`;
          headers['X-Downex-Token'] = freshToken;
          resp = await fetch(`${DOWNEX_BRIDGE_URL}/api/download-adaptive`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
          });
        }
      }

      return await resp.json();
    } catch (err) {
      console.error('[Downex] Failed to send adaptive media:', err);
      return { success: false, error: err.message };
    }
  }

  async function handoffToDownex(item) {
    if (item && item.url && isUrlRecentlyIntercepted(item.url)) {
      return true; // Debounced
    }
    let cookiesHeader = item.cookies || '';
    if (!cookiesHeader && item.url) {
      try {
        const cookies = await chrome.cookies.getAll({ url: item.url });
        cookiesHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
        if (!cookiesHeader && item.referer) {
          const refCookies = await chrome.cookies.getAll({ url: item.referer });
          cookiesHeader = refCookies.map((c) => `${c.name}=${c.value}`).join('; ');
        }
      } catch (e) { }
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
      show_dialog: true,
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
      } catch (e) { }
    }
    return success;
  }

  // =========================================================================
  // MODULAR AUTO-UPDATE HEARTBEAT & SYNC ENGINE
  // =========================================================================
  try {
    chrome.alarms.create('downex_auto_sync_pulse', { periodInMinutes: 2 });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'downex_auto_sync_pulse') {
        pingDownexEngine(true);
      }
    });
  } catch (_) { }
