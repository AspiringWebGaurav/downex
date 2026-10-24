/**
 * @file popup.js
 * @package Downex — Enterprise Download Accelerator Companion (MV3)
 * @author Gaurav Patil <AspiringWebGaurav>
 * @license MIT
 * @copyright Copyright (c) 2026 Gaurav Patil. All rights reserved.
 * @description Lightweight, minimal, high-output extension controller with zero-click auto-paste,
 *              live URL probing, batch link scanner, and real-time engine telemetry.
 * @security Air-gapped 127.0.0.1:18888 loopback. Zero external network transmission.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const fileSizeBadge = document.getElementById('file-size-badge');
  const urlInput = document.getElementById('url-input');
  const btnClear = document.getElementById('btn-clear');
  const pathPreview = document.getElementById('path-preview');
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
  const refreshLabel = document.getElementById('refresh-label');
  const btnToggleEnterprise = document.getElementById('btn-toggle-enterprise');
  const enterpriseDrawer = document.getElementById('enterprise-drawer');

  let extractedLinks = [];
  let currentFilter = 'all';

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
      if (toggleIntercept) toggleIntercept.checked = result.config.interceptDownloads !== false;
      if (toggleMedia) toggleMedia.checked = result.config.enableMediaGrabber !== false;
    }
  });

  // 2. Real-time Engine Connection Check & Real Refresh
  let isRefreshing = false;

  async function checkEngineStatus(isUserInitiated = false) {
    if (isRefreshing) return;
    isRefreshing = true;

    // A. Visual Loading State on both Badge & Footer Button
    if (statusBadge) {
      statusBadge.className = 'status-badge status-checking';
    }
    if (statusText) {
      statusText.textContent = 'Connecting...';
    }
    if (btnRefreshStatus) {
      btnRefreshStatus.classList.remove('is-success', 'is-offline');
      btnRefreshStatus.classList.add('is-refreshing');
      btnRefreshStatus.disabled = true;
    }
    if (refreshLabel) {
      refreshLabel.textContent = 'Checking...';
    }

    // B. Minimum visual spinner duration (550ms) to ensure smooth UX perception
    const minDelay = new Promise((resolve) => setTimeout(resolve, 550));

    // C. Real network check & live sync
    const checkPromise = (async () => {
      let isAlive = false;
      let version = '0.0.0';
      let detailsData = null;

      // Primary: Direct 0-latency loopback fetch with 1000ms abort
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 1000);
        const resp = await fetch('http://127.0.0.1:18888/api/ping', {
          method: 'GET',
          cache: 'no-store',
          signal: ctrl.signal,
        });
        clearTimeout(tid);

        if (resp.ok) {
          const res = await resp.json();
          if (res && res.success) {
            isAlive = true;
            version = res?.data?.version || '0.0.0';

            // Query active tasks and speed
            try {
              const statusResp = await fetch('http://127.0.0.1:18888/api/status', {
                method: 'GET',
                cache: 'no-store',
              });
              if (statusResp.ok) {
                const sJson = await statusResp.json();
                if (sJson && sJson.success) {
                  detailsData = sJson.data;
                }
              }
            } catch (_) {}
          }
        }
      } catch (_) {}

      // Secondary fallback via extension background messaging bus
      if (!isAlive && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        try {
          const bgResponse = await new Promise((r) => {
            chrome.runtime.sendMessage({ type: 'PING_ENGINE', force: true }, (res) => r(res));
          });
          if (bgResponse && bgResponse.isAlive) {
            isAlive = true;
            version = bgResponse.version || '0.0.0';
          }
        } catch (_) {}
      }

      return { isAlive, version, detailsData };
    })();

    const [result] = await Promise.all([checkPromise, minDelay]);

    // D. Re-scan clipboard or re-probe URL if user clicked refresh
    if (isUserInitiated) {
      const currentUrl = (urlInput?.value || '').trim();
      if (currentUrl) {
        handleUrlInputChanged(currentUrl);
      } else if (navigator.clipboard?.readText) {
        try {
          const clip = await navigator.clipboard.readText();
          const trimmedClip = (clip || '').trim();
          if (trimmedClip.startsWith('http://') || trimmedClip.startsWith('https://')) {
            if (urlInput) {
              urlInput.value = trimmedClip;
              handleUrlInputChanged(trimmedClip);
            }
          }
        } catch (_) {}
      }
    }

    // E. Render Result with Visual Confirmation
    if (btnRefreshStatus) {
      btnRefreshStatus.classList.remove('is-refreshing');
      btnRefreshStatus.disabled = false;
    }

    if (result.isAlive) {
      if (statusBadge) statusBadge.className = 'status-badge status-connected';
      if (statusText) {
        if (result.detailsData && result.detailsData.active_count > 0) {
          const count = result.detailsData.active_count;
          const speed = result.detailsData.total_speed_bytes_sec || 0;
          statusText.textContent = speed > 0 ? `Active (${count} • ${formatBytes(speed)}/s)` : `Active (${count} tasks)`;
        } else {
          statusText.textContent = `Connected (v${result.version})`;
        }
      }

      if (btnRefreshStatus) btnRefreshStatus.classList.add('is-success');
      if (refreshLabel) refreshLabel.textContent = '✓ Connected';
    } else {
      if (statusBadge) statusBadge.className = 'status-badge';
      if (statusText) statusText.textContent = 'Engine Offline';

      if (btnRefreshStatus) btnRefreshStatus.classList.add('is-offline');
      if (refreshLabel) refreshLabel.textContent = 'Offline';
    }

    // Smoothly restore 'Refresh' text after confirmation
    setTimeout(() => {
      if (btnRefreshStatus) {
        btnRefreshStatus.classList.remove('is-success', 'is-offline');
      }
      if (refreshLabel) {
        refreshLabel.textContent = 'Refresh';
      }
      isRefreshing = false;
    }, 1400);
  }

  // Initial check on popup open
  checkEngineStatus(false);

  // Click listeners for manual refresh
  statusBadge?.addEventListener('click', () => checkEngineStatus(true));
  btnRefreshStatus?.addEventListener('click', () => checkEngineStatus(true));

  // 3. Save Configuration on Toggle Changes
  function saveConfig() {
    chrome.storage.local.set({
      config: {
        interceptDownloads: toggleIntercept ? toggleIntercept.checked : true,
        enableMediaGrabber: toggleMedia ? toggleMedia.checked : true,
      },
    });
  }
  toggleIntercept?.addEventListener('change', saveConfig);
  toggleMedia?.addEventListener('change', saveConfig);

  // 4. URL Probing & Auto-Categorization
  let probeTimeout = null;

  async function handleUrlInputChanged(newUrl) {
    const trimmed = (newUrl || '').trim();

    if (btnClear) {
      btnClear.style.display = trimmed.length > 0 ? 'block' : 'none';
    }

    if (!trimmed || (!trimmed.startsWith('http://') && !trimmed.startsWith('https://'))) {
      if (fileSizeBadge) fileSizeBadge.style.display = 'none';
      return;
    }

    // Debounced probe to Downex Engine loopback
    clearTimeout(probeTimeout);
    if (fileSizeBadge) {
      fileSizeBadge.style.display = 'inline-block';
      fileSizeBadge.textContent = 'Probing...';
    }

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
            if (fileSizeBadge) {
              if (res.data.total_bytes) {
                fileSizeBadge.textContent = `${formatBytes(res.data.total_bytes)}${res.data.supports_ranges ? ' • Multi-Stream' : ''}`;
              } else {
                fileSizeBadge.textContent = 'Stream';
              }
            }
            return;
          }
        }
        if (fileSizeBadge) fileSizeBadge.style.display = 'none';
      } catch {
        if (fileSizeBadge) fileSizeBadge.style.display = 'none';
      }
    }, 350);
  }

  urlInput?.addEventListener('input', (e) => handleUrlInputChanged(e.target.value));

  // Clear button handler
  btnClear?.addEventListener('click', () => {
    if (urlInput) {
      urlInput.value = '';
      handleUrlInputChanged('');
      urlInput.focus();
    }
  });

  // Enter key starts download immediately (Less clicks, high output!)
  urlInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitDownload(false);
    }
  });

  // 5. Zero-Click Smart Auto-Detect from Clipboard on Popup Open
  try {
    navigator.clipboard.readText().then((clipUrl) => {
      const trimmed = (clipUrl || '').trim();
      if (trimmed && (trimmed.startsWith('http://') || trimmed.startsWith('https://'))) {
        if (urlInput && !urlInput.value) {
          urlInput.value = trimmed;
          handleUrlInputChanged(trimmed);
          urlInput.select();
        }
      }
    }).catch(() => {});
  } catch {}

  // 6. Execute Download (Start Download vs Download Later)
  function submitDownload(downloadLater = false) {
    if (!urlInput) return;
    const url = urlInput.value.trim();
    if (!url) {
      urlInput.focus();
      return;
    }

    const targetBtn = downloadLater ? btnDownloadLater : btnDownloadNow;
    const origText = targetBtn ? targetBtn.textContent : '';

    if (targetBtn) {
      targetBtn.disabled = true;
      targetBtn.textContent = downloadLater ? 'Queueing...' : 'Connecting...';
    }

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
        if (targetBtn) targetBtn.disabled = false;
        if (res) {
          if (targetBtn) targetBtn.textContent = downloadLater ? '✓ Queued' : '✓ Sent to Downex';
          urlInput.value = '';
          if (btnClear) btnClear.style.display = 'none';
          if (fileSizeBadge) fileSizeBadge.style.display = 'none';
          setTimeout(() => {
            if (targetBtn) targetBtn.textContent = origText;
            window.close(); // Cleanly close popup on success
          }, 600);
        } else {
          if (targetBtn) {
            targetBtn.textContent = 'Engine Offline';
            setTimeout(() => {
              targetBtn.textContent = origText;
            }, 2000);
          }
        }
      }
    );
  }

  btnDownloadNow?.addEventListener('click', () => submitDownload(false));
  btnDownloadLater?.addEventListener('click', () => submitDownload(true));

  // 7. High-Output Batch Link Scanner
  const MEDIA_EXTS = ['mp4', 'mkv', 'webm', 'mp3', 'm4a', 'avi', 'mov', 'flv', 'wav', 'm3u8', 'mpd'];
  const ARCHIVE_EXTS = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'iso', 'exe', 'msi', 'dmg', 'pkg'];
  const DOC_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'epub', 'txt'];

  function getLinkType(url) {
    const ext = url.split('?')[0].split('.').pop()?.toLowerCase() || '';
    if (MEDIA_EXTS.includes(ext)) return 'media';
    if (ARCHIVE_EXTS.includes(ext)) return 'archives';
    if (DOC_EXTS.includes(ext)) return 'docs';
    return 'other';
  }

  function renderFilteredLinks() {
    if (!linksList || !btnDownloadSelected) return;
    linksList.innerHTML = '';
    const filtered = extractedLinks.filter((item) => {
      if (currentFilter === 'all') return true;
      return item.type === currentFilter;
    });

    if (filtered.length === 0) {
      linksList.innerHTML = '<div style="color:#64748b; padding:6px; font-size:10px;">No links match this filter.</div>';
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
        <span title="${link.url}">${link.text || link.url}</span>
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

  filterPills?.querySelectorAll('.filter-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      filterPills.querySelectorAll('.filter-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      currentFilter = pill.getAttribute('data-filter') || 'all';
      renderFilteredLinks();
    });
  });

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
        btnScanLinks.textContent = 'Scan Tab for Media & Links';
        btnScanLinks.disabled = false;

        if (response && response.links && response.links.length > 0) {
          extractedLinks = response.links.map((link) => ({
            ...link,
            type: getLinkType(link.url),
          }));

          if (linksBox) linksBox.classList.add('active');
          if (filterPills) filterPills.style.display = 'flex';
          renderFilteredLinks();
        } else {
          btnScanLinks.textContent = 'No downloadable links found';
          setTimeout(() => {
            btnScanLinks.textContent = 'Scan Tab for Media & Links';
          }, 2000);
        }
      });
    } catch {
      btnScanLinks.textContent = 'Scan Failed';
      btnScanLinks.disabled = false;
    }
  });

  // Batch Download Selected Links
  btnDownloadSelected?.addEventListener('click', () => {
    const checked = Array.from(document.querySelectorAll('.link-chk:checked')).map((el) => el.value);
    if (checked.length === 0) return;

    btnDownloadSelected.disabled = true;
    btnDownloadSelected.textContent = `Sending ${checked.length} tasks...`;

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
              if (linksBox) linksBox.classList.remove('active');
              if (filterPills) filterPills.style.display = 'none';
              btnDownloadSelected.disabled = false;
            }, 1200);
          }
        }
      );
    });
  });

  // 8. Enterprise Drawer Toggle
  btnToggleEnterprise?.addEventListener('click', () => {
    if (enterpriseDrawer) {
      enterpriseDrawer.style.display = enterpriseDrawer.style.display === 'none' ? 'block' : 'none';
    }
  });
});
