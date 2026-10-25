/**
 * @file content.js
 * @package Downex — Enterprise Download Accelerator Companion (MV3)
 * @author Gaurav Patil <AspiringWebGaurav>
 * @license MIT
 * @copyright Copyright (c) 2026 Gaurav Patil. All rights reserved.
 * @description In-DOM Shadow-DOM Media Grabber Pill with memory-safe lifecycle management.
 *              Detects HTML5 / DASH / HLS video & audio streams and renders non-intrusive
 *              grabber controls anchored directly inside host players.
 * @security Scoped Shadow-DOM sandbox prevents CSS pollution. WeakMaps prevent memory leaks.
 */

// Inject page-hook.js into the webpage's main execution context
function injectPageScript() {
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('page-hook.js');
    script.async = false;
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  } catch (err) {
    console.warn('[Downex] Page hook injection skipped:', err);
  }
}
injectPageScript();

// Active detected media state for current page/video
let activeMediaMetadata = null;
let currentVideoUrl = location.href;

// WeakMap tracking attached video players (enables garbage collection on DOM removal)
const attachedPlayers = new WeakMap();

// Engine connection state & configuration tracking
let isEngineAlive = false;
let extensionConfig = {
  interceptDownloads: true,
  enableMediaGrabber: true,
};

try {
  chrome.storage.local.get(['config', 'engineAlive'], (result) => {
    if (result && result.config) {
      extensionConfig = { ...extensionConfig, ...result.config };
    }
    if (result && typeof result.engineAlive === 'boolean') {
      isEngineAlive = result.engineAlive;
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.config && changes.config.newValue) {
        extensionConfig = { ...extensionConfig, ...changes.config.newValue };
      }
      if (changes.engineAlive && typeof changes.engineAlive.newValue === 'boolean') {
        isEngineAlive = changes.engineAlive.newValue;
      }
    }
  });
} catch (_) {}

/* =========================================================================
   1. PAGE HOOK LISTENER & METADATA DISPATCH
   ========================================================================= */

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data || event.data.source !== 'DOWNEX_PAGE_HOOK') {
    return;
  }

  if (event.data.type === 'MEDIA_METADATA') {
    activeMediaMetadata = event.data.data;
    updateAllPillsWithMetadata(activeMediaMetadata);

    // Notify background worker to update action badge for this tab
    if (activeMediaMetadata && activeMediaMetadata.formats) {
      const topFmt = activeMediaMetadata.formats[0];
      chrome.runtime.sendMessage({
        type: 'MEDIA_DETECTED',
        data: {
          count: activeMediaMetadata.formats.length,
          topQuality: topFmt?.quality || 'HD',
          title: activeMediaMetadata.title,
        },
      }).catch(() => {});
    }
  }
});

/* =========================================================================
   2. SHADOW DOM MEDIA GRABBER PILL
   ========================================================================= */

function attachGrabberPill(videoEl) {
  if (!videoEl || !videoEl.isConnected || attachedPlayers.has(videoEl)) return;

  // Resolve best container (handles YouTube theater, fullscreen, and custom HTML5 players)
  const container = videoEl.closest('.html5-video-player, ytd-player, .player-container, [data-player]') || videoEl.parentElement;
  if (!container) return;

  const computedStyle = window.getComputedStyle(container);
  if (computedStyle.position === 'static') {
    container.style.position = 'relative';
  }

  const hostEl = document.createElement('div');
  hostEl.className = 'downex-pill-host';
  hostEl.style.cssText = `
    position: absolute;
    top: 14px;
    right: 14px;
    z-index: 2147483645;
    pointer-events: auto;
    transition: opacity 0.3s ease, transform 0.3s ease;
    opacity: 0.9;
  `;

  // Attach isolated Shadow DOM to ensure zero CSS contamination
  const shadow = hostEl.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 12px;
        line-height: 1.4;
      }
      .pill-container {
        position: relative;
        display: inline-block;
      }
      .grab-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        background: rgba(18, 18, 22, 0.88);
        color: #ffffff;
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 9999px;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        cursor: pointer;
        font-weight: 600;
        letter-spacing: -0.01em;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        user-select: none;
      }
      .grab-btn:hover {
        background: rgba(30, 30, 38, 0.96);
        border-color: #8b5cf6;
        box-shadow: 0 6px 20px rgba(139, 92, 246, 0.45);
        transform: translateY(-1px);
      }
      .grab-btn:active {
        transform: translateY(0);
      }
      .icon {
        width: 14px;
        height: 14px;
        stroke: #a78bfa;
        stroke-width: 2.5;
        fill: none;
      }
      .badge {
        background: #8b5cf6;
        color: white;
        padding: 1px 5px;
        border-radius: 4px;
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .menu {
        display: none;
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        width: 230px;
        background: rgba(18, 18, 24, 0.96);
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 10px;
        padding: 6px;
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6);
        max-height: 290px;
        overflow-y: auto;
        z-index: 100;
      }
      .menu.open {
        display: block;
        animation: fadeIn 0.15s ease-out;
      }
      .menu-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 10px;
        font-weight: 700;
        color: #a1a1aa;
        text-transform: uppercase;
        padding: 5px 8px;
        letter-spacing: 0.05em;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        margin-bottom: 4px;
      }
      .menu-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 8px;
        color: #e4e4e7;
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.12s;
        font-size: 11px;
      }
      .menu-item:hover {
        background: rgba(139, 92, 246, 0.22);
        color: #ffffff;
      }
      .menu-item .res {
        font-weight: 600;
      }
      .menu-item .sub {
        font-size: 9px;
        color: #a1a1aa;
      }
      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }
    </style>

    <div class="pill-container">
      <button class="grab-btn" id="btn-toggle" title="Download with Downex">
        <svg class="icon" viewBox="0 0 24 24">
          <path d="M12 3v13m0 0l-5-5m5 5l5-5M4 19h16" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span id="label-text">Download</span>
        <span class="badge" id="badge-quality">HD</span>
      </button>

      <div class="menu" id="dropdown-menu">
        <div class="menu-header">
          <span>Downex Stream Grabber</span>
          <span style="color:#8b5cf6;">HD/4K</span>
        </div>
        <div id="format-list"></div>
      </div>
    </div>
  `;

  const btnToggle = shadow.getElementById('btn-toggle');
  const dropdown = shadow.getElementById('dropdown-menu');
  const formatList = shadow.getElementById('format-list');
  const badgeQuality = shadow.getElementById('badge-quality');

  // IDM-Style Idle Auto-Dimming
  let idleTimer = null;
  const resetDimTimer = () => {
    hostEl.style.opacity = '0.92';
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!dropdown.classList.contains('open')) {
        hostEl.style.opacity = '0.35';
      }
    }, 3500);
  };

  container.addEventListener('mousemove', resetDimTimer, { passive: true });
  container.addEventListener('mouseenter', resetDimTimer, { passive: true });
  container.addEventListener('mouseleave', () => {
    if (!dropdown.classList.contains('open')) {
      hostEl.style.opacity = '0.35';
    }
  }, { passive: true });
  resetDimTimer();

  // Toggle dropdown / trigger download
  btnToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    hostEl.style.opacity = '1.0';
    if (activeMediaMetadata && activeMediaMetadata.formats && activeMediaMetadata.formats.length > 0) {
      dropdown.classList.toggle('open');
    } else {
      const src = videoEl.currentSrc || videoEl.src || videoEl.querySelector('source')?.src;
      if (src) {
        triggerDirectDownload(src, document.title);
      } else {
        dropdown.classList.toggle('open');
      }
    }
  });

  // Close dropdown on outside click
  document.addEventListener('click', () => {
    dropdown.classList.remove('open');
    resetDimTimer();
  });

  // Attach update callback
  hostEl._updateMetadata = (meta) => {
    if (!meta || !meta.formats || meta.formats.length === 0) return;

    const topFmt = meta.formats[0];
    badgeQuality.textContent = topFmt.quality || 'HD';

    formatList.innerHTML = '';
    meta.formats.forEach((fmt) => {
      const item = document.createElement('div');
      item.className = 'menu-item';
      item.innerHTML = `
        <div style="flex: 1; min-width: 0;">
          <div class="res">${fmt.quality} ${fmt.fps > 30 ? fmt.fps + 'fps' : ''}</div>
          <div class="sub">${fmt.isAdaptive ? 'Adaptive Stream' : 'Direct Stream'} • ${fmt.mimeType ? fmt.mimeType.split(';')[0].replace('video/', '').toUpperCase() : 'MP4'}</div>
        </div>
        <div style="display: flex; gap: 4px; align-items: center; shrink-0;">
          <button class="action-btn action-later" title="Download Later (Queue in Paused State)" style="padding: 3px 6px; border-radius: 4px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); color: #a1a1aa; cursor: pointer; font-size: 10px;">
            🕒 Later
          </button>
          <button class="action-btn action-now" title="Start Download Immediately" style="padding: 3px 7px; border-radius: 4px; background: #8b5cf6; border: none; color: white; font-weight: 600; cursor: pointer; font-size: 10px;">
            ⬇ Start
          </button>
        </div>
      `;

      item.querySelector('.action-now').addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.remove('open');
        triggerAdaptiveDownload(meta.title, fmt.url, meta.bestAudioUrl, false);
      });

      item.querySelector('.action-later').addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.remove('open');
        triggerAdaptiveDownload(meta.title, fmt.url, meta.bestAudioUrl, true);
      });

      item.addEventListener('click', () => {
        dropdown.classList.remove('open');
        triggerAdaptiveDownload(meta.title, fmt.url, meta.bestAudioUrl, false);
      });

      formatList.appendChild(item);
    });

    // Audio-Only Option
    if (meta.bestAudioUrl) {
      const audioItem = document.createElement('div');
      audioItem.className = 'menu-item';
      audioItem.innerHTML = `
        <div style="flex: 1; min-width: 0;">
          <div class="res">Audio Only</div>
          <div class="sub">High Fidelity (Opus/M4A)</div>
        </div>
        <div style="display: flex; gap: 4px; align-items: center; shrink-0;">
          <button class="action-btn action-later" title="Download Later" style="padding: 3px 6px; border-radius: 4px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); color: #a1a1aa; cursor: pointer; font-size: 10px;">
            🕒 Later
          </button>
          <button class="action-btn action-now" title="Download Audio Now" style="padding: 3px 7px; border-radius: 4px; background: #10b981; border: none; color: white; font-weight: 600; cursor: pointer; font-size: 10px;">
            ⬇ Audio
          </button>
        </div>
      `;

      audioItem.querySelector('.action-now').addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.remove('open');
        triggerDirectDownload(meta.bestAudioUrl, `${meta.title || 'Audio'} (Audio).m4a`, false);
      });

      audioItem.querySelector('.action-later').addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.remove('open');
        triggerDirectDownload(meta.bestAudioUrl, `${meta.title || 'Audio'} (Audio).m4a`, true);
      });

      audioItem.addEventListener('click', () => {
        dropdown.classList.remove('open');
        triggerDirectDownload(meta.bestAudioUrl, `${meta.title || 'Audio'} (Audio).m4a`, false);
      });

      formatList.appendChild(audioItem);
    }
  };

  if (activeMediaMetadata) {
    hostEl._updateMetadata(activeMediaMetadata);
  }

  // Register in WeakMap and attach to DOM
  attachedPlayers.set(videoEl, hostEl);
  container.appendChild(hostEl);
}

function updateAllPillsWithMetadata(meta) {
  document.querySelectorAll('.downex-pill-host').forEach((host) => {
    if (typeof host._updateMetadata === 'function') {
      host._updateMetadata(meta);
    }
  });
}

function triggerDirectDownload(url, filename, downloadLater = false) {
  chrome.runtime.sendMessage({
    type: 'SEND_DOWNLOAD',
    data: {
      url,
      filename: filename ? filename.replace(/[\\/:*?"<>|]/g, '_') : undefined,
      referer: location.href,
      download_later: downloadLater,
    },
  });
}

function triggerAdaptiveDownload(title, videoUrl, audioUrl, downloadLater = false) {
  chrome.runtime.sendMessage({
    type: 'SEND_ADAPTIVE_MEDIA',
    data: {
      title: title ? title.replace(/[\\/:*?"<>|]/g, '_') : 'Video',
      video_url: videoUrl,
      audio_url: audioUrl,
      referer: location.href,
      download_later: downloadLater,
    },
  });
}

/* =========================================================================
   3. HIGH-PERFORMANCE DEBOUNCED DOM SCANNER
   ========================================================================= */

let scanScheduled = false;

function scheduleScan() {
  if (scanScheduled) return;
  scanScheduled = true;
  requestAnimationFrame(() => {
    setTimeout(() => {
      scanScheduled = false;
      scanVideos();
    }, 150);
  });
}

function scanVideos() {
  const videos = document.querySelectorAll('video');
  videos.forEach((video) => {
    if (video.offsetWidth > 140 && video.offsetHeight > 80) {
      attachGrabberPill(video);
    }
  });
}

// Throttled MutationObserver (handles dynamic SPAs without freezing browser)
const observer = new MutationObserver(() => {
  scheduleScan();
});

observer.observe(document.body || document.documentElement, {
  childList: true,
  subtree: true,
});

// Initial boot scans
setTimeout(scanVideos, 600);
setTimeout(scanVideos, 1800);

/* =========================================================================
   4. SPA NAVIGATION LIFECYCLE (YouTube, Twitter/X, Instagram, TikTok)
   ========================================================================= */

function checkUrlChange() {
  if (location.href !== currentVideoUrl) {
    currentVideoUrl = location.href;
    activeMediaMetadata = null;
    scheduleScan();
  }
}

window.addEventListener('yt-navigate-finish', checkUrlChange);
window.addEventListener('popstate', checkUrlChange);
window.addEventListener('hashchange', checkUrlChange);

// Link Grabber response listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACT_ALL_LINKS') {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const results = [];
    const seen = new Set();

    anchors.forEach((a) => {
      const href = a.href;
      if (href && !href.startsWith('javascript:') && !href.startsWith('#') && !seen.has(href)) {
        seen.add(href);
        results.push({
          url: href,
          text: a.innerText.trim() || a.getAttribute('title') || href.split('/').pop() || 'Link',
        });
      }
    });

    sendResponse({ links: results });
    return true;
  }
});

/* =========================================================================
   5. IDM-STYLE DIRECT LINK CLICK INTERCEPTION
   ========================================================================= */

const DIRECT_DOWNLOAD_EXTENSIONS = new Set([
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'dmg', 'pkg',
  'exe', 'msi', 'apk', 'appimage', 'deb', 'rpm',
  'mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv',
  'mp3', 'm4a', 'flac', 'wav', 'aac', 'opus',
  'bin', 'torrent'
]);

document.addEventListener('click', (event) => {
  // 1. Bypass download manager if user holds Alt key (Standard IDM suppression shortcut)
  if (event.altKey) return;

  // 2. Safety Gate: If desktop engine is offline or user disabled interception, allow native browser download
  if (!isEngineAlive || !extensionConfig.interceptDownloads) return;

  const anchor = event.target.closest('a');
  if (!anchor || !anchor.href) return;

  const href = anchor.href;
  if (!href.startsWith('http://') && !href.startsWith('https://')) return;

  const cleanUrl = href.split('?')[0].split('#')[0];
  const ext = cleanUrl.split('.').pop()?.toLowerCase() || '';

  const hasDirectExt = DIRECT_DOWNLOAD_EXTENSIONS.has(ext);
  const hasDownloadAttr = anchor.hasAttribute('download');

  if (hasDirectExt || hasDownloadAttr) {
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) {
      event.preventDefault();
      event.stopPropagation();

      const suggestedFilename = anchor.getAttribute('download') || cleanUrl.split('/').pop() || undefined;
      triggerDirectDownload(href, suggestedFilename, false);
    }
  }
}, true);

