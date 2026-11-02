/**
 * @file options.js
 * @package Downex Browser Extension
 * @description Dedicated Full-Tab Management Dashboard Controller
 *              Parity with Downex Desktop SettingsView and DownexSidebar.
 */

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof DownexIcons !== 'undefined') {
    DownexIcons.render(document);
  }

  // Navigation Selectors
  const navItems = document.querySelectorAll('.nav-item');
  const sections = {
    overview: document.getElementById('section-overview'),
    rules: document.getElementById('section-rules'),
    media: document.getElementById('section-media'),
    batch: document.getElementById('section-batch'),
    diagnostics: document.getElementById('section-diagnostics'),
  };

  const pageTitle = document.getElementById('page-title-text');
  const pageSubtitle = document.getElementById('page-subtitle');
  const saveToast = document.getElementById('save-toast');
  const btnResetDefaults = document.getElementById('btn-reset-defaults');
  const btnThemeToggle = document.getElementById('btn-theme-toggle');
  const themeBtnLabel = document.getElementById('theme-btn-label');
  const sidebarEnginePill = document.getElementById('sidebar-engine-pill');
  const sidebarEngineText = document.getElementById('sidebar-engine-text');
  const dashboardOfflineBanner = document.getElementById('dashboard-offline-banner');
  const btnDashboardRetry = document.getElementById('btn-dashboard-retry');
  const dashboardExtVer = document.getElementById('dashboard-ext-ver');

  // Overview Elements
  const valEngineStatus = document.getElementById('val-engine-status');
  const valAppVersion = document.getElementById('val-app-version');
  const valPingLatency = document.getElementById('val-ping-latency');
  const valTokenPreview = document.getElementById('val-token-preview');
  const btnReloadExt = document.getElementById('btn-reload-ext');

  // Rules Elements
  const rulesToggleIntercept = document.getElementById('rules-toggle-intercept');
  const rulesToggleAlt = document.getElementById('rules-toggle-alt');
  const rulesMinSize = document.getElementById('rules-min-size');
  const tagCloudExtensions = document.getElementById('tag-cloud-extensions');
  const inputNewExtension = document.getElementById('input-new-extension');
  const btnAddExtension = document.getElementById('btn-add-extension');

  // Media Elements
  const mediaToggleMaster = document.getElementById('media-toggle-master');
  const mediaTogglePill = document.getElementById('media-toggle-pill');
  const mediaToggleBadge = document.getElementById('media-toggle-badge');

  // Batch Scanner Elements
  const btnBatchScan = document.getElementById('btn-batch-scan');
  const batchTableBody = document.getElementById('batch-table-body');
  const batchCheckAll = document.getElementById('batch-check-all');
  const btnBatchDownload = document.getElementById('btn-batch-download');
  const batchFilterBtns = document.querySelectorAll('[data-batch-filter]');

  // Diagnostics Elements
  const btnRunPingTest = document.getElementById('btn-run-ping-test');
  const btnRefreshToken = document.getElementById('btn-refresh-token');
  const btnRunFullRepair = document.getElementById('btn-run-full-repair');
  const diagnosticLog = document.getElementById('diagnostic-log');

  const SECTION_METADATA = {
    overview: {
      title: 'Overview & Engine Bridge',
      subtitle: 'Real-time status of Downex desktop engine and browser extension bridge.',
      icon: 'activity',
    },
    rules: {
      title: 'Download Interception & Rules',
      subtitle: 'Configure automated file catching, filetype extensions, and bypass options.',
      icon: 'sliders',
    },
    media: {
      title: 'Media & Stream Sniffer',
      subtitle: 'Customize video grabber sensitivity, floating pills, and quality badges.',
      icon: 'video',
    },
    batch: {
      title: 'Batch Page Scanner',
      subtitle: 'Extract and queue all downloadable media, archives, and files from open tabs.',
      icon: 'layers',
    },
    diagnostics: {
      title: 'Diagnostics & Self-Repair',
      subtitle: 'Test loopback latency, re-negotiate tokens, and audit extension health.',
      icon: 'wrench',
    },
  };

  const DEFAULT_EXTENSIONS = [
    'zip', 'rar', '7z', 'iso', 'tar', 'gz', 'exe', 'msi', 'bin', 'apk',
    'mkv', 'mp4', 'avi', 'mov', 'webm', 'flac', 'mp3', 'wav', 'pdf'
  ];

  let currentCapturedExtensions = [...DEFAULT_EXTENSIONS];
  let extractedBatchLinks = [];
  let currentBatchFilter = 'all';

  // Read Version
  try {
    const manifest = chrome.runtime?.getManifest?.();
    if (dashboardExtVer && manifest?.version) {
      dashboardExtVer.textContent = `v${manifest.version}`;
    }
  } catch (_) { }

  // =========================================================================
  // THEME SYNCHRONIZATION
  // =========================================================================
  function applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.setAttribute('data-theme', 'dark');
      if (btnThemeToggle && typeof DownexIcons !== 'undefined') {
        btnThemeToggle.innerHTML = `${DownexIcons.svg('sun', 13)}<span id="theme-btn-label">Light Theme</span>`;
      }
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.setAttribute('data-theme', 'light');
      if (btnThemeToggle && typeof DownexIcons !== 'undefined') {
        btnThemeToggle.innerHTML = `${DownexIcons.svg('moon', 13)}<span id="theme-btn-label">Dark Theme</span>`;
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
  } catch (_) { }

  btnThemeToggle?.addEventListener('click', () => {
    const isDark = document.documentElement.classList.contains('dark');
    const next = isDark ? 'light' : 'dark';
    applyTheme(next);
    chrome.storage.local.set({ downex_theme: next });
  });

  // =========================================================================
  // NAVIGATION CONTROLLER
  // =========================================================================
  navItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      const sectionKey = btn.getAttribute('data-section');
      if (!sectionKey) return;

      navItems.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      Object.entries(sections).forEach(([key, el]) => {
        if (el) {
          if (key === sectionKey) {
            el.classList.add('active');
          } else {
            el.classList.remove('active');
          }
        }
      });

      const meta = SECTION_METADATA[sectionKey];
      if (meta && pageTitle && pageSubtitle) {
        pageTitle.textContent = meta.title;
        pageSubtitle.textContent = meta.subtitle;
        const iconContainer = document.getElementById('page-title')?.querySelector('[data-icon]');
        if (iconContainer && typeof DownexIcons !== 'undefined') {
          iconContainer.setAttribute('data-icon', meta.icon);
          DownexIcons.render(document.getElementById('page-title'));
        }
      }
    });
  });

  function showSaveToast() {
    if (!saveToast) return;
    saveToast.style.display = 'inline-flex';
    setTimeout(() => {
      saveToast.style.display = 'none';
    }, 2000);
  }

  // =========================================================================
  // OVERVIEW & TELEMETRY
  // =========================================================================
  async function refreshTelemetry() {
    const start = performance.now();
    let isAlive = false;
    let version = '0.0.0';
    let token = null;

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
        const data = await resp.json();
        if (data && data.success) {
          isAlive = true;
          version = data?.data?.version || '0.0.0';
          token = data.token || data?.data?.token;
        }
      }
    } catch (_) { }

    if (!isAlive && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        const bgRes = await new Promise((r) => {
          chrome.runtime.sendMessage({ type: 'PING_ENGINE', force: true }, (res) => r(res));
        });
        if (bgRes && bgRes.isAlive) {
          isAlive = true;
          version = bgRes.version || '0.0.0';
        }
      } catch (_) { }
    }

    const elapsed = Math.max(1, Math.round(performance.now() - start));

    if (isAlive) {
      if (dashboardOfflineBanner) dashboardOfflineBanner.style.display = 'none';
      if (valEngineStatus) {
        valEngineStatus.textContent = 'Connected';
        valEngineStatus.style.color = 'var(--dwnx-emerald-dark)';
      }
      if (valAppVersion) valAppVersion.textContent = `v${version}`;
      if (valPingLatency) valPingLatency.textContent = `${elapsed} ms`;
      if (sidebarEnginePill) {
        sidebarEnginePill.className = 'dwnx-pill dwnx-pill-emerald';
        if (sidebarEngineText) sidebarEngineText.textContent = `Connected (${elapsed}ms)`;
      }
      if (token) {
        chrome.storage.local.set({ downex_auth_token: token });
      }
    } else {
      if (dashboardOfflineBanner) dashboardOfflineBanner.style.display = 'block';
      if (valEngineStatus) {
        valEngineStatus.textContent = 'Offline';
        valEngineStatus.style.color = 'var(--dwnx-danger)';
      }
      if (valPingLatency) valPingLatency.textContent = 'Timeout';
      if (sidebarEnginePill) {
        sidebarEnginePill.className = 'dwnx-pill';
        if (sidebarEngineText) sidebarEngineText.textContent = 'Offline (127.0.0.1)';
      }
      if (btnDashboardRetry) {
        btnDashboardRetry.innerHTML = '<span style="color:var(--dwnx-danger);font-weight:600;">✕ No Connection</span>';
        setTimeout(() => {
          btnDashboardRetry.innerHTML = '<span data-icon="refresh" data-icon-size="11"></span><span>Retry Connection</span>';
          if (typeof DownexIcons !== 'undefined') DownexIcons.render(btnDashboardRetry);
        }, 1600);
      }
    }

    chrome.storage.local.get(['downex_auth_token'], (stored) => {
      if (valTokenPreview) {
        const tok = token || stored?.downex_auth_token;
        if (tok) {
          valTokenPreview.textContent = `${tok.substring(0, 8)}...${tok.substring(tok.length - 6)}`;
        } else {
          valTokenPreview.textContent = 'Negotiating...';
        }
      }
    });
  }

  refreshTelemetry();
  setInterval(refreshTelemetry, 8000);

  sidebarEnginePill?.addEventListener('click', refreshTelemetry);
  btnReloadExt?.addEventListener('click', () => chrome.runtime.reload());

  // =========================================================================
  // RULES & EXTENSIONS MANAGEMENT
  // =========================================================================
  function renderExtensionTags() {
    if (!tagCloudExtensions) return;
    tagCloudExtensions.innerHTML = '';

    currentCapturedExtensions.forEach((ext) => {
      const tag = document.createElement('span');
      tag.className = 'file-tag';
      tag.innerHTML = `
        <span>.${ext}</span>
        <button type="button" class="tag-remove" data-ext="${ext}" title="Remove .${ext}">✕</button>
      `;

      tag.querySelector('.tag-remove')?.addEventListener('click', () => {
        currentCapturedExtensions = currentCapturedExtensions.filter((e) => e !== ext);
        renderExtensionTags();
        persistConfig();
      });

      tagCloudExtensions.appendChild(tag);
    });
  }

  function addExtension() {
    const val = (inputNewExtension?.value || '').trim().toLowerCase().replace(/^\./, '');
    if (!val || currentCapturedExtensions.includes(val)) return;

    currentCapturedExtensions.push(val);
    if (inputNewExtension) inputNewExtension.value = '';
    renderExtensionTags();
    persistConfig();
  }

  btnAddExtension?.addEventListener('click', addExtension);
  inputNewExtension?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addExtension();
    }
  });

  // Load configuration
  chrome.storage.local.get(['config', 'captured_extensions'], (res) => {
    const cfg = res?.config || {};
    if (rulesToggleIntercept) rulesToggleIntercept.checked = cfg.interceptDownloads !== false;
    if (rulesToggleAlt) rulesToggleAlt.checked = cfg.altKeyBypass !== false;
    if (rulesMinSize && cfg.minFileSizeForIntercept !== undefined) {
      rulesMinSize.value = String(cfg.minFileSizeForIntercept);
    }

    if (mediaToggleMaster) mediaToggleMaster.checked = cfg.enableMediaGrabber !== false;
    if (mediaTogglePill) mediaTogglePill.checked = cfg.showInPlayerPill !== false;
    if (mediaToggleBadge) mediaToggleBadge.checked = cfg.showQualityBadge !== false;

    if (res?.captured_extensions && Array.isArray(res.captured_extensions)) {
      currentCapturedExtensions = res.captured_extensions;
    }
    renderExtensionTags();
  });

  function persistConfig() {
    const updatedConfig = {
      interceptDownloads: rulesToggleIntercept ? rulesToggleIntercept.checked : true,
      altKeyBypass: rulesToggleAlt ? rulesToggleAlt.checked : true,
      minFileSizeForIntercept: rulesMinSize ? parseInt(rulesMinSize.value, 10) : 1048576,
      enableMediaGrabber: mediaToggleMaster ? mediaToggleMaster.checked : true,
      showInPlayerPill: mediaTogglePill ? mediaTogglePill.checked : true,
      showQualityBadge: mediaToggleBadge ? mediaToggleBadge.checked : true,
    };

    chrome.storage.local.get(['config'], (res) => {
      const merged = { ...(res?.config || {}), ...updatedConfig };
      chrome.storage.local.set({
        config: merged,
        captured_extensions: currentCapturedExtensions,
      }, () => {
        showSaveToast();
      });
    });
  }

  rulesToggleIntercept?.addEventListener('change', persistConfig);
  rulesToggleAlt?.addEventListener('change', persistConfig);
  rulesMinSize?.addEventListener('change', persistConfig);
  mediaToggleMaster?.addEventListener('change', persistConfig);
  mediaTogglePill?.addEventListener('change', persistConfig);
  mediaToggleBadge?.addEventListener('change', persistConfig);

  // Reset to Defaults
  btnResetDefaults?.addEventListener('click', () => {
    if (rulesToggleIntercept) rulesToggleIntercept.checked = true;
    if (rulesToggleAlt) rulesToggleAlt.checked = true;
    if (rulesMinSize) rulesMinSize.value = '1048576';
    if (mediaToggleMaster) mediaToggleMaster.checked = true;
    if (mediaTogglePill) mediaTogglePill.checked = true;
    if (mediaToggleBadge) mediaToggleBadge.checked = true;
    currentCapturedExtensions = [...DEFAULT_EXTENSIONS];
    renderExtensionTags();
    persistConfig();
  });

  // =========================================================================
  // BATCH SCANNER TAB
  // =========================================================================
  function getLinkType(url) {
    const ext = url.split('?')[0].split('.').pop().toLowerCase();
    if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'mp3', 'wav', 'flac', 'm4a'].includes(ext)) return 'media';
    if (['zip', 'rar', '7z', 'tar', 'gz', 'iso'].includes(ext)) return 'archives';
    if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'epub'].includes(ext)) return 'docs';
    return 'other';
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderBatchTable() {
    if (!batchTableBody) return;
    batchTableBody.innerHTML = '';

    const filtered = extractedBatchLinks.filter((l) => {
      if (currentBatchFilter === 'all') return true;
      return l.type === currentBatchFilter;
    });

    if (filtered.length === 0) {
      batchTableBody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align: center; color: var(--dwnx-text-muted); padding: 20px;">
            No downloadable links match current category.
          </td>
        </tr>
      `;
      if (btnBatchDownload) btnBatchDownload.disabled = true;
      return;
    }

    filtered.forEach((link, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="checkbox" class="batch-chk" value="${escapeHtml(link.url)}" id="batch_chk_${idx}" checked style="accent-color: var(--dwnx-emerald);"></td>
        <td style="font-weight: 600; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <label for="batch_chk_${idx}" style="cursor: pointer;">${escapeHtml(link.text || link.url.split('/').pop() || 'Download Item')}</label>
        </td>
        <td><span class="dwnx-pill" style="font-size: 9.5px;">${link.type.toUpperCase()}</span></td>
        <td style="font-family: var(--dwnx-font-mono); font-size: 10.5px; color: var(--dwnx-text-muted); max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${escapeHtml(link.url)}
        </td>
      `;
      batchTableBody.appendChild(tr);
    });

    if (btnBatchDownload) {
      btnBatchDownload.disabled = false;
      btnBatchDownload.innerHTML = `${DownexIcons.svg('download', 13)}<span>Queue Selected in Downex (${filtered.length})</span>`;
    }
  }

  btnBatchScan?.addEventListener('click', async () => {
    btnBatchScan.disabled = true;
    btnBatchScan.textContent = 'Scanning tab...';

    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const targetTab = tabs[0];
      if (!targetTab?.id) {
        btnBatchScan.disabled = false;
        btnBatchScan.textContent = 'Scan Active Browser Tab';
        return;
      }

      chrome.tabs.sendMessage(targetTab.id, { type: 'EXTRACT_ALL_LINKS' }, (resp) => {
        btnBatchScan.disabled = false;
        btnBatchScan.innerHTML = `${DownexIcons.svg('search', 13)}<span>Scan Active Browser Tab</span>`;

        if (resp && resp.links && resp.links.length > 0) {
          extractedBatchLinks = resp.links.map((l) => ({
            ...l,
            type: getLinkType(l.url),
          }));
          renderBatchTable();
        } else {
          if (batchTableBody) {
            batchTableBody.innerHTML = `
              <tr>
                <td colspan="4" style="text-align: center; color: var(--dwnx-text-muted); padding: 20px;">
                  No downloadable links found on active tab.
                </td>
              </tr>
            `;
          }
        }
      });
    } catch {
      btnBatchScan.disabled = false;
      btnBatchScan.textContent = 'Scan Active Browser Tab';
    }
  });

  batchFilterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      batchFilterBtns.forEach((b) => b.classList.remove('active', 'dwnx-pill-emerald'));
      btn.classList.add('active', 'dwnx-pill-emerald');
      currentBatchFilter = btn.getAttribute('data-batch-filter') || 'all';
      renderBatchTable();
    });
  });

  batchCheckAll?.addEventListener('change', () => {
    const isChecked = batchCheckAll.checked;
    document.querySelectorAll('.batch-chk').forEach((chk) => {
      chk.checked = isChecked;
    });
  });

  btnBatchDownload?.addEventListener('click', () => {
    const checked = Array.from(document.querySelectorAll('.batch-chk:checked')).map((el) => el.value);
    if (checked.length === 0) return;

    btnBatchDownload.disabled = true;
    btnBatchDownload.textContent = `Queueing ${checked.length} tasks...`;

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
            btnBatchDownload.textContent = `✓ Successfully Queued ${sent} Downloads!`;
            setTimeout(() => {
              btnBatchDownload.disabled = false;
              renderBatchTable();
            }, 1500);
          }
        }
      );
    });
  });

  // =========================================================================
  // DIAGNOSTICS & SELF-REPAIR
  // =========================================================================
  btnRunPingTest?.addEventListener('click', async () => {
    if (!diagnosticLog) return;
    const now = new Date().toLocaleTimeString();
    diagnosticLog.textContent += `\n[${now}] ➔ Pinging Downex Engine on 127.0.0.1:18888...`;

    const start = performance.now();
    try {
      const resp = await fetch('http://127.0.0.1:18888/api/ping', {
        method: 'GET',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' },
      });
      const elapsed = Math.max(1, Math.round(performance.now() - start));
      if (resp.ok) {
        const res = await resp.json();
        diagnosticLog.textContent += `\n[${now}] ✓ Engine responded in ${elapsed}ms (Engine v${res?.data?.version || '0.0.0'}). Socket healthy.\n`;
      } else {
        diagnosticLog.textContent += `\n[${now}] ✕ HTTP error ${resp.status}.\n`;
      }
    } catch (e) {
      diagnosticLog.textContent += `\n[${now}] ✕ Connection failed: ${e.message}. Ensure Downex desktop app is running.\n`;
    }
    refreshTelemetry();
    diagnosticLog.scrollTop = diagnosticLog.scrollHeight;
  });

btnRefreshToken?.addEventListener('click', () => {
  if (!diagnosticLog) return;
  const now = new Date().toLocaleTimeString();
  diagnosticLog.textContent += `\n[${now}] ➔ Clearing cached auth token and re-requesting handshake...`;

  chrome.runtime.sendMessage({ type: 'RETRY_CONNECTION' }, (res) => {
    if (res?.isAlive) {
      diagnosticLog.textContent += `\n[${now}] ✓ Handshake complete. Fresh token received.\n`;
      refreshTelemetry();
    } else {
      diagnosticLog.textContent += `\n[${now}] ✕ Handshake renegotiation failed.\n`;
    }
    diagnosticLog.scrollTop = diagnosticLog.scrollHeight;
  });
});

btnRunFullRepair?.addEventListener('click', () => {
  if (!diagnosticLog) return;
  const now = new Date().toLocaleTimeString();
  diagnosticLog.textContent += `\n[${now}] ➔ Initiating Full Self-Repair Protocol...`;

  chrome.runtime.sendMessage({ type: 'RUN_DIAGNOSTICS' }, (report) => {
    if (report?.log) {
      diagnosticLog.textContent += `\n${report.log}\n`;
    } else {
      diagnosticLog.textContent += `\n[${now}] ✓ Self-repair complete.\n`;
    }
    refreshTelemetry();
    diagnosticLog.scrollTop = diagnosticLog.scrollHeight;
  });
});
});

