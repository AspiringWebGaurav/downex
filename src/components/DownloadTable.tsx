import React, { useState, useRef } from 'react';
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
  HelpCircle, 
  Plus, 
  Search,
  SearchX,
  RotateCcw,
  X,
  Menu,
  Copy,
  Check
} from 'lucide-react';
import { useDownloadStore } from '../stores/downloadStore';
import { openFolderPicker, openFile, openFileFolder, showDownloadCompleteDialog, isTauri, injectMockDownloadItem } from '../services/tauriService';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { DownloadItem } from '../types/download';

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
  const startQueue = useDownloadStore((state) => state.startQueue);
  const pauseQueue = useDownloadStore((state) => state.pauseQueue);
  const queueDownload = useDownloadStore((state) => state.queueDownload);
  const setQueueGuideOpen = useDownloadStore((state) => state.setQueueGuideOpen);
  const setNewModalOpen = useDownloadStore((state) => state.setNewModalOpen);

  const [expandedItemIds, setExpandedItemIds] = useState<Record<string, boolean>>({});
  const [showAllSegmentsMap, setShowAllSegmentsMap] = useState<Record<string, boolean>>({});
  const [deletingItem, setDeletingItem] = useState<DownloadItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const persistentSpeedRef = useRef<Record<string, number>>({});
  const smoothedSpeedRef = useRef<Record<string, number>>({});
  const persistentEtaRef = useRef<Record<string, number>>({});
  const smoothedEtaRef = useRef<Record<string, { eta: number; lastUpdated: number }>>({});

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
      return item.status === 'downloading' || item.status === 'probing';
    }
    if (selectedView === 'completed') {
      return item.status === 'completed';
    }
    if (selectedView === 'queues') {
      return item.status === 'queued' || item.status === 'downloading' || item.status === 'probing';
    }
    if (selectedView === 'trash') {
      return item.status === 'failed' || item.status === 'cancelled' || item.status === 'error';
    }
    return true;
  });

  if (isQueuesView) {
    const active = displayItems.filter((i) => i.status === 'downloading' || i.status === 'probing');
    const queued = displayItems
      .filter((i) => i.status === 'queued')
      .sort((a, b) => a.created_at - b.created_at);
    displayItems = [...active, ...queued];
  }

  const formatBytes = (bytes?: number | null) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatSpeed = (bytesPerSec: number) => {
    if (!bytesPerSec || bytesPerSec <= 0) return '0 B/s (0 Mbps)';
    const mbps = Math.round((bytesPerSec * 8) / 1_000_000);
    return `${formatBytes(bytesPerSec)}/s (${mbps} Mbps)`;
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

  const renderQueueBanner = () => (
    <div className="p-3.5 rounded-xl bg-gradient-to-r from-zinc-50 to-zinc-100/80 dark:from-zinc-900/90 dark:to-zinc-900/50 border border-zinc-200/90 dark:border-zinc-800 shadow-xs flex flex-wrap items-center justify-between gap-3 mb-1">
      <div className="flex items-center gap-3">
        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
            isQueueRunning
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
              : 'bg-zinc-200/70 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-300/50 dark:border-zinc-700/50'
          }`}
        >
          <ListOrdered className="w-5 h-5 stroke-[2]" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Simple 1-by-1 Queue
            </h3>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                isQueueRunning
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-semibold'
                  : 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isQueueRunning ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400'
                }`}
              />
              {isQueueRunning ? 'Queue Active' : 'Queue Paused'}
            </span>
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
            {isQueueRunning
              ? activeItems.length > 0
                ? `Downloading 1 file at maximum speed. ${queuedItems.length} file(s) waiting in line.`
                : `Queue is active and listening for queued tasks.`
              : queuedItems.length > 0
              ? `${queuedItems.length} file(s) in line. Click Start to download 1-by-1 sequentially.`
              : `Queue is empty. Click "+ New Download" and select "Download Later" to enqueue.`}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setQueueGuideOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300/80 dark:border-emerald-800 transition-colors cursor-pointer shadow-2xs"
          title="Learn how 1-by-1 Queue works and how to add downloads"
        >
          <HelpCircle className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>How it works?</span>
        </button>

        {isQueueRunning ? (
          <Button
            variant="warning"
            size="sm"
            icon={<Pause className="w-3.5 h-3.5 fill-current" />}
            onClick={pauseQueue}
          >
            Pause Queue
          </Button>
        ) : (
          <Button
            variant="primary-emerald"
            size="sm"
            icon={<Play className="w-3.5 h-3.5 fill-current" />}
            disabled={queuedItems.length === 0 && activeItems.length === 0}
            onClick={startQueue}
          >
            Start Queue (1 by 1)
          </Button>
        )}
      </div>
    </div>
  );

  if (displayItems.length === 0) {
    if (isSearchActive) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center select-none max-w-lg mx-auto w-full my-auto animate-in fade-in duration-200">
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

    return (
      <div className="flex-1 flex flex-col p-4">
        {isQueuesView && renderQueueBanner()}
        {isQueuesView ? (
          <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 select-none max-w-xl mx-auto w-full space-y-4 my-auto">
            <div className="text-center space-y-1">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 dark:bg-emerald-500/20 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-2 shadow-2xs">
                <ListOrdered className="w-5 h-5 stroke-[2.5]" />
              </div>
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                How 1-by-1 Queue Works
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Downloads run one after another at maximum speed without slowing down your internet.
              </p>
            </div>

            {/* 3 Step Cards */}
            <div className="w-full grid grid-cols-1 gap-2.5 text-left">
              <div className="p-3 rounded-xl bg-zinc-50/80 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 flex items-start gap-3 shadow-2xs">
                <div className="w-6 h-6 rounded-full bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 flex items-center justify-center text-xs font-bold shrink-0">
                  1
                </div>
                <div>
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 block">
                    Add any file and click "Later"
                  </span>
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400 block mt-0.5">
                    Click <strong>+ New Download</strong> (Ctrl+N), enter your URL, and click <strong>Later</strong> (🕒) instead of starting immediately.
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-zinc-50/80 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 flex items-start gap-3 shadow-2xs">
                <div className="w-6 h-6 rounded-full bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 flex items-center justify-center text-xs font-bold shrink-0">
                  2
                </div>
                <div>
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 block">
                    Files line up in sequence
                  </span>
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400 block mt-0.5">
                    Your queued downloads appear here in line, ready to download sequentially without competing for bandwidth.
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800/60 flex items-start gap-3 shadow-2xs">
                <div className="w-6 h-6 rounded-full bg-emerald-600 text-white dark:bg-emerald-500 dark:text-zinc-900 flex items-center justify-center text-xs font-bold shrink-0">
                  3
                </div>
                <div>
                  <span className="text-xs font-semibold text-emerald-950 dark:text-emerald-200 block">
                    Click "Start Queue (1 by 1)"
                  </span>
                  <span className="text-[11px] text-emerald-800/90 dark:text-emerald-300/90 block mt-0.5">
                    File #1 downloads at full 32-stream speed. As soon as it reaches 100%, file #2 starts automatically until all are complete.
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
              <Button
                variant="primary-emerald"
                size="md"
                icon={<Plus className="w-3.5 h-3.5 stroke-[2.5]" />}
                onClick={() => setNewModalOpen(true)}
              >
                Add Download to Queue
              </Button>

              <button
                type="button"
                onClick={() => setQueueGuideOpen(true)}
                className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline px-2.5 py-1.5 cursor-pointer"
              >
                How Queues Work →
              </button>
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

        {!isTauri && selectedView !== 'queues' && (
          <button
              onClick={() => {
                const sample: DownloadItem = {
                  id: 'mock-completed-setup',
                  url: 'https://gphost.eu.cc/raw/downex-desktop',
                  filename: 'Downex-0.0.0-Setup.exe',
                  destination_path: 'C:\\Users\\namit\\Downloads\\Downex\\Downex-0.0.0-Setup.exe',
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
              <span>Load Sample Completed Download (Downex-0.0.0-Setup.exe)</span>
            </button>
          )}
        </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2.5">
      {isQueuesView && renderQueueBanner()}
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
      {displayItems.map((item) => {
        const percent =
          item.total_bytes && item.total_bytes > 0
            ? Math.min(100, Math.round((item.downloaded_bytes / item.total_bytes) * 100))
            : 0;

        const isDownloading = item.status === 'downloading' || item.status === 'probing';
        const isPaused = item.status === 'paused';
        const isQueued = item.status === 'queued';
        const isExpanded = !!expandedItemIds[item.id];

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
        const remainingBytes = item.total_bytes && item.total_bytes > item.downloaded_bytes
          ? item.total_bytes - item.downloaded_bytes
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

        // Calculate queue position if in queue or if queues view
        let queueBadgeText = '';
        if (isQueuesView) {
          if (isDownloading) {
            queueBadgeText = '#1 • Active';
          } else if (isQueued) {
            const queuedIdx = queuedItems.findIndex((q) => q.id === item.id);
            const pos = activeItems.length + (queuedIdx >= 0 ? queuedIdx + 1 : 1);
            queueBadgeText = pos === 1 ? '#1 • Next in Line' : `#${pos} • In Line`;
          }
        }

        return (
          <div
            key={item.id}
            className="p-3.5 rounded-xl bg-white dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/60 shadow-xs hover:border-zinc-300 dark:hover:border-zinc-700 transition-all flex flex-col gap-2.5"
          >
            {/* Top row: Filename, Status Badge, Actions */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-zinc-100/90 dark:bg-zinc-800/80 border border-zinc-200/60 dark:border-zinc-700/60 flex items-center justify-center text-zinc-700 dark:text-zinc-200 shrink-0 shadow-2xs">
                  <File className="w-4.5 h-4.5 stroke-[2]" />
                </div>
                <div className="min-w-0 flex flex-col justify-center">
                  <div className="flex items-center gap-2">
                    <h4 className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight leading-snug truncate">
                      {item.filename}
                    </h4>
                    {queueBadgeText && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 font-semibold shrink-0">
                        {queueBadgeText}
                      </span>
                    )}
                  </div>
                  {/* Highlighted Destination Path with Hamburger Icon & Explorer Action */}
                  <div className="flex items-center gap-1.5 mt-1 max-w-full">
                    <button
                      type="button"
                      onClick={() => openFileFolder(item.destination_path)}
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-zinc-100/90 dark:bg-zinc-800/90 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border border-zinc-200/90 dark:border-zinc-700/80 hover:border-emerald-300 dark:hover:border-emerald-800 text-zinc-700 hover:text-emerald-700 dark:text-zinc-200 dark:hover:text-emerald-300 text-[11px] font-mono font-medium transition-all cursor-pointer group shadow-2xs min-w-0 max-w-fit"
                      title="Click to open destination folder in Windows Explorer"
                    >
                      <Menu className="w-3 h-3 text-zinc-500 dark:text-zinc-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 shrink-0 stroke-[2.2]" />
                      <span className="truncate">
                        {item.destination_path}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(item.destination_path);
                        setCopiedId(item.id);
                        setTimeout(() => setCopiedId(null), 2000);
                      }}
                      className="p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors cursor-pointer shrink-0"
                      title="Copy destination path"
                    >
                      {copiedId === item.id ? (
                        <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400 stroke-[2.5]" />
                      ) : (
                        <Copy className="w-3 h-3 stroke-[2]" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Status and Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full uppercase tracking-wider ${
                    item.status === 'completed'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold'
                      : isDownloading
                      ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 animate-pulse font-semibold'
                      : isQueued
                      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold'
                      : isPaused
                      ? 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 font-semibold'
                      : item.status === 'failed'
                      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                      : 'bg-zinc-200/60 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                  }`}
                >
                  {item.status}
                </span>

                {/* Queue action if paused or failed */}
                {(item.status === 'paused' || item.status === 'failed') && (
                  <button
                    onClick={() => queueDownload(item.id)}
                    className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors cursor-pointer"
                    title="Add to 1-by-1 Queue"
                  >
                    <ListOrdered className="w-3.5 h-3.5" />
                  </button>
                )}

                {item.status !== 'completed' && (
                  <button
                    onClick={() => togglePause(item.id)}
                    className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer"
                    title={isDownloading ? 'Pause' : isQueued ? 'Start Now (Bypass Queue Wait)' : 'Resume'}
                  >
                    {isDownloading ? (
                      <Pause className="w-3.5 h-3.5 fill-current" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-current" />
                    )}
                  </button>
                )}

                <button
                  onClick={() => setDeletingItem(item)}
                  className="p-1.5 rounded-md hover:bg-rose-50 dark:hover:bg-rose-950/40 text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                  title="Delete download..."
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Error & Machine Location Recovery Bar */}
            {(item.status === 'error' || item.status === 'failed' || item.error_message) && (
              <div className="flex items-center justify-between p-2 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-[11px] text-rose-700 dark:text-rose-300">
                <div className="flex items-center gap-1.5 truncate pr-2">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                  <span className="truncate">{item.error_message || 'Download could not write to destination folder.'}</span>
                </div>
                <button
                  onClick={async () => {
                    const picked = await openFolderPicker();
                    if (picked) {
                      await changeFolderAndRetry(item.id, picked);
                    }
                  }}
                  className="px-2.5 py-1 rounded bg-rose-100 hover:bg-rose-200 dark:bg-rose-900/50 dark:hover:bg-rose-800/60 font-medium text-[10px] text-rose-800 dark:text-rose-200 transition-colors cursor-pointer shrink-0 flex items-center gap-1"
                >
                  <FolderEdit className="w-3 h-3" />
                  <span>Change Location & Retry</span>
                </button>
              </div>
            )}

            {/* Minimal Structured Metrics Grid */}
            <div className="rounded-lg bg-zinc-50/90 dark:bg-zinc-950/80 border border-zinc-200/90 dark:border-zinc-800/90 px-3.5 py-2.5 text-xs font-mono grid grid-cols-2 lg:grid-cols-[1fr_1.1fr_1.4fr_1fr] gap-x-4 gap-y-2 select-text shadow-2xs">
              {/* 1. File size */}
              <div className="flex items-center gap-1.5 overflow-hidden">
                <span className="text-zinc-400 dark:text-zinc-500 shrink-0 font-medium text-[11px] whitespace-nowrap">File size</span>
                <span className="font-semibold text-[13px] text-zinc-900 dark:text-zinc-100 truncate tracking-tight">
                  {formatBytes(item.total_bytes)}
                </span>
              </div>

              {/* 2. Downloaded */}
              <div className="flex items-center gap-1.5 overflow-hidden">
                <span className="text-zinc-400 dark:text-zinc-500 shrink-0 font-medium text-[11px] whitespace-nowrap">Downloaded</span>
                <span className="font-semibold text-[13px] text-zinc-900 dark:text-zinc-100 truncate tracking-tight">
                  {formatBytes(item.downloaded_bytes)} <span className="text-[11px] font-normal opacity-70">({percent}%)</span>
                </span>
              </div>

              {/* 3. Transfer rate (single line) */}
              <div className="flex items-center gap-1.5 overflow-hidden">
                <span className="text-zinc-400 dark:text-zinc-500 shrink-0 font-medium text-[11px] whitespace-nowrap">Transfer rate</span>
                <span className={`font-semibold text-[13px] truncate whitespace-nowrap tracking-tight ${isDownloading && effectiveSpeed > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500'}`}>
                  {isDownloading && effectiveSpeed > 0 ? formatSpeed(effectiveSpeed) : '0 B/s (0 Mbps)'}
                </span>
              </div>

              {/* 4. Time left */}
              <div className="flex items-center gap-1.5 overflow-hidden">
                <span className="text-zinc-400 dark:text-zinc-500 shrink-0 font-medium text-[11px] whitespace-nowrap">Time left</span>
                <span className="text-zinc-900 dark:text-zinc-100 text-[13px] truncate font-semibold tracking-tight">
                  {isDownloading
                    ? (formattedEta || 'Calculating...')
                    : isPaused
                    ? 'Paused'
                    : item.status === 'completed'
                    ? 'Done'
                    : isQueued
                    ? 'In Queue'
                    : 'Pending'}
                </span>
              </div>
            </div>

            {/* Main Progress Bar (Sleek Slim Height with Rich Multi-Layer Animations) */}
            <div className="w-full h-[15px] bg-zinc-200/90 dark:bg-zinc-800/90 rounded-sm p-[1px] shadow-[inset_0_1.5px_3px_rgba(0,0,0,0.22)] border border-zinc-300/80 dark:border-zinc-700/80 relative overflow-hidden flex items-center">
              <div
                className={`h-full rounded-xs transition-all duration-300 relative overflow-hidden ${
                  item.status === 'completed'
                    ? 'bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-400 shadow-sm'
                    : isDownloading
                    ? 'bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]'
                    : isPaused
                    ? 'bg-gradient-to-r from-amber-600 to-amber-500'
                    : item.status === 'failed'
                    ? 'bg-gradient-to-r from-rose-600 to-rose-500'
                    : 'bg-zinc-400 dark:bg-zinc-600'
                }`}
                style={{ width: `${Math.max(percent > 0 ? percent : isDownloading ? 2 : 0, 0)}%` }}
              >
                {/* Flowing animated barber-pole diagonal stripes */}
                {isDownloading && (
                  <div className="absolute inset-0 animate-stripes opacity-45 mix-blend-overlay pointer-events-none" />
                )}

                {/* Sweeping specular light shimmer beam */}
                {isDownloading && (
                  <div className="animate-shimmer pointer-events-none" />
                )}

                {/* Top gloss glass highlight */}
                <div className="absolute inset-x-0 top-0 h-[45%] bg-gradient-to-b from-white/35 to-transparent pointer-events-none" />

                {/* Bottom 3D bevel shadow */}
                <div className="absolute inset-x-0 bottom-0 h-[30%] bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />

                {/* Pulsing energetic leading-edge head at download boundary */}
                {isDownloading && percent > 0 && percent < 100 && (
                  <div className="absolute right-0 top-0 bottom-0 w-1.5 bg-white shadow-[0_0_8px_#ffffff,0_0_14px_#34d399] animate-pulse pointer-events-none" />
                )}
              </div>
            </div>

            {/* IDM Details Toggle Bar */}
            <div className="flex items-center justify-between pt-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => toggleDetails(item.id)}
                className="text-[11px] font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 flex items-center gap-1 cursor-pointer transition-colors"
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

              <div className="flex items-center gap-2 text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">
                {item.status === 'completed' && (
                  <div className="flex items-center gap-1 mr-1 text-zinc-600 dark:text-zinc-300">
                    <button
                      onClick={() => openFile(item.destination_path)}
                      className="px-2 py-0.5 rounded hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 transition-colors cursor-pointer flex items-center gap-1 text-[11px] font-sans font-medium"
                      title="Open with"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>Open with</span>
                    </button>
                    <button
                      onClick={() => openFileFolder(item.destination_path)}
                      className="px-2 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer flex items-center gap-1 text-[11px] font-sans font-medium"
                      title="Open destination folder"
                    >
                      <FolderOpen className="w-3 h-3" />
                      <span>Destination folder</span>
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
                      className="px-1.5 py-0.5 rounded text-[10px] font-sans font-medium bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 transition-colors cursor-pointer"
                      title="Show complete details dialog"
                    >
                      Details
                    </button>
                    <span className="text-zinc-300 dark:text-zinc-700 mx-0.5">•</span>
                  </div>
                )}

                <span className="flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-emerald-500" />
                  Resume: {item.total_bytes ? 'Yes' : 'Unknown'}
                </span>
                {item.segments && item.segments.length > 0 && (
                  <span>• {item.segments.length} Connection(s)</span>
                )}
              </div>
            </div>

            {/* IDM-Style Expanded Details Drawer (Image 2 Tribute) */}
            {isExpanded && (
              <div className="mt-1 pt-2.5 border-t border-zinc-100 dark:border-zinc-800/80 space-y-2.5 animate-in fade-in duration-150">
                {/* Start positions and download progress by connections visualizer */}
                <div>
                  <div className="flex items-center justify-between text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
                    <span>Start positions and download progress by connections</span>
                    <span>{item.segments ? `${item.segments.filter((s) => s.is_active).length} Active` : '0 Active'}</span>
                  </div>

                  {item.segments && item.segments.length > 0 ? (
                    <div className="h-4 w-full bg-zinc-100 dark:bg-zinc-800/90 rounded border border-zinc-200 dark:border-zinc-700/80 overflow-hidden flex gap-[2px] p-[2px]">
                      {item.segments.map((seg) => {
                        const segTotal = seg.end - seg.start;
                        const segPercent = segTotal > 0 ? Math.min(100, (seg.downloaded / segTotal) * 100) : 0;
                        return (
                          <div
                            key={seg.index}
                            className="h-full bg-zinc-200/80 dark:bg-zinc-700/50 rounded-xs overflow-hidden flex-1 relative group"
                            title={`Conn ${seg.index + 1}: ${Math.round(segPercent)}% (${formatBytes(seg.downloaded)} of ${formatBytes(segTotal)})`}
                          >
                            <div
                              className={`h-full transition-all duration-200 relative ${
                                segPercent >= 100
                                  ? 'bg-emerald-500'
                                  : seg.is_active
                                  ? 'bg-blue-500 animate-pulse'
                                  : 'bg-zinc-400 dark:bg-zinc-500'
                              }`}
                              style={{ width: `${segPercent}%` }}
                            >
                              {/* Red cursor tick marking active head of connection (IDM tribute) */}
                              {seg.is_active && segPercent < 100 && (
                                <div className="absolute right-0 top-0 bottom-0 w-[2px] bg-red-500 shadow-xs" />
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

                {/* Connections Table (N., Downloaded, Status Info) - Exact Image 2 Table Format */}
                {item.segments && item.segments.length > 0 && (() => {
                  const isShowAll = !!showAllSegmentsMap[item.id];
                  const displayedSegments = isShowAll ? item.segments : item.segments.slice(0, 4);
                  const hasMore = item.segments.length > 4;

                  return (
                    <div className="overflow-x-auto rounded-lg border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-950/40">
                      <table className="w-full text-left text-[11px] font-mono">
                        <thead className="bg-zinc-100/70 dark:bg-zinc-900/60 border-b border-zinc-200/80 dark:border-zinc-800/80 text-[10px] text-zinc-500 dark:text-zinc-400 uppercase font-semibold">
                          <tr>
                            <th className="py-1 px-3 w-12">N.</th>
                            <th className="py-1 px-3">Downloaded</th>
                            <th className="py-1 px-3">Range Span</th>
                            <th className="py-1 px-3">Connection Info</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                          {displayedSegments.map((seg) => (
                            <tr key={seg.index} className="hover:bg-zinc-100/40 dark:hover:bg-zinc-800/30">
                              <td className="py-1 px-3 font-semibold text-zinc-700 dark:text-zinc-300">{seg.index + 1}</td>
                              <td className="py-1 px-3 text-zinc-600 dark:text-zinc-400">{formatBytes(seg.downloaded)}</td>
                              <td className="py-1 px-3 text-[10px] text-zinc-400 dark:text-zinc-500">
                                {formatBytes(seg.start)} - {formatBytes(seg.end)}
                              </td>
                              <td className="py-1 px-3">
                                {seg.is_active ? (
                                  <span className="inline-flex items-center gap-2 text-blue-600 dark:text-blue-400 font-medium">
                                    <span className="relative flex h-3 w-3 items-center justify-center shrink-0">
                                      <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400/80 animate-ping pointer-events-none" />
                                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500 shadow-[0_0_4px_rgba(59,130,246,0.8)]" />
                                    </span>
                                    <span>Receiving data...</span>
                                  </span>
                                ) : seg.downloaded > 0 && seg.downloaded >= (seg.end - seg.start) ? (
                                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">Completed</span>
                                ) : (
                                  <span className="text-zinc-400 dark:text-zinc-500">Idle / Ready</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {hasMore && (
                        <div className="p-1.5 border-t border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-100/50 dark:bg-zinc-900/50 text-center">
                          <button
                            type="button"
                            onClick={() => toggleShowAllSegments(item.id)}
                            className="text-[11px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 inline-flex items-center gap-1.5 cursor-pointer py-0.5 px-2.5 rounded hover:bg-blue-500/10 transition-colors"
                          >
                            {isShowAll ? (
                              <>
                                <ChevronUp className="w-3.5 h-3.5" />
                                <span>Show first 4 connections only</span>
                              </>
                            ) : (
                              <>
                                <ChevronDown className="w-3.5 h-3.5" />
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
      {/* IDM Delete Confirmation & Device Wipe Modal */}
      <DeleteConfirmModal
        isOpen={!!deletingItem}
        item={deletingItem}
        onClose={() => setDeletingItem(null)}
        onConfirm={(id, deleteFromDisk) => {
          removeDownload(id, deleteFromDisk);
        }}
      />
    </div>
  );
};
