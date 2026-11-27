import React, { useState, useEffect } from 'react';
import { updateService } from '../services/updateService';
import { 
  injectMockDownloadItem, 
  clearMockDownloads, 
  notifyDownloadsCompletedNative,
  showDownloadCompleteDialog,
  type DownloadCompletePayload,
} from '../services/tauriService';
import { useDownloadStore } from '../stores/downloadStore';
import { useAppVersionStore } from '../stores/appVersionStore';
import { useMarqueeNoticeStore } from '../stores/marqueeNoticeStore';
import { DownloadItem } from '../types/download';
import { ENV_MODE_CHANGED_EVENT, installDevEnvOverrideWatcher, isDevEnvironment } from '../utils/reloadGuard';
import { 
  FlaskConical,
  Play, 
  Pause,
  CheckCircle2,
  ChevronUp, 
  ChevronDown, 
  Plus, 
  Trash2,
  Zap,
  Activity,
  FileDown,
  Sparkles,
  RotateCcw,
  Sun,
  Moon,
  Globe,
  AlertTriangle,
  Clock,
  Layers,
  RefreshCw,
  Bell,
  Gauge,
  ExternalLink,
} from 'lucide-react';

type DevTab = 'downloads' | 'modals' | 'ota' | 'system';

export const DevUpdateSimulator: React.FC = () => {
  const isBuildDev = Boolean(import.meta.env.DEV) && !import.meta.env.PROD;

  const [isDev, setIsDev] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !isBuildDev) return false;
    if (!isDevEnvironment()) return false;
    try {
      return localStorage.getItem('downex_dev_qa_enabled') !== 'false';
    } catch {
      return true;
    }
  });

  const [isOpen, setIsOpen] = useState(false);
  const [isDotMode, setIsDotMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('downex_dev_qa_dot_mode') === 'true';
    } catch {
      return false;
    }
  });
  const [activeTab, setActiveTab] = useState<DevTab>('downloads');
  const [isLiveTickerActive, setIsLiveTickerActive] = useState(true);
  const currentVersion = useAppVersionStore((state) => state.currentVersion);
  const otaStatus = useAppVersionStore((state) => state.status);
  const notices = useMarqueeNoticeStore((state) => state.notices);
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof document === 'undefined') return false;
    return document.documentElement.classList.contains('dark');
  });
  const [isResettingBase, setIsResettingBase] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const syncTheme = () => setIsDark(root.classList.contains('dark'));
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const showFeedback = (msg: string, duration = 3200) => {
    setActionFeedback(msg);
    setTimeout(() => {
      setActionFeedback((prev) => (prev === msg ? null : prev));
    }, duration);
  };

  // Dynamically react to Dev/Production environment changes and localStorage flag
  useEffect(() => {
    if (!isBuildDev) return;
    installDevEnvOverrideWatcher();

    const syncDevState = () => {
      let enabled = true;
      try {
        enabled = localStorage.getItem('downex_dev_qa_enabled') !== 'false';
      } catch {}
      const active = isDevEnvironment() && enabled;
      setIsDev(active);
      if (!active) {
        setIsOpen(false);
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === 'downex_dev_qa_enabled') {
        syncDevState();
      }
    };

    syncDevState();
    window.addEventListener(ENV_MODE_CHANGED_EVENT, syncDevState);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(ENV_MODE_CHANGED_EVENT, syncDevState);
      window.removeEventListener('storage', handleStorage);
    };
  }, [isBuildDev]);

  // Keyboard shortcut: Ctrl + Shift + D toggles QA panel anywhere (strictly dev-only)
  useEffect(() => {
    if (!isBuildDev || !isDev || !isDevEnvironment()) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isDevEnvironment()) return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    (window as any).__DOWNEX_TOGGLE_QA__ = () => {
      if (isDevEnvironment()) setIsOpen((prev) => !prev);
    };
    (window as any).__DOWNEX_ENABLE_QA__ = (enabled = true) => {
      try {
        localStorage.setItem('downex_dev_qa_enabled', String(enabled));
      } catch {}
      setIsDev(Boolean(enabled) && isDevEnvironment());
    };
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      delete (window as any).__DOWNEX_TOGGLE_QA__;
      delete (window as any).__DOWNEX_ENABLE_QA__;
    };
  }, [isBuildDev, isDev]);

  // Live Speed Limiter Simulation Loop (Ticks every 500ms for active mock downloads)
  useEffect(() => {
    if (!isDev || !isLiveTickerActive) return;

    const interval = setInterval(() => {
      const items = useDownloadStore.getState().items;
      const hasActiveMock = items.some(
        (i) => i.id.startsWith('mock-') && i.status === 'downloading'
      );
      if (!hasActiveMock) return;

      const completedPayloads: DownloadCompletePayload[] = [];

      useDownloadStore.setState((state) => {
        let changed = false;
        let addedBytesTotal = 0;
        const newItems = state.items.map((item) => {
          if (!item.id.startsWith('mock-') || item.status !== 'downloading') {
            return item;
          }

          changed = true;
          const total = item.total_bytes || 5242880000;
          const naturalBase = item.base_speed_bytes_sec || 12500000; // ~100 Mbps natural baseline

          // If speed limiter is active, throttle to capped rate; otherwise use natural rate
          let effectiveRate: number;
          if (item.speed_limit_mbps && item.speed_limit_mbps > 0) {
            const cappedRate = (item.speed_limit_mbps * 1_000_000) / 8;
            effectiveRate = cappedRate * (0.985 + Math.random() * 0.03);
          } else {
            effectiveRate = naturalBase * (0.98 + Math.random() * 0.04);
          }

          const addedBytes = Math.round(effectiveRate * 0.5);
          addedBytesTotal += addedBytes;
          const newDownloaded = Math.min(total, item.downloaded_bytes + addedBytes);
          const isComplete = newDownloaded >= total;
          if (isComplete) {
            completedPayloads.push({
              id: item.id,
              url: item.url || `https://cdn.example.org/${encodeURIComponent(item.filename)}`,
              filename: item.filename,
              destination_path: item.destination_path,
              total_bytes: total,
              downloaded_bytes: newDownloaded,
            });
          }

          const remainingBytes = Math.max(0, total - newDownloaded);
          const etaSec = isComplete
            ? 0
            : Math.max(1, Math.round(remainingBytes / Math.max(1, effectiveRate)));

          const updatedSegments = (item.segments || []).map((seg) => {
            if (!seg.is_active) return seg;
            const segChunk = Math.round(addedBytes / Math.max(1, item.segments?.length || 1));
            return {
              ...seg,
              downloaded: Math.min(seg.end - seg.start, seg.downloaded + segChunk),
              speed_bytes_sec: Math.round(effectiveRate / Math.max(1, item.segments?.length || 1)),
            };
          });

          return {
            ...item,
            downloaded_bytes: newDownloaded,
            speed_bytes_sec: isComplete ? 0 : Math.round(effectiveRate),
            eta_seconds: etaSec,
            status: isComplete ? ('completed' as const) : ('downloading' as const),
            segments: updatedSegments,
          };
        });

        if (changed) {
          // Persist updated mocks in sessionStorage so Tauri getDownloads() keeps live progress
          const mocksOnly = newItems.filter((i) => i.id.startsWith('mock-'));
          try {
            sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mocksOnly));
          } catch {}

          const activeTotalSpeed = newItems
            .filter((i) => i.status === 'downloading')
            .reduce((acc, curr) => acc + (curr.speed_bytes_sec || 0), 0);

          return {
            items: newItems,
            totalSpeed: activeTotalSpeed,
            peakSpeed: Math.max(state.peakSpeed, activeTotalSpeed),
            speedHistory: [...state.speedHistory.slice(1), activeTotalSpeed],
            sessionDownloadedBytes: state.sessionDownloadedBytes + addedBytesTotal,
            lifetimeDownloadedBytes: state.lifetimeDownloadedBytes + addedBytesTotal,
          };
        }

        return state;
      });

      if (completedPayloads.length > 0) {
        for (const payload of completedPayloads) {
          showDownloadCompleteDialog(payload).catch(() => {});
        }
      }
    }, 500);

    return () => clearInterval(interval);
  }, [isDev, isLiveTickerActive]);

  if (!isBuildDev || !isDev || !isDevEnvironment()) {
    return null;
  }

  // --- Handlers: Mock Downloads ---
  const startSpeedTestDownload = (planMbps: 30 | 100 | 200 | 500 | 1000) => {
    const plans = {
      30: {
        filename: 'driver-pack-2026.zip',
        total: 1258291200, // 1.2 GB
        downloaded: 314572800, // 25%
        speedBps: 3625000, // ~29 Mbps
        eta: 260,
      },
      100: {
        filename: 'ubuntu-24.04-desktop-amd64.iso',
        total: 4800000000, // 4.8 GB
        downloaded: 1200000000, // 25%
        speedBps: 12250000, // ~98 Mbps
        eta: 293,
      },
      200: {
        filename: 'large-dataset-v2.tar.gz',
        total: 10485760000, // 10.5 GB
        downloaded: 3460300800, // 33%
        speedBps: 24500000, // ~196 Mbps
        eta: 286,
      },
      500: {
        filename: 'enterprise-backup-image.vhdx',
        total: 26214400000, // 25 GB
        downloaded: 10485760000, // 40%
        speedBps: 61250000, // ~490 Mbps
        eta: 256,
      },
      1000: {
        filename: 'ultrawide-rendering-assets-4k.raw',
        total: 52428800000, // 50 GB
        downloaded: 15728640000, // 30%
        speedBps: 122500000, // ~980 Mbps (Gigabit)
        eta: 300,
      },
    };

    const cfg = plans[planMbps];
    const segmentCount = 8;
    const chunkSize = Math.floor(cfg.total / segmentCount);
    const mockSegments = Array.from({ length: segmentCount }, (_, idx) => {
      const start = idx * chunkSize;
      const end = idx === segmentCount - 1 ? cfg.total - 1 : (idx + 1) * chunkSize - 1;
      const segDownloaded = Math.floor(cfg.downloaded / segmentCount);
      return {
        index: idx,
        start,
        end,
        downloaded: Math.min(end - start, segDownloaded),
        speed_bytes_sec: Math.floor(cfg.speedBps / segmentCount),
        is_active: true,
      };
    });

    const activeMock: DownloadItem = {
      id: 'mock-active-' + Date.now(),
      url: `https://cdn.example.org/${cfg.filename}`,
      filename: cfg.filename,
      destination_path: `C:\\Downloads\\Downex\\${cfg.filename}`,
      total_bytes: cfg.total,
      downloaded_bytes: cfg.downloaded,
      status: 'downloading',
      queue_id: 'default',
      speed_bytes_sec: cfg.speedBps,
      base_speed_bytes_sec: cfg.speedBps,
      eta_seconds: cfg.eta,
      supports_ranges: true,
      created_at: Date.now() - 60000,
      updated_at: Date.now(),
      segments: mockSegments,
    };

    injectMockDownloadItem(activeMock);
    useDownloadStore.setState((prev) => ({
      items: [activeMock, ...prev.items.filter((i) => i.filename !== cfg.filename)],
      selectedView: 'all',
      totalSpeed: prev.totalSpeed + cfg.speedBps,
    }));
    showFeedback(`Started ${planMbps} Mbps mock stream: ${cfg.filename}`);
  };

  const startFreshDownloadFromZero = () => {
    const total = 3221225472; // 3.0 GB
    const speed = 12500000; // ~100 Mbps
    const activeMock: DownloadItem = {
      id: 'mock-active-' + Date.now(),
      url: 'https://cdn.example.org/fresh-download-sample.zip',
      filename: 'fresh-download-sample.zip',
      destination_path: 'C:\\Downloads\\Downex\\fresh-download-sample.zip',
      total_bytes: total,
      downloaded_bytes: 0,
      status: 'downloading',
      queue_id: 'default',
      speed_bytes_sec: speed,
      base_speed_bytes_sec: speed,
      eta_seconds: Math.round(total / speed),
      supports_ranges: true,
      created_at: Date.now(),
      updated_at: Date.now(),
      segments: [
        { index: 0, start: 0, end: 805306367, downloaded: 0, speed_bytes_sec: 3125000, is_active: true },
        { index: 1, start: 805306368, end: 1610612735, downloaded: 0, speed_bytes_sec: 3125000, is_active: true },
        { index: 2, start: 1610612736, end: 2415919103, downloaded: 0, speed_bytes_sec: 3125000, is_active: true },
        { index: 3, start: 2415919104, end: 3221225471, downloaded: 0, speed_bytes_sec: 3125000, is_active: true },
      ],
    };

    injectMockDownloadItem(activeMock);
    useDownloadStore.setState((prev) => ({
      items: [activeMock, ...prev.items.filter((i) => i.filename !== activeMock.filename)],
      selectedView: 'all',
      totalSpeed: prev.totalSpeed + speed,
    }));
    showFeedback('Started fresh download from 0% (3.0 GB)');
  };

  // --- Real Native Network Downloads (Native Rust Engine) ---
  const startRealCdnDownload = async (size: '10mb' | '100mb') => {
    const urls = {
      '10mb': 'https://speed.hetzner.de/10MB.bin',
      '100mb': 'https://speed.hetzner.de/100MB.bin',
    };
    const targetUrl = urls[size];
    showFeedback(`Initiating real ${size.toUpperCase()} CDN download...`);
    try {
      await useDownloadStore.getState().addNewDownload(targetUrl, undefined, 'default', undefined, true);
      showFeedback(`Real ${size.toUpperCase()} download added to queue!`);
    } catch (e: any) {
      showFeedback('Real download failed: ' + (e?.message || String(e)));
    }
  };

  // --- Table Status Mocks ---
  const addCompletedMock = () => {
    const completedMock: DownloadItem = {
      id: 'mock-completed-' + Date.now(),
      url: 'https://cdn.example.org/DownexSetup.exe',
      filename: 'DownexSetup.exe',
      destination_path: 'C:\\Downloads\\Downex\\DownexSetup.exe',
      total_bytes: 14745600,
      downloaded_bytes: 14745600,
      status: 'completed',
      queue_id: 'default',
      speed_bytes_sec: 0,
      eta_seconds: 0,
      supports_ranges: true,
      created_at: Date.now() - 3600000,
      updated_at: Date.now(),
      segments: [],
    };
    injectMockDownloadItem(completedMock);
    useDownloadStore.setState((prev) => ({
      items: [completedMock, ...prev.items.filter((i) => i.filename !== 'DownexSetup.exe')],
      selectedView: 'all',
    }));
    showFeedback('Added 100% Completed download card');
  };

  const addPausedMock = () => {
    const pausedMock: DownloadItem = {
      id: 'mock-paused-' + Date.now(),
      url: 'https://cdn.example.org/archlinux-x86_64.iso',
      filename: 'archlinux-x86_64.iso',
      destination_path: 'C:\\Downloads\\Downex\\archlinux-x86_64.iso',
      total_bytes: 1048576000,
      downloaded_bytes: 524288000, // 50%
      status: 'paused',
      queue_id: 'default',
      speed_bytes_sec: 0,
      base_speed_bytes_sec: 12500000,
      eta_seconds: null,
      supports_ranges: true,
      created_at: Date.now() - 120000,
      updated_at: Date.now(),
      segments: [],
    };
    injectMockDownloadItem(pausedMock);
    useDownloadStore.setState((prev) => ({
      items: [pausedMock, ...prev.items],
      selectedView: 'all',
    }));
    showFeedback('Added Paused download card');
  };

  const addQueuedMock = () => {
    const queuedMock: DownloadItem = {
      id: 'mock-queued-' + Date.now(),
      url: 'https://cdn.example.org/debian-12-netinst.iso',
      filename: 'debian-12-netinst.iso',
      destination_path: 'C:\\Downloads\\Downex\\debian-12-netinst.iso',
      total_bytes: 650117120,
      downloaded_bytes: 0,
      status: 'queued',
      queue_id: 'default',
      speed_bytes_sec: 0,
      base_speed_bytes_sec: 10000000,
      eta_seconds: null,
      supports_ranges: true,
      created_at: Date.now() - 30000,
      updated_at: Date.now(),
      segments: [],
    };
    injectMockDownloadItem(queuedMock);
    useDownloadStore.setState((prev) => ({
      items: [queuedMock, ...prev.items],
      selectedView: 'all',
    }));
    showFeedback('Added Queued download card');
  };

  const addErrorMock = () => {
    const errorMock: DownloadItem = {
      id: 'mock-error-' + Date.now(),
      url: 'https://unreliable-host.example.org/corrupt-stream.bin',
      filename: 'corrupt-stream.bin',
      destination_path: 'C:\\Downloads\\Downex\\corrupt-stream.bin',
      total_bytes: 500000000,
      downloaded_bytes: 125000000,
      status: 'error',
      queue_id: 'default',
      speed_bytes_sec: 0,
      base_speed_bytes_sec: 8000000,
      eta_seconds: null,
      supports_ranges: false,
      error_message: 'HTTP 503 Service Unavailable (Gateway Timeout)',
      created_at: Date.now() - 45000,
      updated_at: Date.now(),
      segments: [],
    };
    injectMockDownloadItem(errorMock);
    useDownloadStore.setState((prev) => ({
      items: [errorMock, ...prev.items],
      selectedView: 'all',
    }));
    showFeedback('Added Error / Failed download card');
  };

  const handleClearAll = async () => {
    clearMockDownloads();
    const allItems = useDownloadStore.getState().items;
    const realIds = allItems.filter((item) => !item.id.startsWith('mock-')).map((item) => item.id);
    if (realIds.length > 0) {
      await useDownloadStore.getState().removeAllDownloads(realIds, false);
    }
    useDownloadStore.setState({ items: [], totalSpeed: 0, speedHistory: Array(20).fill(0), activeQueueTaskId: null });
    showFeedback('Cleared all mock and database downloads');
  };

  // --- Handlers: Modals ---
  const openPrefilledUbuntuModal = () => {
    useDownloadStore.getState().openNewModalWithData({
      url: 'https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso',
      filename: 'ubuntu-24.04-desktop-amd64.iso',
      total_bytes: 6144000000,
      supports_ranges: true,
    });
    showFeedback('Opened Ubuntu ISO prefilled modal');
  };

  const openPrefilledSmallModal = () => {
    useDownloadStore.getState().openNewModalWithData({
      url: 'https://cdn.example.org/quick-patch-v1.zip',
      filename: 'quick-patch-v1.zip',
      total_bytes: 15728640,
      supports_ranges: true,
    });
    showFeedback('Opened 15MB small zip prefilled modal');
  };

  const openStandaloneModalTest = () => {
    useDownloadStore.getState().openNewModalWithData({
      url: 'https://cdn.example.org/extension-intercepted-file.pdf',
      filename: 'extension-intercepted-file.pdf',
      total_bytes: 8400000,
      supports_ranges: true,
      standalone_modal: true,
    });
    showFeedback('Opened Browser Extension standalone modal');
  };

  const openCompleteModalTest = async () => {
    const items = useDownloadStore.getState().items;
    const candidate =
      items.find((i) => i.status === 'completed' && i.url) ||
      items.find((i) => i.url) ||
      null;
    const payload: DownloadCompletePayload = candidate
      ? {
          id: candidate.id,
          url: candidate.url,
          filename: candidate.filename,
          destination_path: candidate.destination_path,
          total_bytes: candidate.total_bytes || candidate.downloaded_bytes || 14745600,
          downloaded_bytes: candidate.downloaded_bytes || candidate.total_bytes || 14745600,
        }
      : {
          id: 'mock-complete-modal',
          url: 'https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso',
          filename: 'ubuntu-24.04-desktop-amd64.iso',
          destination_path: 'C:\\Downloads\\Downex\\ubuntu-24.04-desktop-amd64.iso',
          total_bytes: 6144000000,
          downloaded_bytes: 6144000000,
        };
    try {
      await showDownloadCompleteDialog(payload);
      showFeedback(`Opened Complete Modal (Open Folder) for ${payload.filename}`);
    } catch (e: any) {
      showFeedback('Complete modal error: ' + (e?.message || String(e)));
    }
  };

  // --- Handlers: Base App Reset ---
  const handleResetToBaseApp = async () => {
    setIsResettingBase(true);
    showFeedback('Resetting to Base App v0.0.1...');
    try {
      await useAppVersionStore.getState().resetToBaseApp();
      showFeedback('Base App v0.0.1 restored! Database and staging purged.');
    } catch (err: any) {
      showFeedback('Reset error: ' + (err?.message || String(err)));
    } finally {
      setIsResettingBase(false);
    }
  };

  // --- Handlers: Theme Switcher ---
  const toggleTheme = () => {
    const nextDark = !document.documentElement.classList.contains('dark');
    const syncEvent = new CustomEvent('downex-set-theme', {
      detail: { dark: nextDark },
      cancelable: true,
    });
    window.dispatchEvent(syncEvent);

    if (!syncEvent.defaultPrevented) {
      if (nextDark) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('downex_theme', 'dark');
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('downex_theme', 'light');
      }
      localStorage.setItem('downex_theme_explicit', 'true');
    }

    setIsDark(nextDark);
    showFeedback(nextDark ? 'Switched to Dark Theme' : 'Switched to Light Theme');
  };

  // --- Handlers: OTA Flow Controls ---
  const triggerUpToDateBadgeTest = () => {
    localStorage.setItem('downex_recently_updated', 'true');
    useAppVersionStore.getState().checkForUpdates(false).catch(() => {});
    showFeedback('Triggered 3.5s "UP TO DATE" verification display');
  };

  const triggerLiveRestart = async () => {
    showFeedback('Triggering native detached Win32 updater handoff...');
    try {
      await useAppVersionStore.getState().installAndRestart();
    } catch (e: any) {
      showFeedback('Restart error: ' + (e?.message || String(e)));
    }
  };

  return (
    <div
      className="fixed bottom-2 right-2.5 z-50 select-none font-sans flex flex-col items-end"
      data-dev-qa-theme={isDark ? 'dark' : 'light'}
    >
      {!isOpen ? (
        isDotMode ? (
          <div className="relative group flex items-center">
            <div className="absolute right-7 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 text-[10px] font-mono-tabular px-2 py-0.5 rounded shadow-sm whitespace-nowrap">
              Dev QA (Click to open &bull; Right click for pill)
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(true)}
              onContextMenu={(e) => {
                e.preventDefault();
                setIsDotMode(false);
                try { localStorage.setItem('downex_dev_qa_dot_mode', 'false'); } catch {}
                showFeedback('Restored Dev QA Pill');
              }}
              className="w-5 h-5 rounded-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 shadow-md flex items-center justify-center cursor-pointer hover:scale-125 active:scale-95 transition-transform duration-150"
              title="Dev QA (Click to open, right-click to restore pill)"
              data-testid="dev-qa-dot"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.9)] animate-pulse" />
            </button>
          </div>
        ) : (
          <div className="flex items-center rounded-lg bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 text-xs font-semibold shadow-md border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors duration-150 overflow-hidden group">
            <button
              type="button"
              onClick={() => setIsOpen(true)}
              className="flex items-center gap-1.5 pl-3 pr-2 py-1.5 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer"
              title="Open Dev QA & Download Tester (Ctrl+Shift+D)"
              data-testid="dev-qa-pill-trigger"
            >
              <FlaskConical className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 animate-pulse" />
              <span>Dev QA</span>
              <ChevronUp className="w-3 h-3 opacity-70" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsDotMode(true);
                try { localStorage.setItem('downex_dev_qa_dot_mode', 'true'); } catch {}
                showFeedback('Dev QA hidden as dot (Click dot to open)');
              }}
              className="p-1.5 pr-2.5 pl-1.5 text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer border-l border-zinc-200 dark:border-zinc-700"
              title="Hide Dev QA as a tiny dot"
              data-testid="dev-qa-hide-as-dot"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500/80 hover:bg-emerald-500 block shadow-xs" />
            </button>
          </div>
        )
      ) : (
        <div className="w-[450px] max-w-[95vw] rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3 shadow-2xl flex flex-col gap-2 text-zinc-900 dark:text-zinc-100 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center gap-1.5">
              <FlaskConical className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-xs font-bold tracking-tight">Dev QA & Control Center</span>
              <span className="px-1.5 py-0.5 rounded text-[9.5px] font-mono font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                v{currentVersion}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  const next = !isDotMode;
                  setIsDotMode(next);
                  try { localStorage.setItem('downex_dev_qa_dot_mode', String(next)); } catch {}
                  showFeedback(next ? 'Launcher mode: Minimal Dot' : 'Launcher mode: Normal Pill');
                }}
                className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-semibold border transition-colors cursor-pointer flex items-center gap-1 ${
                  isDotMode
                    ? 'border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                    : 'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                }`}
                title="Toggle collapsed launcher appearance between Minimal Dot and Pill"
                data-testid="dev-qa-toggle-dot-mode"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isDotMode ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400'}`} />
                <span>{isDotMode ? 'DOT' : 'PILL'}</span>
              </button>
              <button
                type="button"
                onClick={toggleTheme}
                className="p-1 rounded-md text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                title="Toggle Light / Dark mode"
              >
                <Sun className="w-3.5 h-3.5 block dark:hidden text-amber-500" />
                <Moon className="w-3.5 h-3.5 hidden dark:block text-indigo-400" />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                title="Close panel (Ctrl+Shift+D)"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Tab Selector */}
          <div className="grid grid-cols-4 gap-1 p-0.5 bg-zinc-100 dark:bg-zinc-800/70 rounded-lg text-[10px] font-semibold">
            <button
              onClick={() => setActiveTab('downloads')}
              className={`py-1 rounded-md transition-colors duration-100 cursor-pointer ${
                activeTab === 'downloads'
                  ? 'bg-white dark:bg-zinc-900 text-emerald-600 dark:text-emerald-400 shadow-2xs'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              Downloads
            </button>
            <button
              onClick={() => setActiveTab('modals')}
              className={`py-1 rounded-md transition-colors duration-100 cursor-pointer ${
                activeTab === 'modals'
                  ? 'bg-white dark:bg-zinc-900 text-emerald-600 dark:text-emerald-400 shadow-2xs'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              Modals
            </button>
            <button
              onClick={() => setActiveTab('ota')}
              className={`py-1 rounded-md transition-colors duration-100 cursor-pointer ${
                activeTab === 'ota'
                  ? 'bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-400 shadow-2xs'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              OTA Updates
            </button>
            <button
              onClick={() => setActiveTab('system')}
              className={`py-1 rounded-md transition-colors duration-100 cursor-pointer ${
                activeTab === 'system'
                  ? 'bg-white dark:bg-zinc-900 text-rose-600 dark:text-rose-400 shadow-2xs'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              Base & Tools
            </button>
          </div>

          {/* Feedback Bar */}
          {actionFeedback && (
            <div className="px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-500/30 text-[10.5px] text-emerald-800 dark:text-emerald-300 font-medium flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="truncate">{actionFeedback}</span>
            </div>
          )}

          {/* TAB 1: DOWNLOADS */}
          {activeTab === 'downloads' && (
            <div className="flex flex-col gap-2">
              {/* Section 1A: Live Mock Active Downloads */}
              <div className="flex flex-col gap-1.5 p-2 rounded-xl bg-emerald-500/[0.06] dark:bg-emerald-950/20 border border-emerald-500/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider font-mono-tabular">
                    <Play className="w-2.5 h-2.5 fill-current" />
                    <span>Live Mock Streams:</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsLiveTickerActive(!isLiveTickerActive)}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono-tabular font-semibold transition-colors cursor-pointer ${
                      isLiveTickerActive
                        ? 'bg-emerald-600 text-white'
                        : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
                    }`}
                    title="Toggle live streaming byte progression"
                  >
                    {isLiveTickerActive ? (
                      <>
                        <Activity className="w-2.5 h-2.5 animate-pulse" />
                        <span>TICKER: ON</span>
                      </>
                    ) : (
                      <>
                        <Pause className="w-2.5 h-2.5" />
                        <span>PAUSED</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-1">
                  <button
                    onClick={() => startSpeedTestDownload(100)}
                    className="h-7 flex items-center justify-center gap-1 px-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-mono-tabular font-semibold shadow-xs transition-colors cursor-pointer"
                    title="Active download running at ~100 Mbps (snaps to 100 Mbps tier for inline limiter test)"
                  >
                    <Zap className="w-2.5 h-2.5 shrink-0" />
                    <span className="truncate">▶ 100 Mbps (ISO)</span>
                  </button>

                  <button
                    onClick={startFreshDownloadFromZero}
                    className="h-7 flex items-center justify-center gap-1 px-1.5 rounded-md bg-teal-600 hover:bg-teal-500 text-white text-[10px] font-mono-tabular font-semibold shadow-xs transition-colors cursor-pointer"
                    title="Fresh live download starting at 0% (3.0 GB)"
                  >
                    <Sparkles className="w-2.5 h-2.5 shrink-0" />
                    <span className="truncate">▶ Fresh 0% (3GB)</span>
                  </button>

                  <button
                    onClick={() => startSpeedTestDownload(200)}
                    className="h-7 flex items-center justify-center gap-1 px-1.5 rounded-md bg-white hover:bg-zinc-100 dark:bg-zinc-800/80 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 text-[10px] font-mono-tabular font-medium transition-colors cursor-pointer"
                    title="Active download running at 200 Mbps (10.5 GB)"
                  >
                    <Zap className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="truncate">200 Mbps Plan</span>
                  </button>
                </div>

                <div className="grid grid-cols-5 gap-1">
                  <button
                    onClick={() => startSpeedTestDownload(500)}
                    className="col-span-2 h-7 flex items-center justify-center gap-1 px-1.5 rounded-md bg-white hover:bg-zinc-100 dark:bg-zinc-800/80 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 text-[10px] font-mono-tabular font-medium transition-colors cursor-pointer"
                    title="Active download running at 500 Mbps (25 GB)"
                  >
                    <Zap className="w-2.5 h-2.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <span className="truncate">500 Mbps Fiber</span>
                  </button>

                  <button
                    onClick={() => startSpeedTestDownload(1000)}
                    className="col-span-3 h-7 flex items-center justify-center gap-1 px-1.5 rounded-md bg-white hover:bg-zinc-100 dark:bg-zinc-800/80 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 text-[10px] font-mono-tabular font-medium transition-colors cursor-pointer"
                    title="Active Gigabit download running at 1000 Mbps (50 GB)"
                  >
                    <Zap className="w-2.5 h-2.5 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span className="truncate">▶ 1 Gbps Ultra Streaming (50 GB)</span>
                  </button>
                </div>

                <p className="text-[9.5px] text-zinc-500 dark:text-zinc-400 px-0.5 leading-tight font-mono-tabular">
                  💡 <strong>Tip:</strong> Inline Speed Limiter supports 50Mb–200Mb (incl. 190Mb), Custom &amp; Tab restore.
                </p>
              </div>

              {/* Section 1B: Real Native HTTP Downloads */}
              <div className="flex flex-col gap-1 p-2 rounded-xl bg-sky-500/[0.06] dark:bg-sky-950/20 border border-sky-500/20">
                <div className="flex items-center gap-1 text-[9.5px] font-bold text-sky-700 dark:text-sky-400 uppercase tracking-wider font-mono-tabular px-0.5">
                  <Globe className="w-2.5 h-2.5" />
                  <span>Real Native Downloads (Rust Engine):</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => startRealCdnDownload('10mb')}
                    className="h-7 flex items-center justify-center gap-1 px-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[10.5px] font-mono-tabular font-medium transition-colors cursor-pointer"
                    title="Start genuine 10MB test download from Hetzner CDN"
                  >
                    <Globe className="w-2.5 h-2.5" />
                    <span>Real 10MB (CDN)</span>
                  </button>
                  <button
                    onClick={() => startRealCdnDownload('100mb')}
                    className="h-7 flex items-center justify-center gap-1 px-2 rounded-lg bg-sky-700 hover:bg-sky-600 text-white text-[10.5px] font-mono-tabular font-medium transition-colors cursor-pointer"
                    title="Start genuine 100MB test download from Hetzner CDN"
                  >
                    <Globe className="w-2.5 h-2.5" />
                    <span>Real 100MB (CDN)</span>
                  </button>
                </div>
              </div>

              {/* Section 1C: Table Row States & Management */}
              <div className="flex flex-col gap-1">
                <div className="text-[9.5px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider font-mono-tabular px-1">
                  Table State Cards:
                </div>
                <div className="grid grid-cols-4 gap-1">
                  <button
                    onClick={addCompletedMock}
                    className="h-7 flex items-center justify-center gap-1 px-1 rounded-md bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-800/60 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200/80 dark:border-zinc-700/80 text-[10px] font-mono-tabular font-medium transition-colors cursor-pointer"
                    title="Add a 100% completed item"
                  >
                    <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>Completed (100%)</span>
                  </button>

                  <button
                    onClick={addPausedMock}
                    className="h-7 flex items-center justify-center gap-1 px-1 rounded-md bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-800/60 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200/80 dark:border-zinc-700/80 text-[10px] font-mono-tabular font-medium transition-colors cursor-pointer"
                    title="Add a paused item"
                  >
                    <Pause className="w-2.5 h-2.5 text-amber-500 shrink-0" />
                    <span>Paused (50%)</span>
                  </button>

                  <button
                    onClick={addQueuedMock}
                    className="h-7 flex items-center justify-center gap-1 px-1 rounded-md bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-800/60 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200/80 dark:border-zinc-700/80 text-[10px] font-mono-tabular font-medium transition-colors cursor-pointer"
                    title="Add a queued item"
                  >
                    <Clock className="w-2.5 h-2.5 text-sky-500 shrink-0" />
                    <span>Queued</span>
                  </button>

                  <button
                    onClick={addErrorMock}
                    className="h-7 flex items-center justify-center gap-1 px-1 rounded-md bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-800/60 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200/80 dark:border-zinc-700/80 text-[10px] font-mono-tabular font-medium transition-colors cursor-pointer"
                    title="Add a failed error item to test retry button"
                  >
                    <AlertTriangle className="w-2.5 h-2.5 text-rose-500 shrink-0" />
                    <span>Error / Failed</span>
                  </button>
                </div>

                <button
                  onClick={handleClearAll}
                  className="w-full h-7 mt-0.5 flex items-center justify-center gap-1.5 px-2.5 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 text-rose-700 dark:text-rose-300 border border-rose-200/80 dark:border-rose-800/80 text-[10.5px] font-mono-tabular font-medium transition-colors cursor-pointer"
                  title="Clear all downloads (both mock items and database entries)"
                >
                  <Trash2 className="w-3 h-3 shrink-0" />
                  <span>Clear All Downloads</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: MODALS */}
          {activeTab === 'modals' && (
            <div className="flex flex-col gap-2.5">
              <div className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider px-1">
                New Download Dialogs:
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={openPrefilledUbuntuModal}
                  className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-[11px] font-medium transition-colors cursor-pointer"
                  title="Open modal prefilled with Ubuntu 24.04 ISO"
                >
                  <FileDown className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Ubuntu ISO (6GB)</span>
                </button>

                <button
                  onClick={openPrefilledSmallModal}
                  className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-[11px] font-medium transition-colors cursor-pointer"
                  title="Open modal prefilled with small 15MB file"
                >
                  <FileDown className="w-3.5 h-3.5 text-teal-500" />
                  <span>Small Patch (15MB)</span>
                </button>
              </div>

              <button
                onClick={() => {
                  useDownloadStore.setState({ initialModalData: undefined });
                  useDownloadStore.getState().setNewModalOpen(true);
                }}
                className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-[11px] font-medium transition-colors cursor-pointer"
                title="Open empty New Download modal to paste a custom URL"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Blank URL Modal (Custom Input)</span>
              </button>

              <div className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider px-1 pt-1.5 border-t border-zinc-100 dark:border-zinc-800">
                Specialized In-App Modals:
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => useDownloadStore.getState().setQueueGuideOpen(true)}
                  className="flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-[11px] font-medium transition-colors cursor-pointer"
                  title="Open Queue Guide in-app modal"
                >
                  <Layers className="w-3.5 h-3.5 text-amber-500" />
                  <span>Queue Guide</span>
                </button>

                <button
                  onClick={openStandaloneModalTest}
                  className="flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-[11px] font-medium transition-colors cursor-pointer"
                  title="Preview Browser Extension Standalone Modal Window"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Extension Dialog</span>
                </button>

                <button
                  onClick={openCompleteModalTest}
                  className="col-span-2 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50 border border-emerald-200/80 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-200 text-[11px] font-medium transition-colors cursor-pointer"
                  title="Open isolated Download Complete ('Open Folder' / 'Open With...') modal"
                  data-testid="dev-qa-open-complete-modal"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Complete Modal (Open Folder)</span>
                </button>

                <button
                  onClick={async () => {
                    try {
                      const theme = isDark ? 'dark' : 'light';
                      const { previewExternalUpdater } = await import('../services/tauriService');
                      await previewExternalUpdater(theme);
                      showFeedback('Spawning native Win32 floating updater preview on desktop...');
                    } catch (e: any) {
                      showFeedback('Preview error: ' + (e?.message || String(e)));
                    }
                  }}
                  className="flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-[11px] font-medium transition-colors cursor-pointer"
                  title="Preview the 440x220 Win32 floating updater card ('Updating Apps & Services')"
                  data-testid="dev-qa-preview-middle-card-modals"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                  <span className="truncate">Win32 Updater Card</span>
                </button>

                <button
                  onClick={() => {
                    const hasMockNotice = notices.some((n) => n.id.startsWith('dev-qa-notice'));
                    if (hasMockNotice) {
                      useMarqueeNoticeStore.getState().setNotices([], false);
                      showFeedback('Cleared marquee notice banner');
                    } else {
                      useMarqueeNoticeStore.getState().setNotices(
                        [
                          {
                            id: 'dev-qa-notice-1',
                            text: 'Downex Dev QA Notice — Speed Limiter (50Mb–200Mb + Tab restore) & In-App Complete Modal active.',
                            tone: 'update',
                            modeLabel: 'DEV QA',
                            modeColor: 'emerald',
                            direction: 'rtl',
                            speed: 1,
                            active: true,
                            createdAt: Date.now(),
                            expiresAt: null,
                          },
                        ],
                        true
                      );
                      showFeedback('Triggered top header marquee notice banner');
                    }
                  }}
                  className="flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-[11px] font-medium transition-colors cursor-pointer"
                  title="Toggle live scrolling header marquee notice banner"
                  data-testid="dev-qa-toggle-marquee-notice"
                >
                  <Bell className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span className="truncate">
                    {notices.some((n) => n.id.startsWith('dev-qa-notice')) ? 'Clear Notice' : 'Marquee Notice'}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: OTA UPDATES */}
          {activeTab === 'ota' && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                  OTA Pipeline Stage:
                </span>
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  {otaStatus.state}
                </span>
              </div>

              {/* Full Auto Flow */}
              <button
                onClick={() => {
                  updateService.simulateUpdate('auto');
                  showFeedback('Running full real-as-mock OTA flow (Download 1-100% → Two Stops → Middle Card → v0.0.2)...');
                }}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/50 text-indigo-800 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800/70 text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                title="Simulate complete end-to-end OTA flow: Download (1-100%), Verifying, Stop #1, Middle Floating Card ('Updating Apps & Services'), Stop #2, New UI (v0.0.2)"
                data-testid="dev-qa-run-full-ota"
              >
                <div className="flex items-center gap-1.5">
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>▶ Run Full Real-As-Mock OTA</span>
                </div>
                <span className="text-[10px] opacity-80 font-mono">Two Stops (~6s)</span>
              </button>

              {/* Step-by-Step Stage Controls */}
              <div className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider px-1 pt-1 border-t border-zinc-100 dark:border-zinc-800">
                Step-by-Step Stages:
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                <button
                  onClick={() => {
                    updateService.simulateUpdate('available');
                    showFeedback('Simulated: Update Available (v0.0.2)');
                  }}
                  className="px-1.5 py-1 rounded bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-[10.5px] font-medium text-zinc-800 dark:text-zinc-200 transition-colors cursor-pointer"
                >
                  1. Available
                </button>
                <button
                  onClick={() => {
                    updateService.simulateUpdate('downloading');
                    showFeedback('Simulating live download: 1% → 100%...');
                  }}
                  className="px-1.5 py-1 rounded bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-[10.5px] font-medium text-emerald-700 dark:text-emerald-400 transition-colors cursor-pointer"
                  title="Simulate live fluid 1% to 100% streaming download"
                >
                  2. Download
                </button>
                <button
                  onClick={() => {
                    updateService.simulateUpdate('verifying');
                    showFeedback('Simulated: Verifying (PE MZ & Signatures)');
                  }}
                  className="px-1.5 py-1 rounded bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-[10.5px] font-medium text-indigo-700 dark:text-indigo-400 transition-colors cursor-pointer"
                >
                  3. Verifying
                </button>
                <button
                  onClick={() => {
                    updateService.simulateUpdate('queued');
                    showFeedback('Simulated: Queued (Waiting for idle)');
                  }}
                  className="px-1.5 py-1 rounded bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-[10.5px] font-medium text-amber-700 dark:text-amber-400 transition-colors cursor-pointer"
                >
                  4. Queued
                </button>
                <button
                  onClick={() => {
                    updateService.simulateUpdate('patching');
                    showFeedback('Simulated: Patching (Violet Hold)');
                  }}
                  className="px-1.5 py-1 rounded bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-[10.5px] font-medium text-violet-700 dark:text-violet-400 transition-colors cursor-pointer"
                >
                  5. Patching
                </button>
                <button
                  onClick={() => {
                    updateService.simulateUpdate('ready');
                    showFeedback('Simulated: Ready to Restart');
                  }}
                  className="px-1.5 py-1 rounded bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-[10.5px] font-medium text-sky-700 dark:text-sky-400 transition-colors cursor-pointer"
                >
                  6. Ready
                </button>
              </div>

              {/* Live Restart & Verifications */}
              <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-zinc-100 dark:border-zinc-800">
                <button
                  onClick={triggerLiveRestart}
                  className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-semibold transition-colors cursor-pointer shadow-2xs"
                  title="Test detached Win32 updater modal execution with two 0.75-second stops!"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Win32 Updater</span>
                </button>

                <button
                  onClick={async () => {
                    try {
                      const theme = isDark ? 'dark' : 'light';
                      const { previewExternalUpdater } = await import('../services/tauriService');
                      await previewExternalUpdater(theme);
                      showFeedback('Spawning native Win32 floating updater preview on desktop...');
                    } catch (e: any) {
                      showFeedback('Preview error: ' + (e?.message || String(e)));
                    }
                  }}
                  className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/80 text-[11px] font-medium transition-colors cursor-pointer"
                  title="Preview the 440x220 Win32 floating card ('Updating Apps & Services') that appears between the two 0.75s stops"
                  data-testid="dev-qa-preview-middle-card"
                >
                  <Layers className="w-3 h-3 text-indigo-500" />
                  <span>Middle Card</span>
                </button>

                <button
                  onClick={triggerUpToDateBadgeTest}
                  className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/80 text-[11px] font-medium transition-colors cursor-pointer"
                  title="Test one-time post-update 'UP TO DATE' 3.5s display"
                >
                  <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                  <span>Up to Date (3.5s)</span>
                </button>

                <button
                  onClick={() => {
                    updateService.simulateUpdate('error');
                    showFeedback('Simulated: Update error state');
                  }}
                  className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-800/60 dark:hover:bg-zinc-800 text-rose-600 dark:text-rose-400 border border-zinc-200/80 dark:border-zinc-700/80 text-[11px] font-medium transition-colors cursor-pointer"
                  title="Simulate update error state"
                >
                  <AlertTriangle className="w-3 h-3" />
                  <span>Error State</span>
                </button>
              </div>

              <button
                onClick={() => {
                  updateService.simulateUpdate('idle');
                  showFeedback('Reset OTA state to idle');
                }}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-[11px] font-medium transition-colors cursor-pointer"
                title="Reset OTA state to clean idle"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Reset to Idle</span>
              </button>
            </div>
          )}

          {/* TAB 4: SYSTEM & BASE APP */}
          {activeTab === 'system' && (
            <div className="flex flex-col gap-2.5">
              <div className="flex flex-col gap-1.5 p-2 rounded-xl bg-rose-500/[0.06] dark:bg-rose-950/20 border border-rose-500/20">
                <div className="text-[10px] font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider px-0.5 flex items-center justify-between">
                  <span>Base App Foundation:</span>
                  <span className="font-mono text-[10px] font-bold">v{currentVersion}</span>
                </div>

                <button
                  onClick={handleResetToBaseApp}
                  disabled={isResettingBase}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                  title="Purge staged files, reset database and registry to Base App v0.0.1"
                >
                  <div className="flex items-center gap-1.5">
                    <RotateCcw className={`w-3.5 h-3.5 shrink-0 ${isResettingBase ? 'animate-spin' : ''}`} />
                    <span>{isResettingBase ? 'Resetting to Base...' : 'Reset to Base App'}</span>
                  </div>
                  <span className="text-[10px] opacity-90 font-mono">v0.0.1</span>
                </button>

                <p className="text-[9.5px] text-zinc-500 dark:text-zinc-400 px-0.5 leading-tight">
                  Purges <code>%TEMP%\com.downex.manager</code>, wipes update staging files, and synchronizes Windows registry to 0.0.1.
                </p>
              </div>

              <div className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider px-1">
                Diagnostics & Actions:
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => {
                    useAppVersionStore.getState().checkForUpdates(false);
                    showFeedback('Triggered live GPHost update check');
                  }}
                  className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-[11px] font-medium transition-colors cursor-pointer"
                  title="Check live remote GPHost release manifest"
                >
                  <RefreshCw className="w-3 h-3 text-emerald-500" />
                  <span>Check Live OTA</span>
                </button>

                <button
                  onClick={() => {
                    useDownloadStore.getState().setSelectedView('telemetry');
                    showFeedback('Switched to Telemetry speed view');
                  }}
                  className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-[11px] font-medium transition-colors cursor-pointer"
                  title="Switch main view to Telemetry / Live Speed Graph"
                >
                  <Gauge className="w-3 h-3 text-sky-500" />
                  <span>Telemetry View</span>
                </button>

                <button
                  onClick={() => {
                    notifyDownloadsCompletedNative().catch(() => {});
                    showFeedback('Dispatched Windows native completion toast');
                  }}
                  className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-[11px] font-medium transition-colors cursor-pointer"
                  title="Dispatch Windows native toast notification"
                >
                  <Bell className="w-3 h-3 text-amber-500" />
                  <span>Test OS Toast</span>
                </button>

                <button
                  onClick={() => {
                    useDownloadStore.getState().loadItems();
                    showFeedback('Reloaded items from SQLite database');
                  }}
                  className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-[11px] font-medium transition-colors cursor-pointer"
                  title="Force re-fetch all items from SQLite"
                >
                  <RefreshCw className="w-3 h-3 text-indigo-500" />
                  <span>Sync SQLite</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
