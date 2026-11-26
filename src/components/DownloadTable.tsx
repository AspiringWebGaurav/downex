import React, { useState, useRef, useEffect } from 'react';
import { Button } from './ui/Button';
import { 
  Play, 
  Pause, 
  Trash2, 
  File, 
  AlertCircle, 
  FolderEdit, 
  ListOrdered, 
  ChevronDown, 
  ChevronUp, 
  ShieldCheck, 
  FolderOpen, 
  ExternalLink, 
  Plus, 
  Search,
  SearchX,
  RotateCcw,
  RefreshCw,
  X,
  Copy,
  Check,
  Power,
  ArrowRight,
  Undo2,
  Pin,
  PinOff
} from 'lucide-react';
import { useDownloadStore } from '../stores/downloadStore';
import { openFileWith, openFileFolder, showDownloadCompleteDialog, isTauri, injectMockDownloadItem, toggleTaskShutdown, openExternalUrl } from '../services/tauriService';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { BatchDeleteConfirmModal } from './BatchDeleteConfirmModal';
import { BatchPauseConfirmModal } from './BatchPauseConfirmModal';
import { InlineSpeedLimiter } from './InlineSpeedLimiter';
import { FolderChangeModal } from './FolderChangeModal';
import { AutoShutdownConfirmModal } from './AutoShutdownConfirmModal';
import { DownloadItem } from '../types/download';
import { getResumeCapability, formatTimeTaken, getActiveDownloadDiskPath } from '../utils/format';

export const DownloadTable: React.FC = () => {
  const items = useDownloadStore((state) => state.items);
  const selectedView = useDownloadStore((state) => state.selectedView);
  const setSelectedView = useDownloadStore((state) => state.setSelectedView);
  const searchQuery = useDownloadStore((state) => state.searchQuery);
  const setSearchQuery = useDownloadStore((state) => state.setSearchQuery);
  const togglePause = useDownloadStore((state) => state.togglePause);
  const removeDownload = useDownloadStore((state) => state.removeDownload);
  const changeFolderAndRetry = useDownloadStore((state) => state.changeFolderAndRetry);
  const isQueueRunning = useDownloadStore((state) => state.isQueueRunning);
  const activeQueueTaskId = useDownloadStore((state) => state.activeQueueTaskId);
  const startQueue = useDownloadStore((state) => state.startQueue);
  const pauseQueue = useDownloadStore((state) => state.pauseQueue);
  const queueDownload = useDownloadStore((state) => state.queueDownload);
  const unqueueDownload = useDownloadStore((state) => state.unqueueDownload);
  const pauseAllDownloads = useDownloadStore((state) => state.pauseAllDownloads);
  const resumeAllDownloads = useDownloadStore((state) => state.resumeAllDownloads);
  const queueAllDownloads = useDownloadStore((state) => state.queueAllDownloads);
  const unqueueAllDownloads = useDownloadStore((state) => state.unqueueAllDownloads);
  const removeAllDownloads = useDownloadStore((state) => state.removeAllDownloads);
  const setNewModalOpen = useDownloadStore((state) => state.setNewModalOpen);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const jumpStripRef = useRef<HTMLDivElement | null>(null);
  const activeJumpBtnRef = useRef<HTMLButtonElement | null>(null);

  const [currentVisibleIndex, setCurrentVisibleIndex] = useState(0);
  const [isNavVisible, setIsNavVisible] = useState(false);
  const [alwaysShowNav, setAlwaysShowNav] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        return localStorage.getItem('downex_nav_always_visible') === 'true';
      } catch {
        return false;
      }
    }
    return false;
  });

  const [expandedItemIds, setExpandedItemIds] = useState<Record<string, boolean>>({});
  const [showAllSegmentsMap, setShowAllSegmentsMap] = useState<Record<string, boolean>>({});
  const [deletingItem, setDeletingItem] = useState<DownloadItem | null>(null);
  const [isBatchDeleteOpen, setIsBatchDeleteOpen] = useState(false);
  const [batchPauseAction, setBatchPauseAction] = useState<'pause' | 'resume' | 'queue' | 'start_queue' | null>(null);
  const [batchPauseCustomItems, setBatchPauseCustomItems] = useState<DownloadItem[] | null>(null);
  const [retryingFolderItem, setRetryingFolderItem] = useState<DownloadItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pauseHintTaskId, setPauseHintTaskId] = useState<string | null>(null);
  const pauseHintTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pauseHintTimerRef.current !== null) {
        window.clearTimeout(pauseHintTimerRef.current);
      }
    };
  }, []);

  const handleAttemptDeleteWhileDownloading = (taskId: string) => {
    setPauseHintTaskId(taskId);
    if (pauseHintTimerRef.current !== null) {
      window.clearTimeout(pauseHintTimerRef.current);
    }
    pauseHintTimerRef.current = window.setTimeout(() => {
      setPauseHintTaskId((current) => (current === taskId ? null : current));
      pauseHintTimerRef.current = null;
    }, 2800);
  };

  const handleTogglePause = (id: string) => {
    setPauseHintTaskId(null);
    togglePause(id);
  };

  const [shutdownArmedMap, setShutdownArmedMap] = useState<Record<string, boolean>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = sessionStorage.getItem('downex_mock_shutdown_tasks');
        return raw ? JSON.parse(raw) : {};
      } catch {
        return {};
      }
    }
    return {};
  });

  const [shutdownConfirmItem, setShutdownConfirmItem] = useState<DownloadItem | null>(null);

  const handleToggleShutdown = async (taskId: string) => {
    const nextState = await toggleTaskShutdown(taskId);
    setShutdownArmedMap((prev) => ({ ...prev, [taskId]: nextState }));
  };

  const handleToggleShutdownClick = (targetItem: DownloadItem) => {
    if (isShutdownArmed(targetItem.id)) {
      // Disarming is safe, toggle off directly
      handleToggleShutdown(targetItem.id);
    } else {
      // Arming shuts down the computer, prompt confirmation modal
      setShutdownConfirmItem(targetItem);
    }
  };

  const isShutdownArmed = (taskId: string) => Boolean(shutdownArmedMap[taskId]);

  const persistentSpeedRef = useRef<Record<string, number>>({});
  const smoothedSpeedRef = useRef<Record<string, number>>({});
  const persistentEtaRef = useRef<Record<string, number>>({});
  const smoothedEtaRef = useRef<Record<string, { eta: number; lastUpdated: number }>>({});
  const activeStartRef = useRef<Record<string, number>>({});
  const activeDurationRef = useRef<Record<string, number>>({});
  const persistentBytesRef = useRef<Record<string, number>>({});
  const persistentPercentRef = useRef<Record<string, number>>({});
  const persistentBarWidthRef = useRef<Record<string, number>>({});

  const itemIdsKey = items.map((i) => i.id).join(',');

  // Prune per-item visual smoothing caches when download ID set changes so refs stay bounded
  useEffect(() => {
    const activeIds = new Set(itemIdsKey ? itemIdsKey.split(',') : []);
    for (const cache of [
      persistentSpeedRef.current,
      smoothedSpeedRef.current,
      persistentEtaRef.current,
      smoothedEtaRef.current,
      activeStartRef.current,
      activeDurationRef.current,
      persistentBytesRef.current,
      persistentPercentRef.current,
      persistentBarWidthRef.current,
    ]) {
      for (const k of Object.keys(cache)) {
        if (!activeIds.has(k)) delete cache[k];
      }
    }
  }, [itemIdsKey]);

  const toggleDetails = (id: string) => {
    setExpandedItemIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleShowAllSegments = (id: string) => {
    setShowAllSegmentsMap((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const isQueuesView = selectedView === 'queues';

  const queuedItems = items
    .filter((item) => item.status === 'queued')
    .sort((a, b) => a.created_at - b.created_at);

  const activeItems = items.filter(
    (item) => item.status === 'downloading' || item.status === 'probing'
  );

  const isSearchActive = Boolean(searchQuery.trim());
  const cleanSearchQuery = searchQuery.trim().toLowerCase();

  const matchesDownloadItem = (item: DownloadItem, query: string) => {
    if (!query) return true;
    if (item.filename?.toLowerCase().includes(query)) return true;
    if (item.url?.toLowerCase().includes(query)) return true;
    if (item.destination_path?.toLowerCase().includes(query)) return true;
    const ext = item.filename?.split('.').pop()?.toLowerCase();
    if (ext && (ext.includes(query) || `.${ext}`.includes(query))) return true;
    if (item.status?.toLowerCase().includes(query)) return true;
    return false;
  };

  let displayItems = items.filter((item) => {
    if (isSearchActive && !matchesDownloadItem(item, cleanSearchQuery)) {
      return false;
    }
    // When searching in app, display all matching downloads across the library
    // so the user never gets an empty result just because they were on another tab!
    if (isSearchActive) {
      return true;
    }

    if (selectedView === 'active') {
      return (item.status === 'downloading' || item.status === 'probing') && item.id !== activeQueueTaskId;
    }
    if (selectedView === 'completed') {
      return item.status === 'completed';
    }
    if (selectedView === 'queues') {
      // In Queues view: strictly items in the queue, or the single task actively downloading from the queue!
      return (
        item.status === 'queued' ||
        Boolean(isQueueRunning && item.id === activeQueueTaskId && (item.status === 'downloading' || item.status === 'probing'))
      );
    }
    if (selectedView === 'trash') {
      return item.status === 'failed' || item.status === 'cancelled' || item.status === 'error';
    }
    if (selectedView === 'all') {
      // In All Downloads: display regular downloads and completed downloads,
      // but do NOT show pending queued items (they live in the Queues workspace).
      // When a queued item finishes downloading, its status becomes 'completed',
      // so it seamlessly reflects in All Downloads!
      return item.status !== 'queued' && !(isQueueRunning && item.id === activeQueueTaskId);
    }
    return true;
  });

  if (isQueuesView) {
    const active = displayItems.filter((i) => i.status === 'downloading' || i.status === 'probing');
    const queued = displayItems
      .filter((i) => i.status === 'queued')
      .sort((a, b) => a.created_at - b.created_at);
    const otherInQueue = displayItems
      .filter((i) => i.status !== 'downloading' && i.status !== 'probing' && i.status !== 'queued');
    displayItems = [...active, ...queued, ...otherInQueue];
  }

  const downloadingCount = displayItems.filter((i) => i.status === 'downloading').length;
  const pausedCount = displayItems.filter((i) => i.status === 'paused').length;
  const queuedCount = displayItems.filter((i) => i.status === 'queued').length;
  const errorCount = displayItems.filter((i) => i.status === 'failed' || i.status === 'error').length;
  const canQueueAny = displayItems.some((i) => i.status !== 'completed' && i.status !== 'queued');
  const canUnqueueAny = isQueuesView ? displayItems.length > 0 : queuedCount > 0;

  const scrollToCard = (index: number) => {
    const clamped = Math.max(0, Math.min(displayItems.length - 1, index));
    const target = cardRefs.current[clamped];
    const container = scrollContainerRef.current;
    if (container) {
      if (clamped === 0) {
        container.scrollTo({ top: 0, behavior: 'smooth' });
        setCurrentVisibleIndex(0);
        return;
      }
      if (target) {
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const targetScrollTop = targetRect.top - containerRect.top + container.scrollTop - 8;

        container.scrollTo({
          top: Math.max(0, targetScrollTop),
          behavior: 'smooth',
        });
        setCurrentVisibleIndex(clamped);
      }
    }
  };

  // Synchronize active number button centering in horizontal strip
  useEffect(() => {
    if (activeJumpBtnRef.current && jumpStripRef.current) {
      const btn = activeJumpBtnRef.current;
      const strip = jumpStripRef.current;
      const btnLeft = btn.offsetLeft;
      const btnWidth = btn.offsetWidth;
      const stripWidth = strip.offsetWidth;
      strip.scrollTo({
        left: btnLeft - stripWidth / 2 + btnWidth / 2,
        behavior: 'smooth',
      });
    }
  }, [currentVisibleIndex]);

  // Universal dominant-card scroll-spy & at-top auto-hide (inspired by portfolio FloatingNav.tsx)
  useEffect(() => {
    if (typeof window === 'undefined' || !scrollContainerRef.current) return;
    const container = scrollContainerRef.current;
    let ticking = false;

    const updateDominantCardAndVisibility = () => {
      const scrollTop = container.scrollTop;
      const containerRect = container.getBoundingClientRect();

      // 1. At-top detection: hide navigator at top unless pinned
      const atTop = scrollTop <= 45;
      setIsNavVisible(alwaysShowNav || !atTop);

      // 2. Absolute bottom detection: last card view
      const isAtBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight <= 25;

      if (isAtBottom && displayItems.length > 0) {
        setCurrentVisibleIndex(displayItems.length - 1);
        return;
      }

      if (atTop) {
        setCurrentVisibleIndex(0);
        return;
      }

      // 3. Dominant Section Calculation (Mathematical intersection height in viewport)
      let maxVisibleHeight = 0;
      let dominantIndex = 0;

      for (let i = 0; i < displayItems.length; i++) {
        const cardEl = cardRefs.current[i];
        if (cardEl) {
          const rect = cardEl.getBoundingClientRect();
          const visibleTop = Math.max(containerRect.top, rect.top);
          const visibleBottom = Math.min(containerRect.bottom, rect.bottom);
          const visibleHeight = Math.max(0, visibleBottom - visibleTop);

          if (visibleHeight > maxVisibleHeight) {
            maxVisibleHeight = visibleHeight;
            dominantIndex = i;
          }
        }
      }

      setCurrentVisibleIndex(dominantIndex);
    };

    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        updateDominantCardAndVisibility();
      });
    };

    // Initial calculation on mount / item changes
    updateDominantCardAndVisibility();

    container.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [displayItems.map((i) => i.id).join(','), displayItems.length, alwaysShowNav, selectedView]);

  const formatBytes = (bytes?: number | null) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatSpeed = (bytesPerSec: number) => {
    if (!bytesPerSec || bytesPerSec <= 0 || !isFinite(bytesPerSec)) return '0 B/s (0 Mbps)';
    const mbps = Math.round((bytesPerSec * 8) / 1_000_000);
    const k = 1024;
    if (bytesPerSec >= k * k * k) {
      const gb = (bytesPerSec / (k * k * k)).toFixed(1);
      return `${gb} GB/s (${mbps} Mbps)`;
    }
    if (bytesPerSec >= k * k) {
      const mb = Math.round(bytesPerSec / (k * k));
      return `${mb} MB/s (${mbps} Mbps)`;
    }
    if (bytesPerSec >= k) {
      const kb = Math.round(bytesPerSec / k);
      return `${kb} KB/s (${mbps} Mbps)`;
    }
    return `${Math.round(bytesPerSec)} B/s (${mbps} Mbps)`;
  };

  const formatEta = (seconds?: number | null) => {
    if (seconds === undefined || seconds === null || seconds <= 0 || !isFinite(seconds)) return null;

    // 1. Over 1 hour: "X hr Y min left"
    if (seconds >= 3600) {
      const hours = Math.floor(seconds / 3600);
      const remMins = Math.round((seconds % 3600) / 60);
      if (remMins === 0) return `${hours} hr left`;
      return `${hours} hr ${remMins} min left`;
    }

    // 2. Over 1 minute (>= 60s): "1 min left", "2 min left", "3 min left" (clean IDM style, no fluctuating seconds)
    if (seconds >= 60) {
      const mins = Math.max(1, Math.round(seconds / 60));
      return mins === 1 ? '1 min left' : `${mins} min left`;
    }

    // 3. Under 1 minute (< 60s): steady seconds
    const roundedSecs = Math.max(1, Math.round(seconds));
    return `${roundedSecs} sec left`;
  };

  const renderQueueBanner = (showGuideButton: boolean = true) => (
    <div className="px-3 sm:px-3.5 py-2 rounded-xl bg-zinc-50/80 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 shadow-2xs flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 sm:gap-3 shrink-0 select-none">
      <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1 overflow-hidden">
        <div
          className={`w-7 h-7 flex items-center justify-center shrink-0 border ${
            isQueueRunning
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
              : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-500 dark:text-zinc-400 border-zinc-300 dark:border-zinc-700'
          }`}
        >
          <ListOrdered className="w-3.5 h-3.5 stroke-[2]" />
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <span className="font-mono-tabular text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400 font-semibold shrink-0 leading-none">
              QUEUES WORKSPACE
            </span>
            <span className="w-1 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600 shrink-0" />
            <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 shrink-0 leading-none">
              Simple 1-by-1 Queue
            </h3>
          </div>
          <p className="font-mono-tabular text-[11px] text-zinc-500 dark:text-zinc-400 mt-1 truncate leading-none">
            {isQueueRunning
              ? activeItems.length > 0
                ? `Downloading 1 file at maximum speed. ${queuedItems.length} file(s) waiting in line.`
                : `Queue is active and listening for queued tasks.`
              : queuedItems.length > 0
              ? `${queuedItems.length} file(s) in line. Click Start to download 1-by-1 sequentially.`
              : `Queue is empty. Ready for downloads.`}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <span
          className={`h-7 sm:h-7.5 px-3 min-w-[104px] border shrink-0 uppercase tracking-wider inline-flex items-center justify-center font-mono-tabular text-[9.5px] sm:text-[10px] font-semibold leading-none ${
            isQueueRunning
              ? 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
              : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 bg-zinc-100/80 dark:bg-zinc-800/80'
          }`}
        >
          {isQueueRunning ? 'QUEUE ACTIVE' : 'QUEUE PAUSED'}
        </span>

        {showGuideButton && (
          <button
            type="button"
            onClick={() => openExternalUrl('https://downex.apps.gauravpatil.site/how-queues-work')}
            className="h-7 sm:h-7.5 px-2.5 sm:px-3 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-mono-tabular text-[9.5px] sm:text-[10px] uppercase tracking-wider text-zinc-700 dark:text-zinc-300 shrink-0 cursor-pointer flex items-center justify-center leading-none"
            title="Learn how 1-by-1 Queue works and how to add downloads"
          >
            How it works
          </button>
        )}

        {isQueueRunning ? (
          <button
            type="button"
            onClick={pauseQueue}
            className="h-7 sm:h-7.5 px-3 min-w-[104px] border border-amber-300 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/40 font-mono-tabular text-[9.5px] sm:text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300 shrink-0 cursor-pointer flex items-center justify-center leading-none"
          >
            Pause Queue
          </button>
        ) : (
          <button
            type="button"
            disabled={queuedItems.length === 0}
            onClick={() => {
              const nonResumable = queuedItems.filter((i) => !getResumeCapability(i).canResume);
              if (nonResumable.length > 0) {
                setBatchPauseCustomItems(queuedItems);
                setBatchPauseAction('start_queue');
              } else {
                startQueue();
              }
            }}
            className="h-7 sm:h-7.5 px-3 min-w-[104px] bg-zinc-800 hover:bg-black dark:bg-zinc-200 dark:hover:bg-white text-white dark:text-zinc-900 font-mono-tabular text-[9.5px] sm:text-[10px] font-semibold uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed shrink-0 cursor-pointer shadow-xs flex items-center justify-center leading-none"
          >
            <span>Start Queue</span>
          </button>
        )}
      </div>
    </div>
  );

  if (displayItems.length === 0) {
    if (isSearchActive) {
      return (
        <div className="flex-1 overflow-y-auto min-h-0 p-6 flex flex-col items-center justify-center text-center select-none max-w-lg mx-auto w-full my-auto animate-in fade-in duration-200">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 flex items-center justify-center mb-3.5 text-amber-600 dark:text-amber-400 shadow-2xs">
            <SearchX className="w-7 h-7 stroke-[1.75]" />
          </div>
          <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
            No matches found in app for "{searchQuery}"
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-sm">
            We searched across all active layers: filenames, file extensions (.iso, .zip, .exe), source URLs, and destination paths.
          </p>

          {/* Layers Matrix */}
          <div className="mt-3.5 flex flex-wrap items-center justify-center gap-1.5 max-w-md">
            <span className="px-2.5 py-1 rounded-md text-[11px] font-mono bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800">
              ✓ Filenames
            </span>
            <span className="px-2.5 py-1 rounded-md text-[11px] font-mono bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800">
              ✓ Extensions (.iso, .zip, .exe)
            </span>
            <span className="px-2.5 py-1 rounded-md text-[11px] font-mono bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800">
              ✓ Source URLs
            </span>
            <span className="px-2.5 py-1 rounded-md text-[11px] font-mono bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800">
              ✓ Save Folders
            </span>
          </div>

          {/* Search tips */}
          <div className="mt-4 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/70 dark:border-zinc-800 text-left w-full text-xs text-zinc-500 dark:text-zinc-400 space-y-1">
            <p className="font-semibold text-zinc-700 dark:text-zinc-300">Suggestions:</p>
            <p>• Check for typos or try searching with a shorter keyword.</p>
            <p>• Search by file type like <code className="font-mono text-zinc-700 dark:text-zinc-300">.iso</code>, <code className="font-mono text-zinc-700 dark:text-zinc-300">.exe</code>, or <code className="font-mono text-zinc-700 dark:text-zinc-300">.zip</code>.</p>
            <p>• If deleted, check the <strong className="text-zinc-700 dark:text-zinc-300 cursor-pointer hover:underline" onClick={() => { setSearchQuery(''); setSelectedView('trash'); }}>Trash</strong> folder.</p>
          </div>

          {/* Recovery Buttons */}
          <div className="mt-5 flex items-center justify-center gap-2.5">
            <Button
              variant="primary"
              size="sm"
              icon={<RotateCcw className="w-3.5 h-3.5" />}
              onClick={() => setSearchQuery('')}
            >
              Clear Search (Esc)
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => setNewModalOpen(true)}
            >
              + New Download
            </Button>
          </div>
        </div>
      );
    }

    if (isQueuesView) {
      return (
        <div className="flex-1 min-h-0 h-full p-2.5 sm:p-3 flex flex-col justify-between overflow-hidden select-none">
          {renderQueueBanner(false)}

          <div className="flex-1 min-h-0 flex flex-col justify-between py-1 sm:py-1.5 w-full max-w-3xl mx-auto">
            {/* Center Header */}
            <div className="text-center space-y-0.5 shrink-0 pt-0.5">
              <div className="font-mono-tabular text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400 font-semibold">
                SIMPLE 1-BY-1 QUEUE
              </div>
              <h3 className="text-sm sm:text-base font-bold text-zinc-900 dark:text-zinc-100 tracking-tight font-mono-tabular">
                How 1-by-1 Queue Works
              </h3>
              <p className="font-mono-tabular text-[10.5px] text-zinc-500 dark:text-zinc-400 max-w-md mx-auto leading-tight">
                Downloads run one after another at maximum speed without slowing down your internet.
              </p>
            </div>

            {/* 3 Symmetrical Step Cards */}
            <div className="w-full grid grid-cols-3 gap-2.5 sm:gap-3 text-left my-auto py-1">
              {/* Card 1 */}
              <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 p-2.5 sm:p-3 flex flex-col justify-between transition-colors">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[9.5px] uppercase font-mono-tabular text-emerald-600 dark:text-emerald-400 font-semibold leading-tight">
                      STEP 01
                    </span>
                    <span className="text-[9px] font-mono-tabular px-1.5 py-0.2 border border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 uppercase shrink-0 font-medium">
                      CLEAN LIST
                    </span>
                  </div>
                  <div className="font-mono-tabular text-[12.5px] font-bold text-zinc-900 dark:text-zinc-100 leading-snug">
                    Add to Queue
                  </div>
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-snug font-sans text-justify [text-justify:inter-word]">
                    Click <strong className="font-mono text-zinc-800 dark:text-zinc-200">Later</strong> on new downloads or click <strong className="font-mono text-zinc-800 dark:text-zinc-200">Queue</strong> on any item. Files move here to keep your active list clean.
                  </p>
                </div>
                <div className="pt-1.5 text-[9px] font-mono-tabular text-zinc-400 uppercase tracking-wider border-t border-zinc-200/80 dark:border-zinc-800/80 mt-2 flex items-center justify-between">
                  <span>Action: Later</span>
                  <span>Clean List</span>
                </div>
              </div>

              {/* Card 2 */}
              <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 p-2.5 sm:p-3 flex flex-col justify-between transition-colors">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[9.5px] uppercase font-mono-tabular text-emerald-600 dark:text-emerald-400 font-semibold leading-tight">
                      STEP 02
                    </span>
                    <span className="text-[9px] font-mono-tabular px-1.5 py-0.2 border border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 uppercase shrink-0 font-medium">
                      SAFEGUARD
                    </span>
                  </div>
                  <div className="font-mono-tabular text-[12.5px] font-bold text-zinc-900 dark:text-zinc-100 leading-snug">
                    Numbered &amp; Safe
                  </div>
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-snug font-sans text-justify [text-justify:inter-word]">
                    Files line up in order (#1, #2). Downex checks resume support first so you never lose non-resumable download progress.
                  </p>
                </div>
                <div className="pt-1.5 text-[9px] font-mono-tabular text-zinc-400 uppercase tracking-wider border-t border-zinc-200/80 dark:border-zinc-800/80 mt-2 flex items-center justify-between">
                  <span>Safety: Loss Guard</span>
                  <span>Order #1...#N</span>
                </div>
              </div>

              {/* Card 3 */}
              <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 p-2.5 sm:p-3 flex flex-col justify-between transition-colors">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[9.5px] uppercase font-mono-tabular text-emerald-600 dark:text-emerald-400 font-semibold leading-tight">
                      STEP 03
                    </span>
                    <span className="text-[9px] font-mono-tabular px-1.5 py-0.2 border border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 uppercase shrink-0 font-medium">
                      AUTO HANDOFF
                    </span>
                  </div>
                  <div className="font-mono-tabular text-[12.5px] font-bold text-zinc-900 dark:text-zinc-100 leading-snug">
                    1-by-1 Full Speed
                  </div>
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-snug font-sans text-justify [text-justify:inter-word]">
                    Files download one at a time at top speed. When a file reaches 100%, it moves to completed and the next file starts.
                  </p>
                </div>
                <div className="pt-1.5 text-[9px] font-mono-tabular text-zinc-400 uppercase tracking-wider border-t border-zinc-200/80 dark:border-zinc-800/80 mt-2 flex items-center justify-between">
                  <span>Pipeline: 1-by-1</span>
                  <span>Auto Handoff</span>
                </div>
              </div>
            </div>

            {/* Bottom Actions Row */}
            <div className="flex items-center justify-center gap-2 pt-0.5 shrink-0">
              <button
                type="button"
                onClick={() => setNewModalOpen(true)}
                className="h-7.5 px-3.5 bg-zinc-800 hover:bg-black dark:bg-zinc-200 dark:hover:bg-white text-white dark:text-zinc-900 font-mono-tabular text-[10.5px] font-semibold uppercase tracking-wider shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.2]" />
                <span>Add Download to Queue</span>
              </button>

              <button
                type="button"
                onClick={() => openExternalUrl('https://downex.apps.gauravpatil.site/how-queues-work')}
                className="h-7.5 px-3 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-mono-tabular text-[10.5px] uppercase tracking-wider text-zinc-700 dark:text-zinc-300 cursor-pointer flex items-center gap-1.5"
              >
                <span>How Queues Work</span>
                <span>&rarr;</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex-1 overflow-y-auto min-h-0 p-4 flex flex-col">
        {selectedView === 'all' && queuedItems.length > 0 ? (
          <div data-testid="queues-empty-state-card" className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none animate-in fade-in">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 dark:bg-amber-500/20 border border-amber-500/25 flex items-center justify-center mb-3 text-amber-600 dark:text-amber-400 shadow-2xs">
              <ListOrdered className="w-6 h-6 stroke-[2.2]" />
            </div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {queuedItems.length} {queuedItems.length === 1 ? 'download is' : 'downloads are'} organized in Queues
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-sm">
              Queued files download sequentially 1-by-1 in the dedicated Queues workspace. Once completed, they appear here.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <Button
                variant="primary-emerald"
                size="sm"
                icon={<ArrowRight className="w-3.5 h-3.5" />}
                onClick={() => setSelectedView('queues')}
                className="font-semibold text-xs h-7.5 px-3.5"
              >
                Open Queues ({queuedItems.length})
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none text-zinc-400 dark:text-zinc-600">
            <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center mb-3">
              {selectedView === 'trash' ? (
                <Trash2 className="w-6 h-6 stroke-[1.5]" />
              ) : (
                <File className="w-6 h-6 stroke-[1.5]" />
              )}
            </div>
            <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              {selectedView === 'trash'
                ? 'Trash is empty'
                : selectedView === 'active'
                ? 'No active downloads'
                : selectedView === 'completed'
                ? 'No completed downloads'
                : 'No downloads found'}
            </p>
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1 max-w-sm">
              {selectedView === 'trash'
                ? 'Failed or cancelled downloads will appear here.'
                : selectedView === 'active'
                ? 'Active and running downloads will appear here.'
                : selectedView === 'completed'
                ? 'Finished downloads will appear here.'
                : 'Click "+ New Download" or copy any download link to start.'}
            </p>
          </div>
        )}

        {import.meta.env.DEV && !isTauri && selectedView !== 'queues' && (
          <button
              onClick={() => {
                const sample: DownloadItem = {
                  id: 'mock-completed-setup',
                  url: 'https://gphost.eu.cc/raw/downex-desktop',
                  filename: 'Downex-0.0.1-Setup.exe',
                  destination_path: 'C:\\Users\\namit\\Downloads\\Downex\\Downex-0.0.1-Setup.exe',
                  total_bytes: 3562767,
                  downloaded_bytes: 3562767,
                  status: 'completed',
                  queue_id: 'default',
                  speed_bytes_sec: 0,
                  eta_seconds: 0,
                  supports_ranges: true,
                  created_at: Date.now() - 3600000,
                  updated_at: Date.now(),
                  segments: [
                    { index: 0, start: 0, end: 445345, downloaded: 445345, speed_bytes_sec: 0, is_active: false },
                    { index: 1, start: 445346, end: 890691, downloaded: 445345, speed_bytes_sec: 0, is_active: false },
                    { index: 2, start: 890692, end: 1336037, downloaded: 445345, speed_bytes_sec: 0, is_active: false },
                    { index: 3, start: 1336038, end: 1781383, downloaded: 445345, speed_bytes_sec: 0, is_active: false },
                    { index: 4, start: 1781384, end: 2226729, downloaded: 445345, speed_bytes_sec: 0, is_active: false },
                    { index: 5, start: 2226730, end: 2672075, downloaded: 445345, speed_bytes_sec: 0, is_active: false },
                    { index: 6, start: 2672076, end: 3117421, downloaded: 445345, speed_bytes_sec: 0, is_active: false },
                    { index: 7, start: 3117422, end: 3562767, downloaded: 445345, speed_bytes_sec: 0, is_active: false },
                  ],
                };
                injectMockDownloadItem(sample);
                useDownloadStore.setState((prev) => ({ items: [sample, ...prev.items], selectedView: 'all' }));
              }}
              className="mt-3.5 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300/80 dark:border-emerald-800/80 text-xs font-semibold shadow-xs transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Load Sample Completed Download (Downex-0.0.1-Setup.exe)</span>
            </button>
          )}
        </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto min-h-0 px-4 py-2 space-y-2.5 pb-16">
        {isQueuesView && renderQueueBanner()}
        {selectedView === 'all' && queuedItems.length > 0 && !isSearchActive && (
          <div data-testid="queues-awareness-banner" className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-amber-500/10 dark:bg-amber-950/30 border border-amber-500/20 dark:border-amber-500/30 text-xs font-mono-tabular select-none animate-in fade-in shadow-2xs">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-md bg-amber-500/15 dark:bg-amber-500/25 flex items-center justify-center shrink-0 text-amber-600 dark:text-amber-400">
                <ListOrdered className="w-3.5 h-3.5 stroke-[2.2]" />
              </div>
              <span className="text-zinc-700 dark:text-zinc-300 truncate">
                <strong className="text-zinc-900 dark:text-zinc-100 font-semibold">{queuedItems.length}</strong> {queuedItems.length === 1 ? 'download' : 'downloads'} organized in <strong className="text-amber-700 dark:text-amber-300 font-semibold">Queues</strong>
                <span className="text-zinc-400 dark:text-zinc-500 ml-1">({isQueueRunning ? '1-by-1 Queue Active' : 'Sequential Queue Ready'})</span>
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSelectedView('queues')}
              className="h-6 px-2.5 border border-amber-500/30 bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 rounded font-mono-tabular text-[10.5px] uppercase tracking-wider font-semibold cursor-pointer shrink-0 transition-colors flex items-center gap-1"
            >
              <span>Open Queues</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Batch Operations Bar (Available in All Downloads with 2+ files, and in Queues view whenever items are present or can be queued) */}
        {(displayItems.length >= 2 || (isQueuesView && (displayItems.length >= 1 || canQueueAny))) && (
          <div
            data-testid="batch-operations-bar"
            className="h-8 px-3 flex items-center justify-between rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800/90 text-xs font-mono-tabular select-none shadow-2xs shrink-0"
          >
            {/* Left Summary */}
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider text-[10.5px]">
                {isQueuesView
                  ? `${displayItems.length} in Queue`
                  : `${displayItems.length} Files Operating`}
              </span>
              <span className="text-zinc-300 dark:text-zinc-700">•</span>
              <div className="flex items-center gap-2 text-[10px]">
                {downloadingCount > 0 && (
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    {downloadingCount} Active
                  </span>
                )}
                {pausedCount > 0 && (
                  <span className="text-amber-600 dark:text-amber-400 font-semibold">
                    {pausedCount} Paused
                  </span>
                )}
                {queuedCount > 0 && (
                  <span className="text-violet-600 dark:text-violet-400 font-semibold">
                    {queuedCount} Queued
                  </span>
                )}
                {errorCount > 0 && (
                  <span className="text-rose-600 dark:text-rose-400 font-semibold">
                    {errorCount} Error
                  </span>
                )}
              </div>
            </div>

            {/* Right Batch Actions */}
            <div className="flex items-center gap-1.5 shrink-0">
              {downloadingCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const toPause = displayItems.filter((i) => i.status === 'downloading' || i.status === 'probing');
                    setBatchPauseCustomItems(toPause);
                    setBatchPauseAction('pause');
                  }}
                  data-testid="batch-pause-all-btn"
                  className="h-6 px-2.5 border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 font-mono-tabular text-[10px] uppercase tracking-wider font-semibold cursor-pointer flex items-center gap-1 transition-colors"
                  title="Pause all active downloading files"
                >
                  <Pause className="w-2.5 h-2.5 fill-current" />
                  <span>Pause All</span>
                </button>
              )}

              {(pausedCount > 0 || errorCount > 0) && (
                <button
                  type="button"
                  onClick={() => {
                    const toResume = displayItems.filter(
                      (i) => i.status === 'paused' || i.status === 'failed' || i.status === 'error'
                    );
                    setBatchPauseCustomItems(toResume);
                    setBatchPauseAction('resume');
                  }}
                  data-testid="batch-resume-all-btn"
                  className="h-6 px-2.5 border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-mono-tabular text-[10.5px] uppercase tracking-wider font-semibold cursor-pointer flex items-center gap-1 transition-colors"
                  title="Resume all paused and stopped files"
                >
                  <Play className="w-2.5 h-2.5 fill-current" />
                  <span>Resume All</span>
                </button>
              )}

              {canQueueAny && (
                <button
                  type="button"
                  onClick={() => {
                    const toQueue = displayItems.filter((i) => i.status !== 'completed' && i.status !== 'queued');
                    setBatchPauseCustomItems(toQueue);
                    setBatchPauseAction('queue');
                  }}
                  data-testid="batch-queue-all-btn"
                  className="h-6 px-2.5 border border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/20 text-violet-700 dark:text-violet-300 font-mono-tabular text-[10px] uppercase tracking-wider font-semibold cursor-pointer flex items-center gap-1 transition-colors"
                  title="Queue all available downloads for sequential 1-by-1 download"
                >
                  <ListOrdered className="w-2.5 h-2.5" />
                  <span>Queue All</span>
                </button>
              )}

              {canUnqueueAny && (
                <button
                  type="button"
                  onClick={() => unqueueAllDownloads()}
                  data-testid="batch-unqueue-all-btn"
                  className="h-6 px-2.5 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-mono-tabular text-[10px] uppercase tracking-wider cursor-pointer flex items-center gap-1 transition-colors"
                  title="Remove all files from sequential queue"
                >
                  <Undo2 className="w-2.5 h-2.5" />
                  <span>Unqueue All</span>
                </button>
              )}

              {displayItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => setIsBatchDeleteOpen(true)}
                  data-testid="batch-delete-all-btn"
                  className="h-6 px-2.5 border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 font-mono-tabular text-[10px] uppercase tracking-wider font-semibold cursor-pointer flex items-center gap-1 transition-colors"
                  title="Delete all operating files from list or device"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                  <span>Delete All</span>
                </button>
              )}
            </div>
          </div>
        )}

        {isSearchActive && (
        <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-zinc-100/90 dark:bg-zinc-900/90 border border-zinc-200/80 dark:border-zinc-800/80 text-xs shadow-2xs">
          <div className="flex items-center gap-2 min-w-0">
            <Search className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span className="text-zinc-600 dark:text-zinc-300 truncate">
              Search in App: Found <strong className="text-zinc-900 dark:text-zinc-100 font-semibold">{displayItems.length}</strong> matching {displayItems.length === 1 ? 'download' : 'downloads'} for <strong className="text-emerald-600 dark:text-emerald-400 font-semibold">"{searchQuery}"</strong>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-750 transition-all cursor-pointer shadow-2xs shrink-0"
          >
            <X className="w-3 h-3" />
            <span>Clear (Esc)</span>
          </button>
        </div>
      )}
      {displayItems.map((item, index) => {
        const isDownloading = item.status === 'downloading';
        const isPaused = item.status === 'paused';
        const isQueued = item.status === 'queued';
        const isError = item.status === 'failed' || item.status === 'error';
        const isExpanded = !!expandedItemIds[item.id];
        const resInfo = getResumeCapability(item);

        const rawBytes = item.downloaded_bytes || 0;
        const totalBytes = item.total_bytes || 0;

        // Monotonic forward persistence for downloaded bytes:
        let displayBytes = rawBytes;
        if (item.status === 'completed') {
          displayBytes = totalBytes > 0 ? totalBytes : rawBytes;
          persistentBytesRef.current[item.id] = displayBytes;
        } else if (isDownloading) {
          const prevMax = persistentBytesRef.current[item.id] || 0;
          if (rawBytes === 0 && prevMax > 0 && !resInfo.canResume) {
            persistentBytesRef.current[item.id] = 0;
            displayBytes = 0;
          } else {
            displayBytes = Math.max(prevMax, rawBytes);
            persistentBytesRef.current[item.id] = displayBytes;
          }
        } else if (isPaused) {
          displayBytes = Math.max(persistentBytesRef.current[item.id] || 0, rawBytes);
        } else {
          if (rawBytes === 0) {
            delete persistentBytesRef.current[item.id];
          }
        }

        const rawPercent =
          totalBytes > 0
            ? Math.min(100, Math.round((displayBytes / totalBytes) * 100))
            : 0;

        // Monotonic forward persistence for percentage:
        let percent = rawPercent;
        if (item.status === 'completed') {
          percent = 100;
          persistentPercentRef.current[item.id] = 100;
        } else if (isDownloading) {
          const prevMax = persistentPercentRef.current[item.id] || 0;
          if (rawBytes === 0 && prevMax > 0 && !resInfo.canResume) {
            persistentPercentRef.current[item.id] = 0;
            percent = 0;
          } else {
            percent = Math.max(prevMax, rawPercent);
            persistentPercentRef.current[item.id] = percent;
          }
        } else if (isPaused) {
          percent = Math.max(persistentPercentRef.current[item.id] || 0, rawPercent);
        } else {
          if (rawBytes === 0) {
            delete persistentPercentRef.current[item.id];
          }
        }

        // Monotonic high-precision progress bar width (silky forward flow without backward flickers):
        const rawBarPercent =
          totalBytes > 0
            ? Math.min(100, Math.max(0, (displayBytes / totalBytes) * 100))
            : isDownloading
            ? 2
            : 0;

        let barWidth = rawBarPercent;
        if (item.status === 'completed') {
          barWidth = 100;
          persistentBarWidthRef.current[item.id] = 100;
        } else if (isDownloading) {
          const prevMax = persistentBarWidthRef.current[item.id] || 0;
          if (rawBytes === 0 && prevMax > 0 && !resInfo.canResume) {
            persistentBarWidthRef.current[item.id] = isDownloading ? 2 : 0;
            barWidth = isDownloading ? 2 : 0;
          } else {
            barWidth = Math.max(prevMax, Math.max(rawBarPercent, 2));
            persistentBarWidthRef.current[item.id] = barWidth;
          }
        } else if (isPaused) {
          barWidth = Math.max(persistentBarWidthRef.current[item.id] || 0, rawBarPercent);
        } else {
          if (rawBytes === 0) {
            delete persistentBarWidthRef.current[item.id];
          }
        }

        // Track persistent speed across brief packet pauses and smoothly damp fluctuations
        let effectiveSpeed = 0;
        if (isDownloading) {
          const rawSpeed = item.speed_bytes_sec > 0 ? item.speed_bytes_sec : (persistentSpeedRef.current[item.id] || 0);
          if (rawSpeed > 0) {
            persistentSpeedRef.current[item.id] = rawSpeed;
            const prev = smoothedSpeedRef.current[item.id] || rawSpeed;
            // Smoothly glide rate changes (80% previous, 20% target) to eliminate frantic jitter
            const smoothed = Math.round((prev * 0.80) + (rawSpeed * 0.20));
            smoothedSpeedRef.current[item.id] = smoothed;
            effectiveSpeed = smoothed;
          } else {
            delete smoothedSpeedRef.current[item.id];
          }
        } else {
          delete persistentSpeedRef.current[item.id];
          delete smoothedSpeedRef.current[item.id];
        }

        // IDM-style smoothed persistent ETA filter
        const remainingBytes = totalBytes && totalBytes > displayBytes
          ? totalBytes - displayBytes
          : 0;

        let computedEta = item.eta_seconds && item.eta_seconds > 0 ? item.eta_seconds : null;
        if (!computedEta && remainingBytes > 0 && effectiveSpeed > 0) {
          computedEta = Math.max(1, Math.round(remainingBytes / effectiveSpeed));
        }

        let effectiveEta: number | null = null;
        if (isDownloading) {
          const now = Date.now();
          const prevEntry = smoothedEtaRef.current[item.id];
          if (!prevEntry) {
            const initial = computedEta || (effectiveSpeed > 0 ? Math.round(remainingBytes / effectiveSpeed) : 0);
            if (initial > 0) {
              smoothedEtaRef.current[item.id] = { eta: initial, lastUpdated: now };
              effectiveEta = initial;
            }
          } else {
            const elapsed = Math.max(0, (now - prevEntry.lastUpdated) / 1000);
            // Steady natural countdown: subtract elapsed seconds without abrupt jumps
            const naturalDecayed = Math.max(1, prevEntry.eta - elapsed);
            if (computedEta && computedEta > 0) {
              // Heavy dampening: 88% decayed previous, 12% new instant calculation
              const smoothed = (naturalDecayed * 0.88) + (computedEta * 0.12);
              smoothedEtaRef.current[item.id] = { eta: smoothed, lastUpdated: now };
              effectiveEta = smoothed;
            } else {
              smoothedEtaRef.current[item.id] = { eta: naturalDecayed, lastUpdated: now };
              effectiveEta = naturalDecayed;
            }
          }
        } else {
          delete smoothedEtaRef.current[item.id];
          delete persistentEtaRef.current[item.id];
        }

        const formattedEta = effectiveEta ? formatEta(effectiveEta) : null;

        // Dynamic Active Time Tracking
        if (isDownloading) {
          if (!activeStartRef.current[item.id]) {
            activeStartRef.current[item.id] = Date.now();
          }
        } else if (item.status === 'completed') {
          if (activeStartRef.current[item.id]) {
            const elapsed = Math.max(1, Math.round((Date.now() - activeStartRef.current[item.id]) / 1000));
            activeDurationRef.current[item.id] = elapsed;
            delete activeStartRef.current[item.id];
          }
        } else {
          delete activeStartRef.current[item.id];
        }

        // Calculate Time Taken for completed downloads
        let timeTakenSeconds = 0;
        if (item.status === 'completed') {
          const sessionSec = activeDurationRef.current[item.id];
          if (sessionSec && sessionSec > 0) {
            timeTakenSeconds = sessionSec;
          } else {
            const startMs = item.created_at ? (item.created_at < 1e11 ? item.created_at * 1000 : item.created_at) : 0;
            const endMs = item.updated_at ? (item.updated_at < 1e11 ? item.updated_at * 1000 : item.updated_at) : 0;
            if (endMs > startMs && startMs > 0) {
              timeTakenSeconds = Math.max(1, Math.round((endMs - startMs) / 1000));
            } else if (displayBytes && item.base_speed_bytes_sec && item.base_speed_bytes_sec > 0) {
              timeTakenSeconds = Math.max(1, Math.round(displayBytes / item.base_speed_bytes_sec));
            }
          }
        }
        const formattedTimeTaken = formatTimeTaken(timeTakenSeconds);
        const displayedDiskPath = getActiveDownloadDiskPath(item);

        // Calculate queue position if in queue or if queues view
        let queueBadgeText = '';
        if (isQueuesView || isQueued) {
          if (isDownloading) {
            queueBadgeText = '#1 • Active';
          } else if (isQueued) {
            const queuedIdx = queuedItems.findIndex((q) => q.id === item.id);
            const activeCountInQueue = (isQueueRunning && activeQueueTaskId) ? 1 : 0;
            const pos = activeCountInQueue + (queuedIdx >= 0 ? queuedIdx + 1 : 1);
            queueBadgeText = pos === 1 ? '#1 • Next in Line' : `#${pos} • In Line`;
          }
        }

        return (
          <div
            key={item.id}
            ref={(el) => { cardRefs.current[index] = el; }}
            id={`download-card-${item.id}`}
            className={`rounded-xl border transition-all overflow-hidden flex flex-col scroll-mt-2 ${
              isDownloading
                ? 'border-emerald-500/50 dark:border-emerald-500/40 bg-white dark:bg-zinc-950 shadow-sm ring-1 ring-emerald-500/20'
                : isError
                ? 'border-rose-400/60 dark:border-rose-900/60 bg-white dark:bg-zinc-950 shadow-xs'
                : 'border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-xs hover:border-zinc-400 dark:hover:border-zinc-700'
            }`}
          >
            {/* Title Bar Strip: Task #, Status Badge, Queue Tag & Header Actions */}
            <div className="h-8 px-3 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 select-none">
              <div className="flex items-center gap-2">
                {/* Dynamic Task Index Badge (#1, #2, #3...) - prominently visible to naked eye */}
                <span
                  data-testid={`card-index-${item.id}`}
                  className={`font-mono-tabular text-[10px] font-bold px-1.5 py-0.2 rounded border select-none transition-colors ${
                    isDownloading
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35'
                      : isPaused
                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/35'
                      : isQueued
                      ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/35'
                      : isError
                      ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/35'
                      : 'bg-zinc-200/70 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700'
                  }`}
                  title={`Download Task #${index + 1} of ${displayItems.length}`}
                >
                  #{index + 1}
                </span>

                <span className={`font-mono-tabular text-[10.5px] uppercase tracking-wider font-semibold flex items-center gap-1.5 ${
                  item.status === 'completed'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : isDownloading
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : isPaused
                    ? 'text-amber-600 dark:text-amber-400'
                    : isQueued
                    ? 'text-violet-600 dark:text-violet-400'
                    : isError
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-zinc-500'
                }`}>
                  {item.status === 'completed'
                    ? 'COMPLETED'
                    : isDownloading && effectiveSpeed === 0 && item.downloaded_bytes === 0
                    ? 'CONNECTING...'
                    : isDownloading
                    ? 'DOWNLOADING'
                    : isPaused
                    ? 'PAUSED'
                    : isQueued
                    ? 'QUEUED'
                    : isError
                    ? 'FAILED'
                    : item.status.toUpperCase()}
                </span>
                {queueBadgeText && (
                  <span className="text-[9.5px] font-mono-tabular px-1.5 py-0.2 rounded bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 font-semibold">
                    {queueBadgeText}
                  </span>
                )}
              </div>

              {/* Header Actions */}
              <div className="flex items-center gap-1.5">
                {/* Auto-shutdown button */}
                {item.status !== 'completed' && (
                  <button
                    type="button"
                    data-testid={`auto-shutdown-toggle-${item.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleShutdownClick(item);
                    }}
                    className={`px-2 py-0.5 text-[10px] font-mono-tabular font-medium transition-all cursor-pointer flex items-center gap-1 border ${
                      isShutdownArmed(item.id)
                        ? 'bg-rose-500/15 dark:bg-rose-950/40 border-rose-500/50 text-rose-600 dark:text-rose-400 font-semibold'
                        : 'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
                    }`}
                    title={isShutdownArmed(item.id) ? 'Turn off auto-shutdown' : 'Shut down PC when download completes'}
                  >
                    <Power className={`w-3 h-3 ${isShutdownArmed(item.id) ? 'text-rose-500 stroke-[2.5]' : 'text-zinc-400'}`} />
                    <span>{isShutdownArmed(item.id) ? 'Shut down when done' : 'Auto-Shutdown'}</span>
                  </button>
                )}

                {/* Queue action if paused/failed */}
                {(item.status === 'paused' || item.status === 'failed' || item.status === 'error') && (
                  <button
                    type="button"
                    onClick={() => {
                      if ((item.status === 'downloading' || item.status === 'probing') && !getResumeCapability(item).canResume) {
                        setBatchPauseCustomItems([item]);
                        setBatchPauseAction('queue');
                      } else {
                        queueDownload(item.id);
                      }
                    }}
                    className="px-2 py-0.5 border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 font-mono-tabular text-[10px] uppercase tracking-wider font-semibold cursor-pointer flex items-center gap-1 transition-colors"
                    title="Add to sequential 1-by-1 download queue"
                  >
                    <ListOrdered className="w-2.5 h-2.5" />
                    <span>Queue</span>
                  </button>
                )}

                {/* Pause / Resume / Start / Retry */}
                {isDownloading ? (
                  <div className="flex items-center gap-1.5">
                    {pauseHintTaskId === item.id && (
                      <span
                        data-testid="pause-first-hint"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/15 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200 border border-amber-500/30 animate-in fade-in"
                      >
                        <AlertCircle className="w-2.5 h-2.5 text-amber-500 shrink-0" />
                        <span>Pause first to delete</span>
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleTogglePause(item.id)}
                      className="h-6 px-2.5 border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 font-mono-tabular text-[10.5px] uppercase tracking-wider font-semibold cursor-pointer flex items-center gap-1"
                      title={!resInfo.canResume ? "Pause (Warning: Server does not support resume - restarting will download from start)" : "Pause active download"}
                    >
                      <Pause className="w-2.5 h-2.5 fill-current" />
                      <span>Pause</span>
                    </button>
                    <span
                      className="inline-flex cursor-not-allowed"
                      title="Cannot delete while downloading. Pause the download first to delete."
                      onClick={() => handleAttemptDeleteWhileDownloading(item.id)}
                    >
                      <button
                        type="button"
                        disabled={true}
                        aria-disabled="true"
                        data-testid={`delete-btn-${item.id}`}
                        className="pointer-events-none h-6 px-2 border border-zinc-200 dark:border-zinc-800 bg-zinc-100/50 dark:bg-zinc-900/50 text-zinc-400 dark:text-zinc-600 font-mono-tabular text-[10.5px] uppercase tracking-wider flex items-center gap-1 opacity-50"
                        title="Cannot delete while downloading. Pause the download first to delete."
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                        <span>Delete</span>
                      </button>
                    </span>
                  </div>
                ) : isPaused ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleTogglePause(item.id)}
                      className="h-6 px-2.5 border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-mono-tabular text-[10.5px] uppercase tracking-wider font-semibold cursor-pointer flex items-center gap-1"
                      title={!resInfo.canResume ? "Restart download from beginning (Server does not support resume)" : "Resume download"}
                    >
                      <Play className="w-2.5 h-2.5 fill-current" />
                      <span>{resInfo.label === 'No' ? 'Restart' : 'Resume'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingItem(item)}
                      data-testid={`delete-btn-${item.id}`}
                      className="h-6 px-2 border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 font-mono-tabular text-[10.5px] uppercase tracking-wider cursor-pointer flex items-center gap-1"
                      title="Delete download"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                      <span>Delete</span>
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    {item.status !== 'completed' && (
                      <button
                        type="button"
                        onClick={() => handleTogglePause(item.id)}
                        className={`h-6 px-2.5 border font-mono-tabular text-[10.5px] uppercase tracking-wider font-semibold cursor-pointer flex items-center gap-1 ${
                          isError
                            ? 'border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300'
                            : 'border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                        }`}
                        title={isQueued ? 'Start now' : isError ? 'Retry check & resume' : 'Resume'}
                      >
                        {isError ? (
                          <RefreshCw className="w-2.5 h-2.5" />
                        ) : (
                          <Play className="w-2.5 h-2.5 fill-current" />
                        )}
                        <span>{isQueued ? 'Start' : isError ? 'Retry' : 'Resume'}</span>
                      </button>
                    )}
                    {isQueued && (
                      <button
                        type="button"
                        onClick={() => unqueueDownload(item.id)}
                        className="h-6 px-2 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-mono-tabular text-[10.5px] uppercase tracking-wider cursor-pointer flex items-center gap-1"
                        title="Remove from queue and return to All Downloads as paused"
                      >
                        <Undo2 className="w-2.5 h-2.5 text-zinc-400" />
                        <span>Unqueue</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDeletingItem(item)}
                      data-testid={`delete-btn-${item.id}`}
                      aria-label="Delete download..."
                      className="h-6 px-2 border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 font-mono-tabular text-[10.5px] uppercase tracking-wider cursor-pointer flex items-center gap-1"
                      title={item.status === 'completed' ? 'Delete download...' : 'Delete download'}
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                      <span>Delete</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Card Body: Structured Industrial Layout */}
            <div className="p-3.5 space-y-2.5">
              {/* Error & Machine Location Recovery Bar */}
              {(item.status === 'error' || item.status === 'failed') && item.error_message && (
                (() => {
                  const isFolderIssue = Boolean(
                    item.error_message.toLowerCase().includes('folder') || 
                    item.error_message.toLowerCase().includes('destination') || 
                    item.error_message.toLowerCase().includes('permission') || 
                    item.error_message.toLowerCase().includes('os error 3') || 
                    item.error_message.toLowerCase().includes('os error 5')
                  );

                  return (
                    <div className="flex items-center justify-between p-2 rounded bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-[11px] text-rose-700 dark:text-rose-300">
                      <div className="flex items-center gap-1.5 truncate pr-2">
                        <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                        <span className="truncate">{item.error_message}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isFolderIssue ? (
                          <button
                            type="button"
                            onClick={() => setRetryingFolderItem(item)}
                            className="px-2 py-0.5 rounded bg-rose-100 hover:bg-rose-200 dark:bg-rose-900/50 dark:hover:bg-rose-800/60 font-medium text-[10px] text-rose-800 dark:text-rose-200 transition-colors cursor-pointer flex items-center gap-1"
                          >
                            <FolderEdit className="w-3 h-3" />
                            <span>Change Location & Retry</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleTogglePause(item.id)}
                            className="px-2 py-0.5 rounded bg-rose-100 hover:bg-rose-200 dark:bg-rose-900/50 dark:hover:bg-rose-800/60 font-medium text-[10px] text-rose-800 dark:text-rose-200 transition-colors cursor-pointer flex items-center gap-1"
                          >
                            <RefreshCw className="w-3 h-3" />
                            <span>Retry</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()
              )}

              {/* Row 1: File Name Container (Image 2 Modal tribute) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider font-mono-tabular">
                    File Name
                  </span>
                  <span className="text-[10px] font-mono-tabular text-zinc-400">
                    {item.status === 'completed' ? 'SAVED TO DISK' : 'ACTIVE TASK'}
                  </span>
                </div>
                <div className="flex items-center border border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50 px-2.5 py-1.5 gap-2">
                  <div className="text-zinc-400 dark:text-zinc-500 shrink-0">
                    <File className="w-3.5 h-3.5" />
                  </div>
                  <h4 className="flex-1 font-mono-tabular text-[12px] font-semibold text-zinc-900 dark:text-zinc-100 select-text leading-tight break-all">
                    {item.filename}
                  </h4>
                  {(() => {
                    const dotIdx = item.filename.lastIndexOf('.');
                    const ext = dotIdx > 0 ? item.filename.slice(dotIdx + 1) : '';
                    return ext ? (
                      <span className="px-1.5 py-0.5 text-[10px] font-mono-tabular font-semibold bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 uppercase shrink-0">
                        .{ext}
                      </span>
                    ) : null;
                  })()}
                </div>
              </div>

              {/* Row 2: 2x2 Telemetry Grid (Complete Data, Absolutely Zero Ellipses) */}
              <div className="grid grid-cols-2 gap-2">
                {/* Box 1: File Size */}
                <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-950/40 px-2.5 py-1.5 flex items-center justify-between">
                  <div className="min-w-0">
                    <span className="text-[9.5px] uppercase font-mono-tabular text-zinc-400 block leading-tight">File Size</span>
                    <span className="font-mono-tabular text-[12.5px] font-bold text-zinc-900 dark:text-zinc-100 block leading-snug">
                      {formatBytes(item.total_bytes)}
                    </span>
                  </div>
                  <span className={`text-[9.5px] font-mono-tabular px-1.5 py-0.5 border shrink-0 ${
                    resInfo.canResume
                      ? 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5'
                      : 'border-zinc-300 dark:border-zinc-700 text-zinc-500'
                  }`}>
                    {resInfo.canResume ? 'RESUME OK' : 'SINGLE'}
                  </span>
                </div>

                {/* Box 2: Downloaded */}
                <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-950/40 px-2.5 py-1.5 flex items-center justify-between">
                  <div className="min-w-0">
                    <span className="text-[9.5px] uppercase font-mono-tabular text-zinc-400 block leading-tight">Downloaded</span>
                    <span className="font-mono-tabular text-[12.5px] font-bold text-zinc-900 dark:text-zinc-100 block leading-snug">
                      {formatBytes(displayBytes)} <span className="text-[10px] font-normal opacity-70">({percent}%)</span>
                    </span>
                  </div>
                  <span className="text-[9.5px] font-mono-tabular px-1.5 py-0.5 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-900 shrink-0 font-semibold">
                    {percent}%
                  </span>
                </div>

                {/* Box 3: Transfer Rate */}
                <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-950/40 px-2.5 py-1.5 flex items-center justify-between">
                  <div className="min-w-0">
                    <span className="text-[9.5px] uppercase font-mono-tabular text-zinc-400 block leading-tight">Transfer rate</span>
                    <span className={`font-mono-tabular text-[12.5px] font-bold block leading-snug ${
                      item.status === 'completed'
                        ? 'text-zinc-500 dark:text-zinc-400 font-normal'
                        : isDownloading && effectiveSpeed > 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : isDownloading
                        ? 'text-amber-600 dark:text-amber-400'
                        : isError
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-zinc-500'
                    }`}>
                      {item.status === 'completed'
                        ? '--'
                        : isDownloading && effectiveSpeed > 0
                        ? formatSpeed(effectiveSpeed)
                        : isDownloading
                        ? 'Connecting to server...'
                        : isError
                        ? 'Server error'
                        : '0 B/s (0 Mbps)'}
                    </span>
                  </div>
                  <span className="text-[9.5px] font-mono-tabular text-zinc-400 uppercase shrink-0">
                    {item.segments && item.segments.length > 0 ? `${Math.min(item.segments.length, 32)} Connection(s)` : resInfo.canResume ? '32 Threads' : '1 Stream'}
                  </span>
                </div>

                {/* Box 4: Time Left / Time Taken */}
                <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-950/40 px-2.5 py-1.5 flex items-center justify-between">
                  <div className="min-w-0">
                    <span className="text-[9.5px] uppercase font-mono-tabular text-zinc-400 block leading-tight">
                      {item.status === 'completed' ? 'Time taken' : 'Time left'}
                    </span>
                    <span className={`font-mono-tabular text-[12.5px] font-bold block leading-snug ${
                      isError ? 'text-rose-600 dark:text-rose-400' : 'text-zinc-900 dark:text-zinc-100'
                    }`}>
                      {isDownloading
                        ? (formattedEta || (effectiveSpeed === 0 ? 'Connecting to server...' : 'Calculating...'))
                        : isPaused
                        ? 'Paused'
                        : item.status === 'completed'
                        ? formattedTimeTaken
                        : isQueued
                        ? 'In Queue'
                        : isError
                        ? 'Interrupted'
                        : 'Pending'}
                    </span>
                  </div>
                  <span className="text-[9.5px] font-mono-tabular text-zinc-400 uppercase shrink-0">
                    {item.status === 'completed' ? 'DONE' : isDownloading ? 'LIVE' : isPaused ? 'HOLD' : isError ? 'ERR' : 'QUEUE'}
                  </span>
                </div>
              </div>

              {/* Row 3: Progress Bar & Inline Speed Limiter Unit (Tight 2px Gap) */}
              <div className="flex flex-col gap-[2px]">
                {/* Main Progress Bar (Sleek High-Precision Track with Specular Lighting) */}
                <div className="w-full h-[15px] bg-zinc-200/90 dark:bg-zinc-800/90 rounded-sm p-[1px] shadow-[inset_0_1.5px_3px_rgba(0,0,0,0.22)] border border-zinc-300/80 dark:border-zinc-700/80 relative overflow-hidden flex items-center">
                  <div
                    data-testid={`progress-bar-fill-${item.id}`}
                    className={`h-full rounded-xs transition-[width] duration-300 ease-out relative overflow-hidden ${
                      item.status === 'completed'
                        ? 'bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-400 shadow-sm'
                        : isDownloading
                        ? 'bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]'
                        : isPaused
                        ? 'bg-gradient-to-r from-amber-600 to-amber-500'
                        : (item.status === 'failed' || item.status === 'error')
                        ? 'bg-gradient-to-r from-rose-600 to-rose-500'
                        : 'bg-zinc-400 dark:bg-zinc-600'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(barWidth, 0)).toFixed(2)}%` }}
                  >
                    {isDownloading && (
                      <div className="absolute inset-0 animate-stripes opacity-45 mix-blend-overlay pointer-events-none" />
                    )}
                    {isDownloading && (
                      <div className="animate-shimmer pointer-events-none" />
                    )}
                    <div className="absolute inset-x-0 top-0 h-[45%] bg-gradient-to-b from-white/35 to-transparent pointer-events-none" />
                    <div className="absolute inset-x-0 bottom-0 h-[30%] bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
                    {isDownloading && percent > 0 && percent < 100 && (
                      <div className="absolute right-0 top-0 bottom-0 w-1.5 bg-white shadow-[0_0_8px_#ffffff,0_0_14px_#34d399] animate-pulse pointer-events-none" />
                    )}
                  </div>
                </div>

                {/* Inline Speed Limiter */}
                {(isDownloading || isPaused || isQueued) && (
                  <InlineSpeedLimiter item={item} />
                )}
              </div>

              {/* Row 4: Save To / Destination Box with Direct Open Folder Action */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider font-mono-tabular">
                    Save To
                  </span>
                  <span className="text-[10px] font-mono-tabular text-zinc-400">
                    {item.status === 'completed' ? 'SAVED FILE' : 'STAGING ARTIFACT'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1 min-w-0 border border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50 px-2 py-1 flex items-center gap-1.5">
                    <FolderOpen className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                    <span className="flex-1 font-mono-tabular text-[11px] text-zinc-800 dark:text-zinc-200 truncate select-all" title={displayedDiskPath}>
                      {displayedDiskPath}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(displayedDiskPath);
                        setCopiedId(item.id);
                        setTimeout(() => setCopiedId(null), 2000);
                      }}
                      className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors cursor-pointer shrink-0"
                      title="Copy path"
                    >
                      {copiedId === item.id ? (
                        <Check className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => openFileFolder(displayedDiskPath)}
                    className="h-7 px-3 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-mono-tabular text-[10px] uppercase tracking-wider shrink-0 cursor-pointer text-zinc-700 dark:text-zinc-200"
                    title="Open containing folder in Explorer"
                  >
                    Browse
                  </button>
                </div>
              </div>

              {/* Row 5: Details Toggle and Completed Actions */}
              <div className="flex items-center justify-between pt-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => toggleDetails(item.id)}
                  className="text-[10.5px] font-mono-tabular font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 flex items-center gap-1 cursor-pointer transition-colors shrink-0"
                >
                  {isExpanded ? (
                    <>
                      <ChevronUp className="w-3.5 h-3.5" />
                      <span>Hide details</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3.5 h-3.5" />
                      <span>Show details (Connections & Segments)</span>
                    </>
                  )}
                </button>

                {item.status === 'completed' && (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => openFileWith(item.destination_path)}
                      className="h-6 px-2.5 border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-mono-tabular text-[10px] uppercase tracking-wider cursor-pointer flex items-center gap-1"
                      title="Open with default program"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>Open with</span>
                    </button>
                    <button
                      onClick={() => showDownloadCompleteDialog({
                        id: item.id,
                        url: item.url,
                        filename: item.filename,
                        destination_path: item.destination_path,
                        total_bytes: item.total_bytes ?? undefined,
                        downloaded_bytes: item.downloaded_bytes ?? undefined,
                      })}
                      className="h-6 px-2.5 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-mono-tabular text-[10px] uppercase tracking-wider cursor-pointer text-zinc-700 dark:text-zinc-300"
                      title="Show complete details dialog"
                    >
                      Details
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* IDM-Style Expanded Details Drawer (Image 2 Tribute) */}
            {isExpanded && (
              <div className="px-3.5 pb-3.5 pt-2.5 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5 animate-in fade-in duration-150">
                {/* Single-stream / No-range notice banner */}
                {!resInfo.canResume && item.status !== 'completed' && (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs">
                    <AlertCircle className="w-4 h-4 shrink-0 text-amber-500" />
                    <span>Single-stream download: The remote server does not support HTTP Range requests. Pausing or stopping will restart the transfer from 0%.</span>
                  </div>
                )}

                {/* Start positions and download progress by connections visualizer */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider font-mono-tabular">
                      Start positions and download progress by connections
                    </span>
                    <div className="flex items-center gap-1.5 font-mono-tabular">
                      <span className="px-1.5 py-0.2 border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[9.5px] font-semibold">
                        {item.segments ? `${item.segments.filter((s) => s.is_active).length} Active` : '0 Active'}
                      </span>
                      {item.segments && item.segments.length > 0 && (
                        <span className="text-[9.5px] font-mono-tabular text-zinc-400">
                          {item.segments.length} THREADS
                        </span>
                      )}
                    </div>
                  </div>

                  {item.segments && item.segments.length > 0 ? (
                    <div className="h-[15px] w-full bg-zinc-200/90 dark:bg-zinc-800/90 rounded-sm p-[1px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)] border border-zinc-300/80 dark:border-zinc-700/80 overflow-hidden flex gap-[2px] items-center">
                      {item.segments.map((seg) => {
                        const segTotal = seg.end - seg.start;
                        const segPercent = segTotal > 0 ? Math.min(100, (seg.downloaded / segTotal) * 100) : 0;
                        return (
                          <div
                            key={seg.index}
                            className="h-full bg-zinc-100 dark:bg-zinc-900 rounded-xs overflow-hidden flex-1 relative group"
                            title={`Conn ${seg.index + 1}: ${Math.round(segPercent)}% (${formatBytes(seg.downloaded)} of ${formatBytes(segTotal)})`}
                          >
                            <div
                              className={`h-full transition-[width] duration-200 ease-out relative overflow-hidden ${
                                segPercent >= 100
                                  ? 'bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-400'
                                  : seg.is_active
                                  ? 'bg-gradient-to-r from-emerald-600 to-teal-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]'
                                  : 'bg-zinc-400 dark:bg-zinc-600'
                              }`}
                              style={{ width: `${segPercent}%` }}
                            >
                              <div className="absolute inset-x-0 top-0 h-[45%] bg-gradient-to-b from-white/30 to-transparent pointer-events-none" />
                              {/* Specular pulse tick marking active head of connection */}
                              {seg.is_active && segPercent < 100 && (
                                <div className="absolute right-0 top-0 bottom-0 w-[2px] bg-white shadow-[0_0_6px_#34d399] animate-pulse pointer-events-none" />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="h-2 w-full bg-zinc-100 dark:bg-zinc-800 rounded-full" />
                  )}
                </div>

                {/* Connections Table (N., Downloaded, Range Span, Status Info) - Minimalist Industrial Table */}
                {item.segments && item.segments.length > 0 && (() => {
                  const isShowAll = !!showAllSegmentsMap[item.id];
                  const displayedSegments = isShowAll ? item.segments : item.segments.slice(0, 4);
                  const hasMore = item.segments.length > 4;

                  return (
                    <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-950/40 rounded-sm">
                      <table className="w-full text-left font-mono-tabular text-[11px]">
                        <thead className="bg-zinc-100/80 dark:bg-zinc-900/80 border-b border-zinc-200 dark:border-zinc-800 text-[9.5px] text-zinc-500 dark:text-zinc-400 uppercase font-semibold tracking-wider">
                          <tr>
                            <th className="py-1.5 px-3 w-12 text-center">N.</th>
                            <th className="py-1.5 px-3">Downloaded</th>
                            <th className="py-1.5 px-3">Range Span</th>
                            <th className="py-1.5 px-3 text-right">Connection Info</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
                          {displayedSegments.map((seg) => {
                            const segTotal = seg.end - seg.start;
                            const segPercent = segTotal > 0 ? Math.min(100, (seg.downloaded / segTotal) * 100) : 0;
                            return (
                              <tr key={seg.index} className="hover:bg-zinc-100/50 dark:hover:bg-zinc-900/50 transition-colors">
                                <td className="py-1.5 px-3 font-semibold text-zinc-700 dark:text-zinc-300 text-center text-[11px]">
                                  {seg.index + 1}
                                </td>
                                <td className="py-1.5 px-3 font-bold text-zinc-900 dark:text-zinc-100 text-[11px]">
                                  {formatBytes(seg.downloaded)} <span className="text-[10px] font-normal text-zinc-400">({Math.round(segPercent)}%)</span>
                                </td>
                                <td className="py-1.5 px-3 text-[10.5px] text-zinc-500 dark:text-zinc-400">
                                  {formatBytes(seg.start)} – {formatBytes(seg.end)}
                                </td>
                                <td className="py-1.5 px-3 text-right">
                                  {seg.is_active ? (
                                    <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold text-[10.5px]">
                                      <span className="relative flex h-2 w-2 items-center justify-center shrink-0">
                                        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/80 animate-ping pointer-events-none" />
                                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.8)]" />
                                      </span>
                                      <span>Receiving data...</span>
                                    </span>
                                  ) : seg.downloaded > 0 && seg.downloaded >= (seg.end - seg.start) ? (
                                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium text-[10.5px]">
                                      <Check className="w-3 h-3 text-emerald-500" />
                                      <span>Completed</span>
                                    </span>
                                  ) : (
                                    <span className="text-zinc-400 dark:text-zinc-500 text-[10.5px]">
                                      Idle / Ready
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {hasMore && (
                        <div className="p-1.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex justify-center">
                          <button
                            type="button"
                            onClick={() => toggleShowAllSegments(item.id)}
                            className="h-6 px-3 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-mono-tabular text-[10px] uppercase tracking-wider cursor-pointer flex items-center gap-1.5 transition-colors"
                          >
                            {isShowAll ? (
                              <>
                                <ChevronUp className="w-3 h-3 text-zinc-400" />
                                <span>Show first 4 connections only</span>
                              </>
                            ) : (
                              <>
                                <ChevronDown className="w-3 h-3 text-zinc-400" />
                                <span>Show all {item.segments.length} connections ({item.segments.length - 4} more)</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        );
      })}
      </div>

      {/* Floating Card Navigator for smooth vertical jump between 1st, 2nd, 3rd card */}
      {displayItems.length >= 2 && (
        <div
          data-testid="card-scroll-navigator"
          className={`absolute bottom-3 right-5 z-20 flex items-center gap-1 px-2 py-1 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border border-zinc-200/90 dark:border-zinc-800/90 rounded-xl shadow-lg font-mono-tabular text-[10px] select-none transition-all duration-300 ease-out ${
            isNavVisible
              ? 'opacity-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 translate-y-3 pointer-events-none'
          }`}
        >
          {/* Scroll Up / Prev Card */}
          <button
            type="button"
            onClick={() => scrollToCard(currentVisibleIndex - 1)}
            disabled={currentVisibleIndex <= 0}
            data-testid="card-nav-prev"
            title={currentVisibleIndex > 0 ? `Scroll up to Card #${currentVisibleIndex}` : 'Already at first card'}
            className={`p-1 rounded transition-colors flex items-center justify-center ${
              currentVisibleIndex <= 0
                ? 'text-zinc-300 dark:text-zinc-700 cursor-not-allowed opacity-40'
                : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer'
            }`}
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>

          {/* Direct Card Jump Buttons: 1, 2, 3... (Dynamic status-aware auto-centering strip) */}
          <div
            ref={jumpStripRef}
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            className={`flex items-center gap-0.5 max-w-[240px] ${
              displayItems.length > 7 ? 'overflow-x-auto' : 'overflow-x-hidden'
            } no-scrollbar scroll-smooth px-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden`}
          >
            {displayItems.map((item, idx) => {
              const isSelected = currentVisibleIndex === idx;
              const status = item.status;
              const isDownloading = status === 'downloading' || status === 'probing';
              const isQueued = status === 'queued';
              const isPaused = status === 'paused';
              const isError = status === 'failed' || status === 'error';

              const activeBg = isDownloading
                ? 'bg-emerald-500 text-white shadow-2xs font-extrabold scale-105'
                : isQueued
                ? 'bg-violet-600 text-white shadow-2xs font-extrabold scale-105'
                : isPaused
                ? 'bg-amber-500 text-white shadow-2xs font-extrabold scale-105'
                : isError
                ? 'bg-rose-500 text-white shadow-2xs font-extrabold scale-105'
                : 'bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900 shadow-2xs font-extrabold scale-105';

              const inactiveStyle = isDownloading
                ? 'text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10'
                : isQueued
                ? 'text-violet-700 dark:text-violet-300 hover:bg-violet-500/10'
                : isPaused
                ? 'text-amber-700 dark:text-amber-300 hover:bg-amber-500/10'
                : isError
                ? 'text-rose-700 dark:text-rose-300 hover:bg-rose-500/10'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800';

              return (
                <button
                  key={item.id}
                  ref={isSelected ? activeJumpBtnRef : null}
                  type="button"
                  onClick={() => scrollToCard(idx)}
                  data-testid={`card-nav-jump-${idx + 1}`}
                  title={`Jump to Card #${idx + 1}: ${item.filename} (${status.toUpperCase()})`}
                  className={`min-w-[20px] h-5 px-1 rounded flex items-center justify-center font-bold text-[9.5px] transition-all cursor-pointer shrink-0 ${
                    isSelected ? activeBg : inactiveStyle
                  }`}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>

          {/* Scroll Down / Next Card */}
          <button
            type="button"
            onClick={() => scrollToCard(currentVisibleIndex + 1)}
            disabled={currentVisibleIndex >= displayItems.length - 1}
            data-testid="card-nav-next"
            title={currentVisibleIndex < displayItems.length - 1 ? `Scroll down to Card #${currentVisibleIndex + 2}` : 'Already at last card'}
            className={`p-1 rounded transition-colors flex items-center justify-center ${
              currentVisibleIndex >= displayItems.length - 1
                ? 'text-zinc-300 dark:text-zinc-700 cursor-not-allowed opacity-40'
                : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer'
            }`}
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>

          {/* Counter info pill with Queue support */}
          <span className="ml-1 pl-1.5 border-l border-zinc-200 dark:border-zinc-800 text-[9px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
            {isQueuesView && (
              <span className="text-violet-600 dark:text-violet-400 font-bold">QUE</span>
            )}
            <span>#{currentVisibleIndex + 1}/{displayItems.length}</span>
          </span>

          {/* Pin / Auto-Hide toggle */}
          <button
            type="button"
            onClick={() => {
              const nextState = !alwaysShowNav;
              setAlwaysShowNav(nextState);
              try {
                localStorage.setItem('downex_nav_always_visible', String(nextState));
              } catch {}
            }}
            data-testid="card-nav-pin-toggle"
            title={
              alwaysShowNav
                ? 'Always Visible (Pinned) • Click to auto-hide when at top'
                : 'Auto-hides at top • Click to pin always visible'
            }
            className={`ml-0.5 p-1 rounded transition-colors flex items-center justify-center cursor-pointer ${
              alwaysShowNav
                ? isQueuesView
                  ? 'text-violet-600 dark:text-violet-400 bg-violet-500/10 hover:bg-violet-500/20'
                  : 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20'
                : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            {alwaysShowNav ? (
              <Pin className="w-3 h-3 fill-current rotate-45" />
            ) : (
              <PinOff className="w-3 h-3 opacity-60" />
            )}
          </button>
        </div>
      )}

      {/* IDM Delete Confirmation & Device Wipe Modal */}
      <DeleteConfirmModal
        isOpen={!!deletingItem}
        item={deletingItem}
        onClose={() => setDeletingItem(null)}
        onConfirm={(id, deleteFromDisk) => {
          removeDownload(id, deleteFromDisk);
        }}
      />

      {/* Batch Delete Confirmation & Device Wipe Modal */}
      <BatchDeleteConfirmModal
        isOpen={isBatchDeleteOpen}
        items={displayItems}
        onClose={() => setIsBatchDeleteOpen(false)}
        onConfirm={(ids, deleteFromDisk) => {
          removeAllDownloads(ids, deleteFromDisk);
          setIsBatchDeleteOpen(false);
        }}
      />

      {/* Batch Pause & Queue Confirmation Modal (Destructive Operations Guard) */}
      <BatchPauseConfirmModal
        isOpen={batchPauseAction !== null}
        action={batchPauseAction}
        items={batchPauseCustomItems || displayItems}
        onClose={() => {
          setBatchPauseAction(null);
          setBatchPauseCustomItems(null);
        }}
        onConfirm={() => {
          const targetIds = (batchPauseCustomItems || displayItems).map((i) => i.id);
          if (batchPauseAction === 'pause') {
            pauseAllDownloads(targetIds);
          } else if (batchPauseAction === 'resume') {
            resumeAllDownloads(targetIds);
          } else if (batchPauseAction === 'queue') {
            if (batchPauseCustomItems && batchPauseCustomItems.length === 1) {
              queueDownload(batchPauseCustomItems[0].id);
            } else {
              queueAllDownloads(targetIds);
            }
          } else if (batchPauseAction === 'start_queue') {
            startQueue();
          }
          setBatchPauseAction(null);
          setBatchPauseCustomItems(null);
        }}
      />

      {/* Destination Folder Change & Retry Modal */}
      <FolderChangeModal
        isOpen={retryingFolderItem !== null}
        initialPath={(() => {
          const full = retryingFolderItem?.destination_path || '';
          const idx = Math.max(full.lastIndexOf('\\'), full.lastIndexOf('/'));
          return idx > 0 ? full.slice(0, idx) : full;
        })()}
        onClose={() => setRetryingFolderItem(null)}
        onSelect={async (newFolder) => {
          if (retryingFolderItem) {
            await changeFolderAndRetry(retryingFolderItem.id, newFolder);
            setRetryingFolderItem(null);
          }
        }}
        title="CHANGE DESTINATION & RETRY"
        subtitle="FIX WRITE PERMISSIONS"
      />

      {/* Auto-Shutdown Confirmation Modal */}
      <AutoShutdownConfirmModal
        isOpen={shutdownConfirmItem !== null}
        item={shutdownConfirmItem}
        onClose={() => setShutdownConfirmItem(null)}
        onConfirm={(taskId) => {
          handleToggleShutdown(taskId);
          setShutdownConfirmItem(null);
        }}
      />
    </div>
  );
};
