import React, { useEffect, useState } from 'react';
import {
  Activity,
  HardDrive,
  Zap,
  FolderOpen,
  Database,
  ArrowLeft,
  Cpu,
  CheckCircle2,
  TrendingUp,
  ShieldCheck,
  Layers,
  RefreshCw,
  ChevronDown
} from 'lucide-react';
import { useDownloadStore } from '../stores/downloadStore';
import {
  getDefaultDownloadDir,
  openFolderPicker,
  setDefaultDownloadDir,
  getDiskFreeSpace,
  getAvailableDisks,
  DiskVolumeInfo,
  openExternalUrl
} from '../services/tauriService';
import { formatBytes } from '../utils/format';
import { AnimatedNumber, AnimatedBytes, AnimatedSpeed } from './AnimatedDigits';

let cachedFreeSpace: number | null = (() => {
  try {
    const val = localStorage.getItem('downex_cached_free_space');
    return val ? Number(val) : null;
  } catch {
    return null;
  }
})();

interface TelemetryViewProps {
  onBack?: () => void;
}

export const TelemetryView: React.FC<TelemetryViewProps> = ({ onBack }) => {
  const setSelectedView = useDownloadStore((state) => state.setSelectedView);
  const telemetryEpoch = useDownloadStore((state) => state.telemetryEpoch);
  const totalSpeed = useDownloadStore((state) => state.totalSpeed);
  const peakSpeed = useDownloadStore((state) => state.peakSpeed);
  const lifetimeDownloadedBytes = useDownloadStore((state) => state.lifetimeDownloadedBytes);
  const sessionDownloadedBytes = useDownloadStore((state) => state.sessionDownloadedBytes);
  const items = useDownloadStore((state) => state.items);

  const [storagePath, setStoragePath] = useState<string>('Downloads\\Downex');
  const [freeSpaceBytes, setFreeSpaceBytes] = useState<number | null>(() => cachedFreeSpace);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [storageProgress, setStorageProgress] = useState<number>(0);

  // Dynamic available disks & user-selectable drive volume
  const [availableDisks, setAvailableDisks] = useState<DiskVolumeInfo[]>([
    { letter: 'C', path: 'C:\\', free_bytes: cachedFreeSpace ?? 70 * 1024 * 1024 * 1024, total_bytes: 256 * 1024 * 1024 * 1024, is_default: true }
  ]);
  const [selectedDiskLetter, setSelectedDiskLetter] = useState<string>('C');
  const [diskAnimKey, setDiskAnimKey] = useState<number>(0);
  const [volumesDropdownOpen, setVolumesDropdownOpen] = useState<boolean>(false);
  const [storageDropdownOpen, setStorageDropdownOpen] = useState<boolean>(false);

  // Close dropdowns on outside click or window click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.disk-dropdown-container')) {
        setVolumesDropdownOpen(false);
        setStorageDropdownOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Re-trigger counter animations whenever tab is clicked, opened, or re-selected
  useEffect(() => {
    setRefreshKey((k) => k + 1);
    setDiskAnimKey((k) => k + 1);
  }, [telemetryEpoch]);

  useEffect(() => {
    const onRetrigger = () => {
      setRefreshKey((k) => k + 1);
      setDiskAnimKey((k) => k + 1);
    };
    window.addEventListener('downex-retrigger-telemetry', onRetrigger);
    return () => window.removeEventListener('downex-retrigger-telemetry', onRetrigger);
  }, []);

  const fetchStorageData = async () => {
    try {
      const dir = await getDefaultDownloadDir();
      let activeLetter = selectedDiskLetter;
      if (dir) {
        setStoragePath(dir);
        const match = dir.match(/^([A-Za-z]):/);
        if (match) {
          activeLetter = match[1].toUpperCase();
          setSelectedDiskLetter(activeLetter);
        }
      }

      const disks = await getAvailableDisks();
      if (disks && disks.length > 0) {
        setAvailableDisks(disks);
        const matchDisk = disks.find(d => d.letter.toUpperCase() === activeLetter.toUpperCase()) || disks[0];
        if (matchDisk) {
          cachedFreeSpace = matchDisk.free_bytes;
          setFreeSpaceBytes(matchDisk.free_bytes);
          try {
            localStorage.setItem('downex_cached_free_space', String(matchDisk.free_bytes));
          } catch { }
          if (matchDisk.total_bytes > 0) {
            const used = Math.max(0, matchDisk.total_bytes - matchDisk.free_bytes);
            setStorageProgress(Math.min(100, Math.max(5, (used / matchDisk.total_bytes) * 100)));
          }
        }
      }
    } catch { }
  };

  useEffect(() => {
    fetchStorageData();
  }, []);

  const handleSelectDisk = (diskLetter: string) => {
    const upper = diskLetter.toUpperCase();
    setSelectedDiskLetter(upper);
    setDiskAnimKey((k) => k + 1);

    const targetDisk = availableDisks.find((d) => d.letter.toUpperCase() === upper);
    if (targetDisk) {
      setFreeSpaceBytes(targetDisk.free_bytes);
      if (targetDisk.total_bytes > 0) {
        const used = Math.max(0, targetDisk.total_bytes - targetDisk.free_bytes);
        setStorageProgress(Math.min(100, Math.max(5, (used / targetDisk.total_bytes) * 100)));
      }
    }
  };

  const handlePickFolder = async () => {
    try {
      const picked = await openFolderPicker();
      if (picked) {
        const saved = await setDefaultDownloadDir(picked);
        setStoragePath(saved);
        const match = saved.match(/^([A-Za-z]):/);
        if (match) {
          handleSelectDisk(match[1]);
        }
        try {
          const space = await getDiskFreeSpace(saved);
          if (space && space > 0) setFreeSpaceBytes(space);
        } catch { }
      }
    } catch (err) {
      console.warn('Failed to pick folder:', err);
    }
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    setRefreshKey((k) => k + 1);
    setDiskAnimKey((k) => k + 1);
    await fetchStorageData();
    setTimeout(() => setIsRefreshing(false), 400);
  };

  const activeDownloads = items.filter((i) => i.status === 'downloading' || i.status === 'probing');
  const completedDownloads = items.filter((i) => i.status === 'completed');
  const queuedDownloads = items.filter((i) => i.status === 'queued');
  const pausedDownloads = items.filter((i) => i.status === 'paused' || i.status === 'failed' || i.status === 'error');
  const activeSegmentsCount = activeDownloads.reduce((acc, curr) => acc + (curr.segments?.length || 1), 0);

  // Dynamic Library storage volume stats
  const totalManagedBytes = items.reduce((acc, curr) => acc + (curr.total_bytes || curr.downloaded_bytes || 0), 0);
  const completedBytes = completedDownloads.reduce((acc, curr) => acc + (curr.total_bytes || curr.downloaded_bytes || 0), 0);
  const pendingBytes = Math.max(0, totalManagedBytes - completedBytes);
  const resumableCount = items.filter((i) => i.supports_ranges !== false).length;

  const currentDisk = availableDisks.find((d) => d.letter.toUpperCase() === selectedDiskLetter.toUpperCase());
  const currentDiskFreeBytes = currentDisk?.free_bytes ?? freeSpaceBytes ?? cachedFreeSpace ?? 0;

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 select-none">
      {/* 1. Header Bar (Precision Industrial Symmetrical Aesthetic) */}
      <div className="h-10 px-3.5 sm:px-4 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 shrink-0 z-20">
        {/* Left: Back Navigation + Identity */}
        <div className="flex items-center gap-2 min-w-0 flex-1 mr-3">
          <button
            type="button"
            onClick={() => {
              if (onBack) onBack();
              else setSelectedView('all');
            }}
            className="w-6.5 h-6.5 inline-flex items-center justify-center border border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-100 hover:border-zinc-400 dark:hover:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 transition-colors cursor-pointer shrink-0"
            title="Return to Downloads"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>

          <div className="w-6.5 h-6.5 inline-flex items-center justify-center border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
            <Cpu className="w-3.5 h-3.5 stroke-[2.2]" />
          </div>

          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex items-center gap-1.5 flex-nowrap">
              <h1 className="font-mono-tabular text-[12px] font-bold uppercase tracking-wider text-zinc-900 dark:text-zinc-100 whitespace-nowrap leading-none shrink-0">
                Live Speed &amp; System Details
              </h1>
              <span className="hidden xl:inline-flex border border-emerald-500/40 bg-emerald-500/[0.04] text-emerald-600 dark:text-emerald-400 px-1.5 h-[16px] items-center text-[8.5px] font-mono-tabular font-semibold uppercase tracking-wider whitespace-nowrap shrink-0 leading-none">
                LIVE METRICS
              </span>
            </div>
            <p className="font-mono-tabular text-[9.5px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wider truncate whitespace-nowrap mt-0.5 leading-none">
              Real-time speed, active tasks &amp; storage
            </p>
          </div>
        </div>

        {/* Right: Telemetry Status + Refresh Action */}
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          <span className="h-6.5 inline-flex items-center gap-1.5 px-2 border border-emerald-500/40 bg-emerald-500/[0.04] text-emerald-600 dark:text-emerald-400 text-[9px] font-mono-tabular font-semibold uppercase tracking-wider whitespace-nowrap shrink-0 select-none">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span>ENGINE ACTIVE</span>
          </span>

          <button
            type="button"
            onClick={handleManualRefresh}
            className="w-6.5 h-6.5 inline-flex items-center justify-center border border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-100 hover:border-zinc-400 dark:hover:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 transition-colors cursor-pointer shrink-0"
            title="Refresh Sensors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 2. Main Content Dashboard (Single View, No Vertical Scroll, Zero Dead Space) */}
      <div className="flex-1 flex flex-col justify-between p-2.5 sm:p-3 max-w-6xl mx-auto w-full min-h-0 overflow-hidden">
        <div className="flex-1 flex flex-col justify-between gap-2.5 min-h-0">
          {/* ROW 1 & 2: 4 Primary Hardware Sensor Cards (Balanced 2x2 Grid, Zero Horizontal Truncation) */}
          <div className="grid grid-cols-2 gap-2.5 shrink-0">
            {/* Card 1: Live Speed & Throughput */}
            <div
              data-testid="telemetry-card-speed"
              onClick={handleManualRefresh}
              className="p-2.5 sm:p-3 border border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col justify-between hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors cursor-pointer select-none group min-w-0"
              title="Click to refresh speed sensor"
            >
              <div className="min-w-0">
                <div className="flex items-center justify-between text-zinc-400 dark:text-zinc-500 text-[10px] font-mono-tabular uppercase tracking-wider font-semibold gap-1">
                  <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300 truncate">
                    <Activity className="w-3.5 h-3.5 text-emerald-500 group-hover:scale-110 transition-transform shrink-0" />
                    <span className="truncate">CURRENT SPEED</span>
                  </span>
                  <span className="text-[8.5px] font-mono-tabular text-emerald-600 dark:text-emerald-400 uppercase shrink-0 font-semibold">
                    THROUGHPUT
                  </span>
                </div>
                <div className="mt-1.5 text-xl sm:text-2xl font-bold font-mono-tabular text-zinc-900 dark:text-zinc-100 tracking-tight leading-none truncate">
                  <AnimatedSpeed key={`speed-${refreshKey}`} triggerKey={refreshKey} bytesPerSec={totalSpeed} />
                </div>
              </div>

              <div className="mt-2 pt-1.5 border-t border-zinc-200/60 dark:border-zinc-800/60 flex items-center justify-between text-[9.5px] font-mono-tabular text-zinc-500 dark:text-zinc-400 min-w-0">
                <span className="flex items-center gap-1 text-zinc-400 dark:text-zinc-500 shrink-0">
                  <TrendingUp className="w-3 h-3 text-emerald-500 shrink-0" />
                  <span>PEAK SESSION</span>
                </span>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200 truncate ml-1 text-right">
                  <AnimatedSpeed key={`peak-${refreshKey}`} triggerKey={refreshKey} bytesPerSec={peakSpeed} />
                </span>
              </div>
            </div>

            {/* Card 2: Active Sockets & Parallel Workers */}
            <div
              data-testid="telemetry-card-parts"
              onClick={handleManualRefresh}
              className="p-2.5 sm:p-3 border border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col justify-between hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors cursor-pointer select-none group min-w-0"
              title="Click to refresh connection counters"
            >
              <div className="min-w-0">
                <div className="flex items-center justify-between text-zinc-400 dark:text-zinc-500 text-[10px] font-mono-tabular uppercase tracking-wider font-semibold gap-1">
                  <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300 truncate">
                    <Zap className="w-3.5 h-3.5 text-blue-500 group-hover:scale-110 transition-transform shrink-0" />
                    <span className="truncate">ACTIVE CONNECTIONS</span>
                  </span>
                  <span className="text-[8.5px] font-mono-tabular text-blue-600 dark:text-blue-400 uppercase shrink-0 font-semibold">
                    PARALLEL
                  </span>
                </div>
                <div className="mt-1.5 text-xl sm:text-2xl font-bold font-mono-tabular text-zinc-900 dark:text-zinc-100 tracking-tight leading-none truncate">
                  <AnimatedNumber key={`parts-${refreshKey}`} triggerKey={refreshKey} value={activeSegmentsCount} suffix=" Parts" />
                </div>
              </div>

              <div className="mt-2 pt-1.5 border-t border-zinc-200/60 dark:border-zinc-800/60 flex items-center justify-between text-[9.5px] font-mono-tabular text-zinc-500 dark:text-zinc-400 min-w-0">
                <span className="flex items-center gap-1 text-zinc-400 dark:text-zinc-500 shrink-0">
                  <Layers className="w-3 h-3 text-blue-500 shrink-0" />
                  <span>ACTIVE TASKS</span>
                </span>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200 truncate ml-1 text-right">
                  <AnimatedNumber key={`tasks-${refreshKey}`} triggerKey={refreshKey} value={activeDownloads.length} /> RUNNING
                </span>
              </div>
            </div>

            {/* Card 3: Storage Target & Free Disk Space */}
            <div
              data-testid="telemetry-card-storage"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('button')) return;
                handleManualRefresh();
              }}
              className="p-2.5 sm:p-3 border border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col justify-between hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors cursor-pointer select-none group min-w-0"
              title="Click to re-probe disk space"
            >
              <div className="min-w-0">
                <div className="flex items-center justify-between text-zinc-400 dark:text-zinc-500 text-[10px] font-mono-tabular uppercase tracking-wider font-semibold gap-1">
                  <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300 truncate">
                    <HardDrive className="w-3.5 h-3.5 text-amber-500 group-hover:scale-110 transition-transform shrink-0" />
                    <span className="truncate">SAVE FOLDER</span>
                  </span>
                  <button
                    type="button"
                    onClick={handlePickFolder}
                    className="text-[8.5px] font-mono-tabular text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1 cursor-pointer font-semibold uppercase tracking-wider border border-blue-500/30 px-1.5 py-0.5 shrink-0"
                  >
                    <FolderOpen className="w-2.5 h-2.5" /> CHANGE
                  </button>
                </div>
                <div className="mt-1.5 text-[11px] font-mono-tabular font-medium text-zinc-800 dark:text-zinc-200 truncate leading-none" title={storagePath}>
                  {storagePath}
                </div>
              </div>

              <div className="mt-2 space-y-1 min-w-0">
                <div className="h-1 w-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-1000 ease-out"
                    style={{ width: `${storageProgress}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[9.5px] font-mono-tabular text-zinc-400 dark:text-zinc-500 min-w-0">
                  <span className="flex items-center gap-0.5 truncate mr-1">
                    <AnimatedBytes
                      key={`free-${selectedDiskLetter}-${diskAnimKey}`}
                      triggerKey={diskAnimKey}
                      duration={1800}
                      easing="gentle"
                      bytes={currentDiskFreeBytes}
                      suffix=" FREE DISK"
                    />
                  </span>
                  <div className="relative disk-dropdown-container inline-flex items-center shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setStorageDropdownOpen((prev) => !prev);
                      }}
                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[8.5px] font-mono-tabular font-bold border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors cursor-pointer select-none"
                      title="Click to select drive"
                    >
                      <span>{selectedDiskLetter}:</span>
                      <ChevronDown className={`w-2.5 h-2.5 transition-transform duration-200 ${storageDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {storageDropdownOpen && (
                      <div className="absolute right-0 top-full mt-1 z-30 min-w-[130px] p-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-lg text-[10px] font-mono-tabular">
                        {availableDisks.map((disk) => {
                          const isSelected = selectedDiskLetter.toUpperCase() === disk.letter.toUpperCase();
                          return (
                            <button
                              key={disk.letter}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectDisk(disk.letter);
                                setStorageDropdownOpen(false);
                              }}
                              className={`w-full flex items-center justify-between px-2 py-1 text-left transition-colors cursor-pointer ${
                                isSelected
                                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold'
                                  : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                              }`}
                            >
                              <div className="flex items-center gap-1.5">
                                <HardDrive className="w-3 h-3 text-zinc-400 shrink-0" />
                                <span>{disk.letter}:\</span>
                              </div>
                              <span className="text-[9px] text-zinc-400 ml-2 whitespace-nowrap">
                                {formatBytes(disk.free_bytes)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Card 4: Total Downloaded Data (Persistent SQLite Metric) */}
            <div
              data-testid="telemetry-card-lifetime"
              onClick={handleManualRefresh}
              className="p-2.5 sm:p-3 border border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col justify-between hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors cursor-pointer select-none group min-w-0"
              title="Click to re-animate lifetime telemetry"
            >
              <div className="min-w-0">
                <div className="flex items-center justify-between text-zinc-400 dark:text-zinc-500 text-[10px] font-mono-tabular uppercase tracking-wider font-semibold gap-1">
                  <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300 truncate">
                    <Database className="w-3.5 h-3.5 text-violet-500 group-hover:scale-110 transition-transform shrink-0" />
                    <span className="truncate">TOTAL DATA DOWNLOADED</span>
                  </span>
                  <span className="text-[8.5px] font-mono-tabular text-violet-600 dark:text-violet-400 uppercase shrink-0 font-semibold">
                    LIFETIME
                  </span>
                </div>
                <div className="mt-1.5 text-xl sm:text-2xl font-bold font-mono-tabular text-zinc-900 dark:text-zinc-100 tracking-tight leading-none truncate" title={`${lifetimeDownloadedBytes.toLocaleString()} bytes`}>
                  <AnimatedBytes key={`lifetime-${refreshKey}`} triggerKey={refreshKey} bytes={lifetimeDownloadedBytes} />
                </div>
              </div>

              <div className="mt-2 pt-1.5 border-t border-zinc-200/60 dark:border-zinc-800/60 flex items-center justify-between text-[9.5px] font-mono-tabular text-zinc-500 dark:text-zinc-400 min-w-0">
                <span className="flex items-center gap-1 text-zinc-400 dark:text-zinc-500 shrink-0">
                  <ShieldCheck className="w-3 h-3 text-emerald-500 shrink-0" />
                  <span>SAVED LOCALLY</span>
                </span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400 truncate ml-1 text-right">
                  <AnimatedBytes key={`session-${refreshKey}`} triggerKey={refreshKey} bytes={sessionDownloadedBytes} prefix="+" suffix=" session" />
                </span>
              </div>
            </div>
          </div>

          {/* ROW 3: Download & Transfer Statistics (3 Detailed Columns, Flex-1 Natural Expansion) */}
          <div className="grid grid-cols-3 gap-2.5 flex-1 min-h-0">
            {/* Card 1: Download Tasks Breakdown */}
            <div className="p-2.5 sm:p-3 border border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col justify-between min-h-0">
              <div className="flex items-center justify-between pb-1.5 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <h3 className="text-[10px] font-bold font-mono-tabular uppercase tracking-wider text-zinc-800 dark:text-zinc-200 truncate">
                    DOWNLOAD TASKS
                  </h3>
                </div>
                <span className="text-[8.5px] font-mono-tabular text-zinc-400 uppercase font-semibold shrink-0">
                  LIFECYCLE
                </span>
              </div>
              <div className="flex-1 flex flex-col justify-between text-[9.5px] sm:text-[10px] font-mono-tabular py-1 min-h-0">
                <div className="flex items-center justify-between py-1 border-b border-zinc-200/40 dark:border-zinc-800/40 gap-1.5 whitespace-nowrap">
                  <span className="text-zinc-500 dark:text-zinc-400 uppercase whitespace-nowrap shrink-0">TOTAL TASKS</span>
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200 text-right whitespace-nowrap shrink-0">
                    <AnimatedNumber key={`total-${refreshKey}`} value={items.length} />
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-zinc-200/40 dark:border-zinc-800/40 gap-1.5 whitespace-nowrap">
                  <span className="text-zinc-500 dark:text-zinc-400 uppercase whitespace-nowrap shrink-0">COMPLETED</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400 text-right whitespace-nowrap shrink-0">
                    <AnimatedNumber key={`completed-${refreshKey}`} value={completedDownloads.length} />
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-zinc-200/40 dark:border-zinc-800/40 gap-1.5 whitespace-nowrap">
                  <span className="text-zinc-500 dark:text-zinc-400 uppercase whitespace-nowrap shrink-0">IN QUEUE</span>
                  <span className="font-semibold text-blue-600 dark:text-blue-400 text-right whitespace-nowrap shrink-0">
                    <AnimatedNumber key={`queued-${refreshKey}`} value={queuedDownloads.length} />
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-zinc-200/40 dark:border-zinc-800/40 gap-1.5 whitespace-nowrap">
                  <span className="text-zinc-500 dark:text-zinc-400 uppercase whitespace-nowrap shrink-0">DOWNLOADING</span>
                  <span className="font-bold text-zinc-900 dark:text-zinc-100 text-right whitespace-nowrap shrink-0">
                    <AnimatedNumber key={`active-${refreshKey}`} value={activeDownloads.length} />
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 gap-1.5 whitespace-nowrap">
                  <span className="text-zinc-500 dark:text-zinc-400 uppercase whitespace-nowrap shrink-0">PAUSED / IDLE</span>
                  <span className="font-semibold text-amber-600 dark:text-amber-400 text-right whitespace-nowrap shrink-0">
                    <AnimatedNumber key={`paused-${refreshKey}`} value={pausedDownloads.length} />
                  </span>
                </div>
              </div>
            </div>

            {/* Card 2: Library Storage Volume */}
            <div className="p-2.5 sm:p-3 border border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col justify-between min-h-0">
              <div className="flex items-center justify-between pb-1.5 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Database className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                  <h3 className="text-[10px] font-bold font-mono-tabular uppercase tracking-wider text-zinc-800 dark:text-zinc-200 truncate">
                    STORAGE VOLUMES
                  </h3>
                </div>
                <span className="text-[8.5px] font-mono-tabular text-violet-600 dark:text-violet-400 uppercase font-semibold shrink-0">
                  PAYLOAD
                </span>
              </div>
              <div className="flex-1 flex flex-col justify-between text-[9.5px] sm:text-[10px] font-mono-tabular py-1 min-h-0">
                <div className="flex items-center justify-between py-1 border-b border-zinc-200/40 dark:border-zinc-800/40 gap-1.5 whitespace-nowrap">
                  <span className="text-zinc-500 dark:text-zinc-400 uppercase whitespace-nowrap shrink-0">TOTAL MANAGED</span>
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200 text-right whitespace-nowrap shrink-0">
                    <AnimatedBytes key={`managed-${refreshKey}`} triggerKey={refreshKey} bytes={totalManagedBytes} />
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-zinc-200/40 dark:border-zinc-800/40 gap-1.5 whitespace-nowrap">
                  <span className="text-zinc-500 dark:text-zinc-400 uppercase whitespace-nowrap shrink-0">COMPLETED</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400 text-right whitespace-nowrap shrink-0">
                    <AnimatedBytes key={`compbytes-${refreshKey}`} triggerKey={refreshKey} bytes={completedBytes} />
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-zinc-200/40 dark:border-zinc-800/40 gap-1.5 whitespace-nowrap">
                  <span className="text-zinc-500 dark:text-zinc-400 uppercase whitespace-nowrap shrink-0">REMAINING</span>
                  <span className="font-semibold text-blue-600 dark:text-blue-400 text-right whitespace-nowrap shrink-0">
                    <AnimatedBytes key={`pendbytes-${refreshKey}`} triggerKey={refreshKey} bytes={pendingBytes} />
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-zinc-200/40 dark:border-zinc-800/40 gap-1.5 whitespace-nowrap">
                  <span className="text-zinc-500 dark:text-zinc-400 uppercase whitespace-nowrap shrink-0">RESUMABLE</span>
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200 text-right whitespace-nowrap shrink-0">
                    <AnimatedNumber key={`resumable-${refreshKey}`} value={resumableCount} /> / {items.length}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 gap-1.5 whitespace-nowrap">
                  <div className="flex items-center gap-1 uppercase whitespace-nowrap shrink-0">
                    <span className="text-zinc-500 dark:text-zinc-400">FREE DISK</span>
                    {availableDisks.length > 0 && (
                      <div className="relative disk-dropdown-container inline-flex items-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setVolumesDropdownOpen((prev) => !prev);
                          }}
                          className="inline-flex items-center gap-0.5 px-1 py-0.2 text-[8px] font-mono-tabular font-bold border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors cursor-pointer select-none"
                          title="Click to select drive"
                        >
                          <span>{selectedDiskLetter}:</span>
                          <ChevronDown className={`w-2.5 h-2.5 transition-transform duration-200 ${volumesDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {volumesDropdownOpen && (
                          <div className="absolute left-0 bottom-full mb-1 z-30 min-w-[130px] p-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-lg text-[10px] font-mono-tabular">
                            {availableDisks.map((disk) => {
                              const isSelected = selectedDiskLetter.toUpperCase() === disk.letter.toUpperCase();
                              return (
                                <button
                                  key={disk.letter}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSelectDisk(disk.letter);
                                    setVolumesDropdownOpen(false);
                                  }}
                                  className={`w-full flex items-center justify-between px-2 py-1 text-left transition-colors cursor-pointer ${
                                    isSelected
                                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold'
                                      : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                                  }`}
                                >
                                  <div className="flex items-center gap-1.5">
                                    <HardDrive className="w-3 h-3 text-zinc-400 shrink-0" />
                                    <span>{disk.letter}:\</span>
                                  </div>
                                  <span className="text-[9px] text-zinc-400 ml-2 whitespace-nowrap">
                                    {formatBytes(disk.free_bytes)}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400 text-right whitespace-nowrap shrink-0">
                    <AnimatedBytes
                      key={`freevol-${selectedDiskLetter}-${diskAnimKey}`}
                      triggerKey={diskAnimKey}
                      duration={1800}
                      easing="gentle"
                      bytes={currentDiskFreeBytes}
                    />
                  </span>
                </div>
              </div>
            </div>

            {/* Card 3: Session Transfer Rates & Network */}
            <div className="p-2.5 sm:p-3 border border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col justify-between min-h-0">
              <div className="flex items-center justify-between pb-1.5 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <TrendingUp className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  <h3 className="text-[10px] font-bold font-mono-tabular uppercase tracking-wider text-zinc-800 dark:text-zinc-200 truncate">
                    BANDWIDTH &amp; RATES
                  </h3>
                </div>
                <span className="text-[8.5px] font-mono-tabular text-blue-600 dark:text-blue-400 uppercase font-semibold shrink-0">
                  NETWORK
                </span>
              </div>
              <div className="flex-1 flex flex-col justify-between text-[9.5px] sm:text-[10px] font-mono-tabular py-1 min-h-0">
                <div className="flex items-center justify-between py-1 border-b border-zinc-200/40 dark:border-zinc-800/40 gap-1.5 whitespace-nowrap">
                  <span className="text-zinc-500 dark:text-zinc-400 uppercase whitespace-nowrap shrink-0">LIVE SPEED</span>
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200 text-right whitespace-nowrap shrink-0">
                    <AnimatedSpeed key={`bwcurr-${refreshKey}`} triggerKey={refreshKey} bytesPerSec={totalSpeed} />
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-zinc-200/40 dark:border-zinc-800/40 gap-1.5 whitespace-nowrap">
                  <span className="text-zinc-500 dark:text-zinc-400 uppercase whitespace-nowrap shrink-0">PEAK SPEED</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400 text-right whitespace-nowrap shrink-0">
                    <AnimatedSpeed key={`bwpeak-${refreshKey}`} triggerKey={refreshKey} bytesPerSec={peakSpeed} />
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-zinc-200/40 dark:border-zinc-800/40 gap-1.5 whitespace-nowrap">
                  <span className="text-zinc-500 dark:text-zinc-400 uppercase whitespace-nowrap shrink-0">SESSION DATA</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400 text-right whitespace-nowrap shrink-0">
                    <AnimatedBytes key={`bwsess-${refreshKey}`} triggerKey={refreshKey} bytes={sessionDownloadedBytes} prefix="+" />
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-zinc-200/40 dark:border-zinc-800/40 gap-1.5 whitespace-nowrap">
                  <span className="text-zinc-500 dark:text-zinc-400 uppercase whitespace-nowrap shrink-0">ACTIVE STREAMS</span>
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200 text-right whitespace-nowrap shrink-0">
                    <AnimatedNumber key={`bwstreams-${refreshKey}`} value={activeSegmentsCount} />
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 gap-1.5 whitespace-nowrap">
                  <span className="text-zinc-500 dark:text-zinc-400 uppercase whitespace-nowrap shrink-0">LIFETIME TOTAL</span>
                  <span className="font-bold text-zinc-900 dark:text-zinc-100 text-right whitespace-nowrap shrink-0">
                    <AnimatedBytes key={`bwlife-${refreshKey}`} triggerKey={refreshKey} bytes={lifetimeDownloadedBytes} />
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Minimal Footer (Pinned to bottom, zero empty space below, exact symmetric spacing above and below Terms • Privacy Policy, centered matching Settings) */}
        <div
          data-testid="telemetry-footer"
          className="mt-2.5 pt-2 pb-1 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-center gap-2 text-[10px] leading-none shrink-0 text-zinc-400 dark:text-zinc-500"
        >
          <button
            type="button"
            onClick={() => openExternalUrl('https://downex.apps.gauravpatil.site/terms#terms')}
            className="hover:underline cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors leading-none py-0 my-0 inline-flex items-center"
          >
            Terms
          </button>
          <span className="leading-none select-none inline-flex items-center">&bull;</span>
          <button
            type="button"
            onClick={() => openExternalUrl('https://downex.apps.gauravpatil.site/privacy#privacy')}
            className="hover:underline cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors leading-none py-0 my-0 inline-flex items-center"
          >
            Privacy Policy
          </button>
        </div>
      </div>
    </div>
  );
};
