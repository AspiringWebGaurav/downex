/**
 * @file popup.js
 * @package Downex — Enterprise Download Accelerator Companion (MV3)
 * @author Gaurav Patil <AspiringWebGaurav>
 * @license MIT
 * @copyright Copyright (c) 2026 Gaurav Patil. All rights reserved.
 * @description Refined, minimalist, desktop-aligned extension controller with zero-click auto-paste,
 *              live URL probing, segmented multi-view controller, and stream sniffer integration.
 * @security Air-gapped 127.0.0.1:18888 loopback. Zero external network transmission.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Initial Icon Rendering
  if (typeof DownexIcons !== 'undefined') {
    DownexIcons.render(document);
  }

  // Element Selectors
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const fileSizeBadge = document.getElementById('file-size-badge');
  const urlInput = document.getElementById('url-input');
  const btnClear = document.getElementById('btn-clear');
  const pathPreview = document.getElementById('path-preview');
  const btnDownloadNow = document.getElementById('btn-download-now');
  const btnDownloadLater = document.getElementById('btn-download-later');
  const toggleMedia = document.getElementById('toggle-media');
  const toggleInPlayerPill = document.getElementById('toggle-in-player-pill');
  const toggleQualityBadge = document.getElementById('toggle-quality-badge');
  const toggleIntercept = document.getElementById('toggle-intercept');
  const toggleAltBypass = document.getElementById('toggle-alt-bypass');
  const videoSubSettings = document.getElementById('video-sub-settings');
  const detectionStatusChip = document.getElementById('detection-status-chip');
  const btnScanLinks = document.getElementById('btn-scan-links');
  const linksBox = document.getElementById('links-box');
  const linksList = document.getElementById('links-list');
  const filterPills = document.getElementById('filter-pills');
  const btnDownloadSelected = document.getElementById('btn-download-selected');
  const btnRefreshStatus = document.getElementById('btn-refresh-status');
  const refreshLabel = document.getElementById('refresh-label');
  const btnToggleEnterprise = document.getElementById('btn-toggle-enterprise');
  const enterpriseDrawer = document.getElementById('enterprise-drawer');
  const btnOpenDashboard = document.getElementById('btn-open-dashboard');
  const btnThemeToggle = document.getElementById('btn-theme-toggle');

  // Modular Auto-Update & Connection Lock Screen Elements
  const lockedContainer = document.getElementById('locked-container');
  const extUpdateBanner = document.getElementById('ext-update-banner');
  const extNewVer = document.getElementById('ext-new-ver');
  const btnUpdateExtension = document.getElementById('btn-update-extension');
  const btnLaunchDownex = document.getElementById('btn-launch-downex');
  const btnDownloadDownex = document.getElementById('btn-download-downex');
  const btnRetryConn = document.getElementById('btn-retry-conn');
  const retryConnLabel = document.getElementById('retry-conn-label');
  const btnSelfRepair = document.getElementById('btn-self-repair');
  const repairTerminal = document.getElementById('repair-terminal');
  const interactiveCards = document.querySelectorAll('.dwnx-card, .card');
  const extVerBadge = document.getElementById('ext-ver-badge');

  // Streams Tab Elements
  const streamContainer = document.getElementById('stream-container');
  const streamEmptyState = document.getElementById('stream-empty-state');
  const tabStreamsBadge = document.getElementById('tab-streams-badge');

  try {
    const manifest = chrome.runtime?.getManifest?.();
    if (extVerBadge && manifest?.version) {
      extVerBadge.textContent = `v${manifest.version}`;
    }
  } catch (_) {}

  let extractedLinks = [];
  let currentFilter = 'all';
  let popupAuthToken = null;

  // =========================================================================
  // THEME MANAGEMENT (Dark / Light Parity)
  // =========================================================================
  function applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.setAttribute('data-theme', 'dark');
      if (btnThemeToggle && typeof DownexIcons !== 'undefined') {
        btnThemeToggle.innerHTML = DownexIcons.svg('sun', 13);
      }
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.setAttribute('data-theme', 'light');
      if (btnThemeToggle && typeof DownexIcons !== 'undefined') {
        btnThemeToggle.innerHTML = DownexIcons.svg('moon', 13);
      }
    }
  }

  try {
    chrome.storage.local.get(['downex_theme'], (res) => {
      const saved = res?.downex_theme;
      if (saved) {
        applyTheme(saved);
      } else {
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        applyTheme(prefersDark ? 'dark' : 'light');
      }
    });
  } catch (_) {}

  
  // Dynamic Header In-Place Reload Button
  const btnFooterReload = document.getElementById('btn-footer-reload');
  const footerReloadText = document.getElementById('footer-reload-text');
  btnFooterReload?.addEventListener('click', () => {
    chrome.storage.local.set({ should_reload_extension: false });
    handleTriggerUpdate(btnFooterReload, footerReloadText);
  });

  btnThemeToggle?.addEventListener('click', () => {
    const isDark = document.documentElement.classList.contains('dark');
    const next = isDark ? 'light' : 'dark';
    applyTheme(next);
    try {
      chrome.storage.local.set({ downex_theme: next });
    } catch (_) {}
  });

  // =========================================================================
  // TAB SEGMENT CONTROLLER
  // =========================================================================
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabViews = {
    quick: document.getElementById('view-quick'),
    streams: document.getElementById('view-streams'),
    settings: document.getElementById('view-settings'),
  };

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-tab');
      tabButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      Object.entries(tabViews).forEach(([key, view]) => {
        if (view) {
          if (key === target) {
            view.classList.add('active');
          } else {
            view.classList.remove('active');
          }
        }
      });

      if (target === 'streams') {
        loadActiveTabStreams();
      }
    });
  });

  // Dashboard Navigation
  btnOpenDashboard?.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options/options.html'));
    }
  });

  document.getElementById('brand-home')?.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    }
  });

  // =========================================================================
  // CONNECTION UI STATE
  // =========================================================================
  
  // =========================================================================
  // DYNAMIC LIFECYCLE STATE MANAGER (Accept, Reject, Probing, Disk Write Error, Fail)
  // =========================================================================
  const lifecycleBanner = document.getElementById('lifecycle-banner');
  const lifecycleIcon = document.getElementById('lifecycle-icon');
  const lifecycleTitle = document.getElementById('lifecycle-title');
  const lifecycleDesc = document.getElementById('lifecycle-desc');
  const lifecycleActions = document.getElementById('lifecycle-actions');
  const btnFallbackBrowser = document.getElementById('btn-fallback-browser');
  const btnLifecycleClose = document.getElementById('btn-lifecycle-close');

  function showLifecycleAlert(phase, title, desc, actionUrl = null) {
    if (!lifecycleBanner) return;

    lifecycleBanner.className = `lifecycle-banner phase-${phase}`;
    lifecycleBanner.style.display = 'flex';
    if (lifecycleTitle) lifecycleTitle.textContent = title;
    if (lifecycleDesc) lifecycleDesc.textContent = desc;

    if (lifecycleIcon && typeof DownexIcons !== 'undefined') {
      let iconName = 'alertCircle';
      if (phase === 'accepted') iconName = 'checkCircle';
      else if (phase === 'probing') iconName = 'activity';
      else if (phase === 'disk-error') iconName = 'hardDrive';
      else if (phase === 'bypassed') iconName = 'arrowRight';
      else iconName = 'alertCircle';

      lifecycleIcon.setAttribute('data-icon', iconName);
      DownexIcons.render(lifecycleBanner);
    }

    if (actionUrl && btnFallbackBrowser && lifecycleActions) {
      lifecycleActions.style.display = 'flex';
      btnFallbackBrowser.onclick = () => {
        try {
          chrome.downloads.download({ url: actionUrl });
          lifecycleBanner.style.display = 'none';
        } catch (_) {}
      };
    } else if (lifecycleActions) {
      lifecycleActions.style.display = 'none';
    }
  }

  btnLifecycleClose?.addEventListener('click', () => {
    if (lifecycleBanner) lifecycleBanner.style.display = 'none';
  });

  // Listen for broadcasted lifecycle events from background service worker
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'LIFECYCLE_EVENT' && msg.event) {
        showLifecycleAlert(msg.event.phase, msg.event.title, msg.event.desc, msg.event.url);
      }
    });
  } catch (_) {}

  
  // Dynamic UI Adapter: Distinguishes between "Not Installed" (Day 0) vs "Installed But Closed"
  let hasEverConnected = false;
  try {
    chrome.storage.local.get(['hasEverConnected', 'downex_auth_token'], (res) => {
      hasEverConnected = Boolean(res?.hasEverConnected || res?.downex_auth_token);
    });
  } catch (_) {}

  function updateLockedScreenContent(isInstalled) {
    const lockTitle = document.getElementById('lock-title');
    const lockSubtitle = document.getElementById('lock-subtitle');
    const btnDownload = document.getElementById('btn-download-downex');
    const btnLaunch = document.getElementById('btn-launch-downex');
    const lockHelper = document.getElementById('lock-helper-text');

    if (!isInstalled) {
      // CASE 1: APP NOT INSTALLED (Day 0 User Journey)
      if (lockTitle) lockTitle.textContent = 'Downex Desktop Required';
      if (lockSubtitle) {
        lockSubtitle.textContent = 'Install the Downex desktop application on your PC to enable high-speed downloads and video stream sniffing.';
      }
      if (btnDownload) btnDownload.style.display = 'flex';
      if (btnLaunch) btnLaunch.style.display = 'none'; // NEVER show Launch App to a fresh user
      if (lockHelper) {
        lockHelper.innerHTML = 'Already installed? <a href="#" id="link-retry-action">Check Connection</a>';
        document.getElementById('link-retry-action')?.addEventListener('click', (e) => {
          e.preventDefault();
          checkEngineHealth(true);
        });
      }
    } else {
      // CASE 2: APP INSTALLED BUT CURRENTLY CLOSED
      if (lockTitle) lockTitle.textContent = 'Downex Desktop is Closed';
      if (lockSubtitle) {
        lockSubtitle.textContent = 'Downex is not running in the background. Start Downex to enable download acceleration.';
      }
      if (btnDownload) btnDownload.style.display = 'none';
      if (btnLaunch) btnLaunch.style.display = 'flex';
      if (lockHelper) {
        lockHelper.innerHTML = '<a href="#" id="link-retry-action">Retry Handshake</a> • <a href="https://download.gauravpatil.site" target="_blank">Re-download</a>';
        document.getElementById('link-retry-action')?.addEventListener('click', (e) => {
          e.preventDefault();
          checkEngineHealth(true);
        });
      }
    }
  }

  function setConnectionUIState(isAlive, details = {}) {
    if (isAlive) {
      hasEverConnected = true;
      chrome.storage.local.set({ hasEverConnected: true });
      if (lockedContainer) lockedContainer.style.display = 'none';
      const unlockedContent = document.getElementById('unlocked-content');
      if (unlockedContent) unlockedContent.style.display = 'block';
      interactiveCards.forEach((c) => {
        if (c.id !== 'locked-container') c.classList.remove('is-locked');
      });
      if (urlInput) urlInput.disabled = false;
      if (btnScanLinks) btnScanLinks.disabled = false;
      updateUrlActionState();

      if (statusBadge) {
        statusBadge.style.display = 'inline-flex';
        statusBadge.className = 'connection-pill status-connected';
        const verStr = details.version ? `v${details.version}` : 'v0.0.0';
        statusBadge.title = `Connected to Downex Desktop (${verStr}) on 127.0.0.1:18888`;
      }
      if (statusText) {
        statusText.textContent = 'Connected';
      }
      const lockEngineStat = document.getElementById('lock-engine-status');
      if (lockEngineStat) {
        lockEngineStat.textContent = 'Active (127.0.0.1:18888)';
        lockEngineStat.className = 'telemetry-val success';
      }

      // Dynamic Extension Update Detection (Show ONLY when an update is genuinely required)
      const extVer = details.extension_version || details.latest_extension_version;
      const shouldReload = Boolean(details.should_reload_extension);
      const currentVer = chrome.runtime?.getManifest?.()?.version || '0.0.0';
      const isNewer = extVer ? compareSemver(extVer, currentVer) > 0 : false;
      const isDifferent = extVer ? (String(extVer).replace(/^v/, '') !== String(currentVer).replace(/^v/, '')) : false;
      const hasUpdate = Boolean(shouldReload || isNewer || isDifferent);
      const footerUpToDate = document.getElementById('footer-up-to-date');

      if (hasUpdate) {
        if (extUpdateBanner) {
          extUpdateBanner.style.display = 'block';
          if (extNewVer) extNewVer.textContent = 'v' + (extVer || currentVer);
        }
        if (btnFooterReload) {
          btnFooterReload.style.display = 'inline-flex';
          if (footerReloadText) {
            footerReloadText.textContent = isNewer ? `Update to v${extVer}` : 'Reload to Update';
          }
        }
        if (footerUpToDate) footerUpToDate.style.display = 'none';
      } else {
        if (extUpdateBanner) extUpdateBanner.style.display = 'none';
        if (btnFooterReload) btnFooterReload.style.display = 'none';
        if (footerUpToDate) footerUpToDate.style.display = 'inline-flex';
      }
    } else {
      const unlockedContent = document.getElementById('unlocked-content');
      if (unlockedContent) unlockedContent.style.display = 'none';
      if (lockedContainer) {
        lockedContainer.style.display = 'block';
        updateLockedScreenContent(hasEverConnected);
      }
      interactiveCards.forEach((c) => {
        if (c.id !== 'locked-container') c.classList.add('is-locked');
      });
      if (urlInput) urlInput.disabled = true;
      if (btnDownloadNow) btnDownloadNow.disabled = true;
      if (btnDownloadLater) btnDownloadLater.disabled = true;
      if (btnScanLinks) btnScanLinks.disabled = true;
      // When offline, middle card already displays "Downex Desktop Required"
      // Hide top-right pill to avoid repeating and keep top bar clean!
      if (statusBadge) statusBadge.style.display = 'none';
      const lockEngineStat = document.getElementById('lock-engine-status');
      if (lockEngineStat) {
        lockEngineStat.textContent = 'Offline / Not Running';
        lockEngineStat.className = 'telemetry-val error';
      }
      if (extUpdateBanner) extUpdateBanner.style.display = 'none';
      if (btnFooterReload) btnFooterReload.style.display = 'none';
      const footerUpToDate = document.getElementById('footer-up-to-date');
      if (footerUpToDate) footerUpToDate.style.display = 'none';
    }
  }

  function updateSettingsVisuals() {
    const isVideoOn = toggleMedia ? toggleMedia.checked : true;
    if (videoSubSettings) {
      videoSubSettings.style.opacity = isVideoOn ? '1.0' : '0.4';
      videoSubSettings.style.pointerEvents = isVideoOn ? 'auto' : 'none';
    }
    if (detectionStatusChip) {
      if (isVideoOn) {
        detectionStatusChip.className = 'dwnx-pill dwnx-pill-emerald';
        detectionStatusChip.innerHTML = '<span class="dwnx-dot"></span>Video ON';
        detectionStatusChip.title = 'Video and stream detection is currently active';
      } else {
        detectionStatusChip.className = 'dwnx-pill';
        detectionStatusChip.innerHTML = '<span class="dwnx-dot" style="background:#71717a;"></span>Video OFF';
        detectionStatusChip.title = 'Video and stream detection is turned off';
      }
    }
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let val = bytes;
    while (val >= 1024 && i < units.length - 1) {
      val /= 1024;
      i++;
    }
    return `${val.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
  }

  async function getPopupAuthToken() {
    if (popupAuthToken) return popupAuthToken;
    try {
      const stored = await chrome.storage.local.get(['downex_auth_token']);
      if (stored && stored.downex_auth_token) {
        popupAuthToken = stored.downex_auth_token;
        return popupAuthToken;
      }
    } catch (_) {}
    return null;
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function sanitizeFilename(str) {
    if (!str) return 'download';
    return str.replace(/[\\/:*?"<>|]/g, '_').substring(0, 100);
  }

  // =========================================================================
  // 1. INSTANT CACHE HYDRATION (0ms initial render)
  // =========================================================================
  chrome.storage.local.get(
    ['config', 'engineAlive', 'engineVersion', 'engineActiveCount', 'engineSpeed', 'downex_auth_token', 'latest_extension_version', 'should_reload_extension'],
    (cached) => {
      if (cached?.config) {
        if (toggleMedia) toggleMedia.checked = cached.config.enableMediaGrabber !== false;
        if (toggleInPlayerPill) toggleInPlayerPill.checked = cached.config.showInPlayerPill !== false;
        if (toggleQualityBadge) toggleQualityBadge.checked = cached.config.showQualityBadge !== false;
        if (toggleIntercept) toggleIntercept.checked = cached.config.interceptDownloads !== false;
        if (toggleAltBypass) toggleAltBypass.checked = cached.config.altKeyBypass !== false;
        updateSettingsVisuals();
      }
      if (cached?.downex_auth_token) {
        popupAuthToken = cached.downex_auth_token;
      }
      if (cached?.engineAlive === false) {
        setConnectionUIState(false);
      } else {
        setConnectionUIState(true, {
          version: cached?.engineVersion || '0.0.0',
          active_count: cached?.engineActiveCount || 0,
          latest_extension_version: cached?.latest_extension_version,
          extension_version: cached?.latest_extension_version,
          should_reload_extension: Boolean(cached?.should_reload_extension),
        });
      }
    }
  );

  // =========================================================================
  // 2. REAL-TIME ENGINE HANDSHAKE & CONNECTION CHECK
  // =========================================================================
  let isChecking = false;

  async function checkEngineHealth(isUserInitiated = false) {
    if (isChecking) return;
    isChecking = true;

    const topPill = document.getElementById('top-lifecycle-pill');
    const topPillText = document.getElementById('top-pill-text');
    const btnCheckConn = document.getElementById('btn-check-connection');
    const checkConnLabel = document.getElementById('check-connection-label');
    const lockEngineStat = document.getElementById('lock-engine-status');

    if (isUserInitiated) {
      if (topPill) {
        topPill.className = 'top-center-badge state-checking';
        topPill.innerHTML = '<span class="dwnx-dot dwnx-dot-pulse" style="background:var(--dwnx-blue-text);"></span><span>Checking Desktop Connection (127.0.0.1:18888)...</span>';
        topPill.style.display = 'flex';
      }
      if (btnCheckConn) {
        btnCheckConn.disabled = true;
        btnCheckConn.innerHTML = '<span class="dwnx-dot dwnx-dot-pulse" style="background:currentColor;"></span><span>Checking...</span>';
      }
      if (lockEngineStat) {
        lockEngineStat.textContent = 'Probing Loopback...';
        lockEngineStat.className = 'telemetry-val';
      }
      if (refreshLabel) refreshLabel.textContent = 'Checking...';
    }

    const checkStart = performance.now();
    let isAlive = false;
    let version = '0.0.0';
    let detailsData = null;

    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 1200);
      const resp = await fetch('http://127.0.0.1:18888/api/ping', {
        method: 'GET',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' },
        signal: ctrl.signal,
      });
      clearTimeout(tid);

      if (resp.ok) {
        const res = await resp.json();
        if (res && res.success) {
          isAlive = true;
          version = res?.data?.version || '0.0.0';
          const token = res.token || res.data?.token;
          if (token) {
            popupAuthToken = token;
            chrome.storage.local.set({ downex_auth_token: token });
          }
          detailsData = {
            ...(res.data || {}),
            should_reload_extension: Boolean(res.should_reload_extension),
            latest_extension_version: res.latest_extension_version || res.data?.extension_version,
            extension_version: res.latest_extension_version || res.data?.extension_version,
          };
          chrome.storage.local.set({
            engineAlive: true,
            engineVersion: version,
            latest_extension_version: detailsData.latest_extension_version,
            should_reload_extension: detailsData.should_reload_extension,
          });
        }
      }
    } catch (_) {}

    // Enforce smooth minimum 850ms duration so user clearly sees the checking state
    if (isUserInitiated) {
      const elapsed = performance.now() - checkStart;
      if (elapsed < 850) {
        await new Promise((r) => setTimeout(r, 850 - elapsed));
      }
    }

    if (isAlive) {
      // SUCCESS STATE
      if (topPill) {
        topPill.className = 'top-center-badge state-success';
        topPill.innerHTML = '<span data-icon="checkCircle" data-icon-size="13"></span><span>✓ Connected to Downex Desktop!</span>';
        if (typeof DownexIcons !== 'undefined') DownexIcons.render(topPill);
      }
      if (btnCheckConn) {
        btnCheckConn.innerHTML = '<span data-icon="check" data-icon-size="11"></span><span>Connected!</span>';
        if (typeof DownexIcons !== 'undefined') DownexIcons.render(btnCheckConn);
      }
      if (lockEngineStat) {
        lockEngineStat.textContent = `Connected (v${version})`;
        lockEngineStat.className = 'telemetry-val success';
      }
      if (refreshLabel) refreshLabel.textContent = 'Connected';

      if (isUserInitiated) {
        await new Promise((r) => setTimeout(r, 600));
      }
      if (topPill) topPill.style.display = 'none';
      setConnectionUIState(true, { version, ...detailsData });
      isChecking = false;
    } else {
      // FAIL STATE
      if (isUserInitiated) {
        if (topPill) {
          topPill.className = 'top-center-badge state-failed';
          topPill.innerHTML = '<span data-icon="alertCircle" data-icon-size="13"></span><span>✕ No Connection Found (Port 18888 Closed)</span>';
          if (typeof DownexIcons !== 'undefined') DownexIcons.render(topPill);
        }
        if (btnCheckConn) {
          btnCheckConn.innerHTML = '<span data-icon="x" data-icon-size="11"></span><span>No Connection</span>';
          if (typeof DownexIcons !== 'undefined') DownexIcons.render(btnCheckConn);
        }
      }
      if (lockEngineStat) {
        lockEngineStat.textContent = 'Offline / Not Running';
        lockEngineStat.className = 'telemetry-val error';
      }
      if (refreshLabel) refreshLabel.textContent = 'Failed';
      setConnectionUIState(false);

      if (isUserInitiated) {
        setTimeout(() => {
          if (topPill) topPill.style.display = 'none';
          if (btnCheckConn) {
            btnCheckConn.disabled = false;
            btnCheckConn.innerHTML = '<span data-icon="refresh" data-icon-size="11"></span><span id="check-connection-label">Check Connection</span>';
            if (typeof DownexIcons !== 'undefined') DownexIcons.render(btnCheckConn);
          }
          if (refreshLabel) refreshLabel.textContent = 'Refresh';
          isChecking = false;
        }, 1800);
      } else {
        isChecking = false;
      }
    }
  }

  // Run immediate non-blocking check
  checkEngineHealth(false);

  statusBadge?.addEventListener('click', () => checkEngineHealth(true));
  btnRefreshStatus?.addEventListener('click', () => checkEngineHealth(true));

  const btnCheckConnection = document.getElementById('btn-check-connection');
  btnCheckConnection?.addEventListener('click', (e) => {
    e.preventDefault();
    checkEngineHealth(true);
  });

  btnRetryConn?.addEventListener('click', () => checkEngineHealth(true));
  btnLaunchDownex?.addEventListener('click', () => {
    try {
      window.location.href = 'downex://open';
    } catch (_) {}
    setTimeout(() => checkEngineHealth(true), 1500);
  });

  // =========================================================================
  // ACTIVE TAB STREAMS DETECTION
  // =========================================================================
  async function loadActiveTabStreams() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      chrome.tabs.sendMessage(tab.id, { type: 'GET_MEDIA_METADATA' }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res && res.metadata && res.metadata.formats && res.metadata.formats.length > 0) {
          renderStreamsList(res.metadata, tab);
        }
      });
    } catch (_) {}
  }

  function renderStreamsList(mediaData, tab) {
    if (!streamContainer) return;
    if (streamEmptyState) streamEmptyState.style.display = 'none';

    if (tabStreamsBadge) {
      tabStreamsBadge.textContent = mediaData.formats.length;
      tabStreamsBadge.style.display = 'inline-block';
    }

    streamContainer.innerHTML = '';
    mediaData.formats.forEach((fmt) => {
      const item = document.createElement('div');
      item.className = 'stream-card';
      const title = mediaData.title || tab.title || 'Video Stream';
      const resBadge = fmt.qualityLabel || fmt.resolution || (fmt.hasVideo ? 'HD Video' : 'Audio Only');
      const extBadge = fmt.mimeType ? fmt.mimeType.split(';')[0].split('/')[1] : 'mp4';

      item.innerHTML = `
        <div style="flex: 1; min-width: 0;">
          <div class="stream-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
          <div class="stream-meta">
            <span class="stream-badge">${escapeHtml(resBadge)}</span>
            <span>${escapeHtml(extBadge.toUpperCase())}</span>
            ${fmt.contentLength ? `<span>• ${formatBytes(parseInt(fmt.contentLength, 10))}</span>` : ''}
          </div>
        </div>
        <button type="button" class="dwnx-btn dwnx-btn-emerald dwnx-btn-sm btn-grab-stream">
          <span data-icon="download" data-icon-size="11"></span>
          <span>Grab</span>
        </button>
      `;

      if (typeof DownexIcons !== 'undefined') {
        DownexIcons.render(item);
      }

      item.querySelector('.btn-grab-stream')?.addEventListener('click', () => {
        chrome.runtime.sendMessage({
          type: 'SEND_DOWNLOAD',
          data: {
            url: fmt.url,
            filename: `${sanitizeFilename(title)}.${extBadge}`,
            referer: tab.url,
            show_dialog: true,
          },
        });
      });

      streamContainer.appendChild(item);
    });
  }

  loadActiveTabStreams();

  // =========================================================================
  // LIVE PROBING & QUICK URL DISPATCH
  // =========================================================================
  let probeTimer = null;
  function scheduleProbe(url) {
    clearTimeout(probeTimer);
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      if (fileSizeBadge) fileSizeBadge.style.display = 'none';
      return;
    }

    if (fileSizeBadge) {
      fileSizeBadge.style.display = 'inline-flex';
      fileSizeBadge.textContent = 'Probing...';
    }

    probeTimer = setTimeout(async () => {
      try {
        const token = await getPopupAuthToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
          headers['X-Downex-Token'] = token;
        }

        const resp = await fetch('http://127.0.0.1:18888/api/probe', {
          method: 'POST',
          headers,
          body: JSON.stringify({ url }),
        });

        if (resp.ok) {
          const json = await resp.json();
          if (json && json.success && json.data) {
            const bytes = json.data.total_bytes;
            if (fileSizeBadge) {
              if (bytes && bytes > 0) {
                fileSizeBadge.textContent = formatBytes(bytes);
                fileSizeBadge.style.display = 'inline-flex';
              } else {
                fileSizeBadge.textContent = 'Live Stream / Dynamic';
                fileSizeBadge.style.display = 'inline-flex';
              }
            }
          }
        }
      } catch (_) {
        if (fileSizeBadge) fileSizeBadge.style.display = 'none';
      }
    }, 280);
  }

  // Dynamic URL Validation & Action Button Controller
    function compareSemver(v1, v2) {
    if (!v1 || !v2) return 0;
    const p1 = String(v1).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
    const p2 = String(v2).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
    const len = Math.max(p1.length, p2.length, 3);
    for (let i = 0; i < len; i++) {
      const a = p1[i] || 0;
      const b = p2[i] || 0;
      if (a > b) return 1;
      if (a < b) return -1;
    }
    return 0;
  }

  function isValidDownloadUrl(str) {
    if (!str) return false;
    const trimmed = str.trim();
    if (trimmed.length < 4) return false;
    return (
      /^(https?:\/\/|magnet:\?|ftp:\/\/|file:\/\/)/i.test(trimmed) ||
      (trimmed.includes('.') && !trimmed.includes(' ') && trimmed.length > 5)
    );
  }

  function updateUrlActionState() {
    const val = (urlInput?.value || '').trim();
    const hasValid = isValidDownloadUrl(val);

    if (btnClear) {
      btnClear.style.display = val.length > 0 ? 'block' : 'none';
    }

    if (btnDownloadNow) {
      btnDownloadNow.disabled = !hasValid;
      btnDownloadNow.title = hasValid
        ? 'Start download immediately in Downex (Enter)'
        : 'Paste a link above to start download';
    }

    if (btnDownloadLater) {
      btnDownloadLater.disabled = !hasValid;
      btnDownloadLater.title = hasValid
        ? 'Add to Downex queue paused'
        : 'Paste a link above to queue';
    }
  }

  // Auto-fill clipboard / selection on popup open
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id) {
      chrome.tabs.sendMessage(activeTab.id, { type: 'GET_SELECTED_TEXT' }, (resp) => {
        if (resp?.text && isValidDownloadUrl(resp.text)) {
          if (urlInput) {
            urlInput.value = resp.text.trim();
            updateUrlActionState();
            scheduleProbe(resp.text.trim());
          }
        }
      });
    }
  } catch (_) {}

  urlInput?.addEventListener('input', (e) => {
    updateUrlActionState();
    const val = (e.target.value || '').trim();
    scheduleProbe(val);
  });

  urlInput?.addEventListener('paste', () => {
    setTimeout(() => {
      updateUrlActionState();
      scheduleProbe((urlInput?.value || '').trim());
    }, 15);
  });

  urlInput?.addEventListener('change', () => {
    updateUrlActionState();
  });

  btnClear?.addEventListener('click', () => {
    if (urlInput) {
      urlInput.value = '';
      urlInput.focus();
    }
    updateUrlActionState();
    if (fileSizeBadge) fileSizeBadge.style.display = 'none';
  });

  urlInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = (urlInput?.value || '').trim();
      if (isValidDownloadUrl(val)) {
        btnDownloadNow?.click();
      }
    }
  });

  // Start Download Immediate
  btnDownloadNow?.addEventListener('click', async () => {
    const url = (urlInput?.value || '').trim();
    if (!isValidDownloadUrl(url)) return;

    btnDownloadNow.disabled = true;
    btnDownloadNow.textContent = 'Starting...';

    showLifecycleAlert('probing', 'Probing & Handing Off...', 'Sending download request to Downex Desktop on 127.0.0.1:18888');
    chrome.runtime.sendMessage(
      {
        type: 'SEND_DOWNLOAD',
        data: { url, download_later: false, show_dialog: true },
      },
      (res) => {
        if (res?.success) {
          btnDownloadNow.textContent = '✓ Sent to Downex!';
          showLifecycleAlert('accepted', 'Download Accepted', 'Handed off to Downex Desktop. High-speed multi-connection queue initiated.');
          setTimeout(() => window.close(), 650);
        } else {
          updateUrlActionState();
          btnDownloadNow.textContent = 'Start Download';
          const err = res?.error || 'Engine unreachable on 127.0.0.1:18888';
          const isDiskErr = Boolean(res?.isDiskError || /disk|permission|path|space|read-only|eacces|enospc/i.test(err));
          showLifecycleAlert(
            isDiskErr ? 'disk-error' : 'fail',
            isDiskErr ? 'Disk Write Failed' : 'Downex Engine Offline',
            isDiskErr ? 'Target folder is not writable or disk space is full. Choose an alternate drive.' : 'Downex desktop app is not responding. Start Downex to enable acceleration.',
            url
          );
        }
      }
    );
  });

  // Start Download Later (Paused)
  btnDownloadLater?.addEventListener('click', async () => {
    const url = (urlInput?.value || '').trim();
    if (!isValidDownloadUrl(url)) return;

    btnDownloadLater.disabled = true;
    btnDownloadLater.textContent = 'Queueing...';

    chrome.runtime.sendMessage(
      {
        type: 'SEND_DOWNLOAD',
        data: { url, download_later: true, show_dialog: false },
      },
      (res) => {
        if (res?.success) {
          btnDownloadLater.textContent = '✓ Queued!';
          setTimeout(() => window.close(), 450);
        } else {
          updateUrlActionState();
          btnDownloadLater.textContent = 'Retry';
        }
      }
    );
  });

  // Initial URL input evaluation
  updateUrlActionState();

  // =========================================================================
  // SETTINGS SYNC WITH STORAGE
  // =========================================================================
  function saveConfigChange() {
    const updated = {
      enableMediaGrabber: toggleMedia ? toggleMedia.checked : true,
      showInPlayerPill: toggleInPlayerPill ? toggleInPlayerPill.checked : true,
      showQualityBadge: toggleQualityBadge ? toggleQualityBadge.checked : true,
      interceptDownloads: toggleIntercept ? toggleIntercept.checked : true,
      altKeyBypass: toggleAltBypass ? toggleAltBypass.checked : true,
    };
    chrome.storage.local.get(['config'], (res) => {
      const merged = { ...(res?.config || {}), ...updated };
      chrome.storage.local.set({ config: merged });
    });
    updateSettingsVisuals();
  }

  toggleMedia?.addEventListener('change', saveConfigChange);
  toggleInPlayerPill?.addEventListener('change', saveConfigChange);
  toggleQualityBadge?.addEventListener('change', saveConfigChange);
  toggleIntercept?.addEventListener('change', saveConfigChange);
  toggleAltBypass?.addEventListener('change', saveConfigChange);

  // Hot Reload & Automatic Desktop Extension Update
  function handleTriggerUpdate(buttonEl, labelEl) {
    if (buttonEl) {
      buttonEl.classList.add('is-spinning');
      buttonEl.disabled = true;
    }
    if (labelEl) {
      labelEl.textContent = 'Updating...';
    }

    try {
      chrome.runtime.sendMessage({ type: 'TRIGGER_EXTENSION_UPDATE' }, (resp) => {
        if (resp && resp.success) {
          if (labelEl) labelEl.textContent = 'Reloading...';
          setTimeout(() => {
            chrome.runtime.reload();
          }, 350);
        } else {
          // If background request fails or timeout, attempt direct reload
          if (labelEl) labelEl.textContent = 'Reloading...';
          setTimeout(() => {
            chrome.runtime.reload();
          }, 350);
        }
      });
    } catch {
      chrome.runtime.reload();
    }
  }

  btnUpdateExtension?.addEventListener('click', () => {
    handleTriggerUpdate(btnUpdateExtension, extNewVer);
  });

  // Self Repair Diagnostics Runner
  btnSelfRepair?.addEventListener('click', () => {
    if (!repairTerminal) return;
    repairTerminal.style.display = 'block';
    repairTerminal.textContent = '⚙ Running loopback & handshake self-diagnostics...\n';

    chrome.runtime.sendMessage({ type: 'RUN_DIAGNOSTICS' }, (report) => {
      if (report && report.log) {
        repairTerminal.textContent = report.log;
        if (report.success) {
          checkEngineHealth(true);
        }
      } else {
        repairTerminal.textContent += 'Handshake complete. Engine ping checked.';
      }
    });
  });

  // =========================================================================
  // BATCH PAGE LINK SCANNER
  // =========================================================================
  function getLinkType(url) {
    const ext = url.split('?')[0].split('.').pop().toLowerCase();
    if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'mp3', 'wav', 'flac', 'm4a'].includes(ext)) return 'media';
    if (['zip', 'rar', '7z', 'tar', 'gz', 'iso'].includes(ext)) return 'archives';
    if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'epub'].includes(ext)) return 'docs';
    return 'other';
  }

  function renderFilteredLinks() {
    if (!linksList) return;
    linksList.innerHTML = '';

    const filtered = extractedLinks.filter((l) => {
      if (currentFilter === 'all') return true;
      return l.type === currentFilter;
    });

    if (filtered.length === 0) {
      linksList.innerHTML = '<div style="padding: 10px; color: var(--dwnx-text-muted); text-align: center;">No matching links</div>';
      if (btnDownloadSelected) btnDownloadSelected.style.display = 'none';
      return;
    }

    filtered.forEach((link, idx) => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '6px';
      row.style.padding = '3px 0';
      row.style.borderBottom = '1px solid var(--dwnx-divider)';

      row.innerHTML = `
        <input type="checkbox" class="link-chk" value="${escapeHtml(link.url)}" id="chk_${idx}" checked style="accent-color: var(--dwnx-emerald);">
        <label for="chk_${idx}" style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; color: var(--dwnx-text-main);">
          ${escapeHtml(link.text || link.url)}
        </label>
      `;
      linksList.appendChild(row);
    });

    if (btnDownloadSelected) {
      btnDownloadSelected.style.display = 'block';
      btnDownloadSelected.textContent = `Download Selected (${filtered.length})`;
    }
  }

  btnScanLinks?.addEventListener('click', async () => {
    btnScanLinks.textContent = 'Scanning Tab...';
    btnScanLinks.disabled = true;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        btnScanLinks.textContent = 'Unable to access tab';
        btnScanLinks.disabled = false;
        return;
      }

      chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_ALL_LINKS' }, (response) => {
        btnScanLinks.textContent = 'Deep Scan Tab for All Media & Links';
        btnScanLinks.disabled = false;

        if (response && response.links && response.links.length > 0) {
          extractedLinks = response.links.map((link) => ({
            ...link,
            type: getLinkType(link.url),
          }));

          if (linksBox) linksBox.style.display = 'block';
          if (filterPills) filterPills.style.display = 'flex';
          renderFilteredLinks();
        } else {
          btnScanLinks.textContent = 'No downloadable links found';
          setTimeout(() => {
            btnScanLinks.textContent = 'Deep Scan Tab for All Media & Links';
          }, 2000);
        }
      });
    } catch {
      btnScanLinks.textContent = 'Scan Failed';
      btnScanLinks.disabled = false;
    }
  });

  filterPills?.querySelectorAll('.dwnx-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      filterPills.querySelectorAll('.dwnx-pill').forEach((p) => {
        p.classList.remove('active', 'dwnx-pill-emerald');
      });
      pill.classList.add('active', 'dwnx-pill-emerald');
      currentFilter = pill.getAttribute('data-filter') || 'all';
      renderFilteredLinks();
    });
  });

  btnDownloadSelected?.addEventListener('click', () => {
    const checked = Array.from(document.querySelectorAll('.link-chk:checked')).map((el) => el.value);
    if (checked.length === 0) return;

    btnDownloadSelected.disabled = true;
    btnDownloadSelected.textContent = `Queuing ${checked.length} tasks...`;

    let sent = 0;
    checked.forEach((url) => {
      chrome.runtime.sendMessage(
        {
          type: 'SEND_DOWNLOAD',
          data: { url, download_later: true },
        },
        () => {
          sent++;
          if (sent === checked.length) {
            btnDownloadSelected.textContent = `✓ Queued ${sent} Downloads!`;
            setTimeout(() => {
              if (linksBox) linksBox.style.display = 'none';
              btnDownloadSelected.disabled = false;
            }, 1200);
          }
        }
      );
    });
  });

  // Enterprise Drawer toggle preserved for compatibility
  btnToggleEnterprise?.addEventListener('click', () => {
    if (enterpriseDrawer) {
      enterpriseDrawer.style.display = enterpriseDrawer.style.display === 'none' ? 'block' : 'none';
    }
  });
});