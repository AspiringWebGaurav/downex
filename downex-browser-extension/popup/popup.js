/**
 * @file popup.js
 * @package Downex — Enterprise Download Accelerator Companion (MV3)
 * @author Gaurav Patil <AspiringWebGaurav>
 * @license MIT
 * @copyright Copyright (c) 2026 Gaurav Patil. All rights reserved.
 * @description Enterprise Download File Info controller with live probing, category
 *              visualizer, batch link scanner, and real-time engine telemetry.
 * @security Air-gapped 127.0.0.1:18888 loopback. Zero external network transmission.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const fileSizeBadge = document.getElementById('file-size-badge');
  const urlInput = document.getElementById('url-input');
  const btnPaste = document.getElementById('btn-paste');
  const categorySelect = document.getElementById('category-select');
  const pathPreview = document.getElementById('path-preview');
  const badgeIcon = document.getElementById('badge-icon');
  const badgeLabel = document.getElementById('badge-label');
  const btnDownloadNow = document.getElementById('btn-download-now');
  const btnDownloadLater = document.getElementById('btn-download-later');
  const toggleIntercept = document.getElementById('toggle-intercept');
  const toggleMedia = document.getElementById('toggle-media');
  const btnScanLinks = document.getElementById('btn-scan-links');
  const linksBox = document.getElementById('links-box');
  const linksList = document.getElementById('links-list');
  const filterPills = document.getElementById('filter-pills');
  const btnDownloadSelected = document.getElementById('btn-download-selected');
  const btnRefreshStatus = document.getElementById('btn-refresh-status');

  let extractedLinks = [];
  let currentFilter = 'all';

  // Category & Extension mappings (Purely visual badges - all files save directly to Downloads\Downex)
  const CATEGORY_MAP = {
    Compressed: {
      exts: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'iso', 'pkg', 'dmg', 'tgz'],
      icon: '📦',
      label: 'ARCHIVE',
      subfolder: 'Downloads\\Downex\\',
    },
    Video: {
      exts: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv', 'm4v', 'ts', 'm3u8', 'mpd'],
      icon: '🎬',
      label: 'VIDEO',
      subfolder: 'Downloads\\Downex\\',
    },
    Music: {
      exts: ['mp3', 'm4a', 'flac', 'wav', 'aac', 'ogg', 'opus', 'wma', 'mid'],
      icon: '🎵',
      label: 'AUDIO',
      subfolder: 'Downloads\\Downex\\',
    },
    Programs: {
      exts: ['exe', 'msi', 'apk', 'app', 'bat', 'cmd', 'sh', 'deb', 'rpm'],
      icon: '⚡',
      label: 'PROGRAM',
      subfolder: 'Downloads\\Downex\\',
    },
    Documents: {
      exts: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'epub'],
      icon: '📄',
      label: 'DOCUMENT',
      subfolder: 'Downloads\\Downex\\',
    },
    General: {
      exts: [],
      icon: '📁',
      label: 'FILE',
      subfolder: 'Downloads\\Downex\\',
    },
  };

  function detectCategory(filenameOrUrl) {
    const ext = filenameOrUrl.split('?')[0].split('.').pop()?.toLowerCase() || '';
    for (const [cat, data] of Object.entries(CATEGORY_MAP)) {
      if (data.exts.includes(ext)) {
        return cat;
      }
    }
    return 'General';
  }

  function updateVisualCategory(cat) {
    categorySelect.value = cat;
    const info = CATEGORY_MAP[cat] || CATEGORY_MAP.General;
    badgeIcon.textContent = info.icon;
    badgeLabel.textContent = info.label;
    pathPreview.textContent = 'Save: Downloads\\Downex\\';
  }

  categorySelect.addEventListener('change', () => {
    updateVisualCategory(categorySelect.value);
  });

  // Format bytes helper
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

  // 1. Load config
  chrome.storage.local.get(['config'], (result) => {
    if (result.config) {
      toggleIntercept.checked = result.config.interceptDownloads !== false;
      toggleMedia.checked = result.config.enableMediaGrabber !== false;
    }
  });

  // 2. Real-time Engine Connection Check
  async function checkEngineStatus() {
    statusText.textContent = 'Checking...';
    chrome.runtime.sendMessage({ type: 'PING_ENGINE' }, (response) => {
      if (response && response.isAlive) {
        statusBadge.className = 'status-badge status-connected';
        statusText.textContent = `Connected (v${response.version || '0.0.0'})`;
        chrome.runtime.sendMessage({ type: 'GET_ENGINE_DETAILS' }, (details) => {
          if (details && details.success && details.data) {
            const count = details.data.active_count || 0;
            const speed = details.data.total_speed_bytes_sec || 0;
            if (count > 0 && speed > 0) {
              statusText.textContent = `Active (${count} • ${formatBytes(speed)}/s)`;
            } else if (count > 0) {
              statusText.textContent = `Active (${count} downloading)`;
            }
          }
        });
      } else {
        statusBadge.className = 'status-badge';
        statusText.textContent = 'Engine Offline';
      }
    });
  }

  checkEngineStatus();
  statusBadge.addEventListener('click', checkEngineStatus);
  btnRefreshStatus.addEventListener('click', checkEngineStatus);

  // 3. Save Configuration on Toggle Changes
  function saveConfig() {
    chrome.storage.local.set({
      config: {
        interceptDownloads: toggleIntercept.checked,
        enableMediaGrabber: toggleMedia.checked,
      },
    });
  }
  toggleIntercept.addEventListener('change', saveConfig);
  toggleMedia.addEventListener('change', saveConfig);

  // 4. URL Probing & Auto-Categorization
  let probeTimeout = null;

  async function handleUrlInputChanged(newUrl) {
    const trimmed = (newUrl || '').trim();
    if (!trimmed || (!trimmed.startsWith('http://') && !trimmed.startsWith('https://'))) {
      fileSizeBadge.style.display = 'none';
      return;
    }

    // Fast local guess
    const fastCategory = detectCategory(trimmed);
    updateVisualCategory(fastCategory);

    // Debounced probe to Downex Engine loopback
    clearTimeout(probeTimeout);
    fileSizeBadge.style.display = 'inline-block';
    fileSizeBadge.textContent = 'Probing...';

    probeTimeout = setTimeout(async () => {
      try {
        const resp = await fetch('http://127.0.0.1:18888/api/probe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: trimmed }),
        });

        if (resp.ok) {
          const res = await resp.json();
          if (res && res.success && res.data) {
            if (res.data.filename) {
              const detected = detectCategory(res.data.filename);
              updateVisualCategory(detected);
            }
            if (res.data.total_bytes) {
              fileSizeBadge.textContent = `${formatBytes(res.data.total_bytes)}${res.data.supports_ranges ? ' • Multi-Stream' : ''}`;
            } else {
              fileSizeBadge.textContent = 'Dynamic Stream';
            }
            return;
          }
        }
        fileSizeBadge.style.display = 'none';
      } catch {
        fileSizeBadge.style.display = 'none';
      }
    }, 350);
  }

  urlInput.addEventListener('input', (e) => handleUrlInputChanged(e.target.value));

  // 5. Clipboard Auto-Detect
  async function readClipboardUrl() {
    try {
      const text = await navigator.clipboard.readText();
      if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
        return text.trim();
      }
    } catch {}
    return '';
  }

  readClipboardUrl().then((clipUrl) => {
    if (clipUrl && !urlInput.value) {
      urlInput.value = clipUrl;
      handleUrlInputChanged(clipUrl);
    }
  });

  btnPaste.addEventListener('click', async () => {
    const text = await readClipboardUrl();
    if (text) {
      urlInput.value = text;
      handleUrlInputChanged(text);
      urlInput.focus();
    }
  });

  // 6. Execute Download (Start Download vs Download Later)
  function submitDownload(downloadLater = false) {
    const url = urlInput.value.trim();
    if (!url) return;

    const cat = categorySelect.value;
    const targetBtn = downloadLater ? btnDownloadLater : btnDownloadNow;
    const origText = targetBtn.textContent;

    targetBtn.disabled = true;
    targetBtn.textContent = downloadLater ? 'Queueing...' : 'Starting...';

    chrome.runtime.sendMessage(
      {
        type: 'SEND_DOWNLOAD',
        data: {
          url,
          destinationFolder: undefined,
          download_later: downloadLater,
        },
      },
      (res) => {
        targetBtn.disabled = false;
        if (res) {
          targetBtn.textContent = downloadLater ? 'Queued in Downex!' : 'Downloading in Downex!';
          urlInput.value = '';
          fileSizeBadge.style.display = 'none';
          setTimeout(() => {
            targetBtn.textContent = origText;
          }, 2000);
        } else {
          targetBtn.textContent = 'Engine Offline';
          setTimeout(() => {
            targetBtn.textContent = origText;
          }, 2000);
        }
      }
    );
  }

  btnDownloadNow.addEventListener('click', () => submitDownload(false));
  btnDownloadLater.addEventListener('click', () => submitDownload(true));

  // 7. Batch Link Scanner
  const MEDIA_EXTS = ['mp4', 'mkv', 'webm', 'mp3', 'm4a', 'avi', 'mov', 'flv', 'wav', 'm3u8', 'mpd'];
  const ARCHIVE_EXTS = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'iso', 'exe', 'msi', 'dmg', 'pkg'];
  const DOC_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'epub', 'txt'];

  function getLinkCategory(url) {
    const ext = url.split('?')[0].split('.').pop()?.toLowerCase() || '';
    if (MEDIA_EXTS.includes(ext)) return 'media';
    if (ARCHIVE_EXTS.includes(ext)) return 'archives';
    if (DOC_EXTS.includes(ext)) return 'docs';
    return 'other';
  }

  function renderFilteredLinks() {
    linksList.innerHTML = '';
    const filtered = extractedLinks.filter((item) => {
      if (currentFilter === 'all') return true;
      return item.category === currentFilter;
    });

    if (filtered.length === 0) {
      linksList.innerHTML = '<div style="color:#71717a; padding:6px; font-size:10px;">No links match this filter.</div>';
      btnDownloadSelected.style.display = 'none';
      return;
    }

    btnDownloadSelected.style.display = 'block';
    btnDownloadSelected.textContent = `Download Selected (${filtered.length})`;

    filtered.slice(0, 100).forEach((link) => {
      const item = document.createElement('label');
      item.className = 'link-item';
      item.innerHTML = `
        <input type="checkbox" class="link-chk" value="${link.url}" checked />
        <span title="${link.url}">[${link.category.toUpperCase()}] ${link.text || link.url}</span>
      `;
      linksList.appendChild(item);
    });

    linksList.querySelectorAll('.link-chk').forEach((chk) => {
      chk.addEventListener('change', () => {
        const count = linksList.querySelectorAll('.link-chk:checked').length;
        btnDownloadSelected.textContent = `Download Selected (${count})`;
        btnDownloadSelected.disabled = count === 0;
      });
    });
  }

  filterPills.querySelectorAll('.filter-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      filterPills.querySelectorAll('.filter-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      currentFilter = pill.getAttribute('data-filter') || 'all';
      renderFilteredLinks();
    });
  });

  btnScanLinks.addEventListener('click', async () => {
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
        btnScanLinks.disabled = false;
        btnScanLinks.textContent = 'Scan Current Page for Links';

        if (!response || !response.links || response.links.length === 0) {
          linksBox.classList.add('active');
          filterPills.style.display = 'none';
          linksList.innerHTML = '<div style="color:#71717a; padding:6px; font-size:10px;">No links found on this page.</div>';
          btnDownloadSelected.style.display = 'none';
          return;
        }

        extractedLinks = response.links.map((l) => ({
          ...l,
          category: getLinkCategory(l.url),
        }));

        linksBox.classList.add('active');
        filterPills.style.display = 'flex';
        renderFilteredLinks();
      });
    } catch {
      btnScanLinks.disabled = false;
      btnScanLinks.textContent = 'Scan Error';
    }
  });

  btnDownloadSelected.addEventListener('click', () => {
    const checkboxes = linksList.querySelectorAll('.link-chk:checked');
    if (checkboxes.length === 0) return;

    btnDownloadSelected.disabled = true;
    btnDownloadSelected.textContent = `Enqueuing ${checkboxes.length}...`;

    let queued = 0;
    checkboxes.forEach((chk) => {
      chrome.runtime.sendMessage(
        {
          type: 'SEND_DOWNLOAD',
          data: { url: chk.value, showToast: false },
        },
        () => {
          queued++;
          if (queued === checkboxes.length) {
            btnDownloadSelected.textContent = `Queued ${queued} Downloads!`;
            checkEngineStatus();
            setTimeout(() => {
              btnDownloadSelected.disabled = false;
              renderFilteredLinks();
            }, 2000);
          }
        }
      );
    });
  });

  // 8. Toggle Enterprise Info & License Drawer
  const btnToggleEnterprise = document.getElementById('btn-toggle-enterprise');
  const enterpriseDrawer = document.getElementById('enterprise-drawer');
  if (btnToggleEnterprise && enterpriseDrawer) {
    btnToggleEnterprise.addEventListener('click', () => {
      const isVisible = enterpriseDrawer.style.display !== 'none';
      enterpriseDrawer.style.display = isVisible ? 'none' : 'block';
    });
  }
});
