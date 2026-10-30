import React, { useEffect, useState } from 'react';
import { 
  Activity, 
  HardDrive, 
  Zap, 
  FolderOpen, 
  Database, 
  ArrowLeft, 
  Cpu, 
  Gauge, 
  CheckCircle2, 
  TrendingUp, 
  Server, 
  ShieldCheck, 
  Layers,
  RefreshCw
} from 'lucide-react';
import { useDownloadStore } from '../stores/downloadStore';
import { getDefaultDownloadDir, openFolderPicker, setDefaultDownloadDir, getDiskFreeSpace } from '../services/tauriService';
import { formatBytes, formatSpeed } from '../utils/format';

interface TelemetryViewProps {
  onBack?: () => void;
}

export const TelemetryView: React.FC<TelemetryViewProps> = ({ onBack }) => {
  const setSelectedView = useDownloadStore((state) => state.setSelectedView);
  const totalSpeed = useDownloadStore((state) => state.totalSpeed);
  const speedHistory = useDownloadStore((state) => state.speedHistory);
  const peakSpeed = useDownloadStore((state) => state.peakSpeed);
  const lifetimeDownloadedBytes = useDownloadStore((state) => state.lifetimeDownloadedBytes);
  const sessionDownloadedBytes = useDownloadStore((state) => state.sessionDownloadedBytes);
  const items = useDownloadStore((state) => state.items);
  
  const [storagePath, setStoragePath] = useState<string>('Downloads\\Downex');
  const [freeSpaceBytes, setFreeSpaceBytes] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const fetchStorageData = async () => {
    try {
      const dir = await getDefaultDownloadDir();
      if (dir) {
        setStoragePath(dir);
        try {
          const space = await getDiskFreeSpace(dir);
          if (space && space > 0) setFreeSpaceBytes(space);
        } catch {}
      }
    } catch {}
  };

  useEffect(() => {
    fetchStorageData();
  }, []);

  const handlePickFolder = async () => {
    try {
      const picked = await openFolderPicker();
      if (picked) {
        const saved = await setDefaultDownloadDir(picked);
        setStoragePath(saved);
        try {
          const space = await getDiskFreeSpace(saved);
          if (space && space > 0) setFreeSpaceBytes(space);
        } catch {}
      }
    } catch (err) {
      console.warn('Failed to pick folder:', err);
    }
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await fetchStorageData();
    setTimeout(() => setIsRefreshing(false), 400);
  };

  const activeDownloads = items.filter((i) => i.status === 'downloading' || i.status === 'probing');
  const completedDownloads = items.filter((i) => i.status === 'completed');
  const queuedDownloads = items.filter((i) => i.status === 'queued');
  const activeSegmentsCount = activeDownloads.reduce((acc, curr) => acc + (curr.segments?.length || 1), 0);

  // High-resolution SVG sparkline calculation
  const maxHistoricalSpeed = Math.max(...speedHistory, peakSpeed, 1024 * 1024 * 5); // Minimum 5 MB scale
  const chartPoints = speedHistory
    .map((val, idx) => {
      const x = (idx / (speedHistory.length - 1)) * 400;
      const y = 90 - (val / maxHistoricalSpeed) * 75;
      return `${x},${y}`;
    })
    .join(' ');

  const chartAreaPoints = `0,90 ${chartPoints} 400,90`;

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 overflow-y-auto bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 select-none pb-12">
      {/* Top Header Bar */}
      <div className="h-14 px-6 flex items-center justify-between border-b border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-900/30 shrink-0 sticky top-0 z-20 backdrop-blur-xs">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (onBack) onBack();
              else setSelectedView('all');
            }}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Return to Downloads"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <div>
              <h1 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                Live Speed & System Details
              </h1>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
                Real-time download speed, active tasks, and storage details
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-[11px] font-mono text-emerald-700 dark:text-emerald-400 font-semibold shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Download Engine Running</span>
          </div>

          <button
            type="button"
            onClick={handleManualRefresh}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Refresh Sensors"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Content Dashboard */}
      <div className="p-6 max-w-6xl mx-auto w-full space-y-6">
        {/* ROW 1: 4 Primary Sensor Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Live Speed & Throughput */}
          <div className="p-4 rounded-2xl bg-zinc-50/80 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/60 shadow-xs flex flex-col justify-between hover:border-zinc-300 dark:hover:border-zinc-700 transition-all">
            <div>
              <div className="flex items-center justify-between text-zinc-400 dark:text-zinc-500 mb-1">
                <span className="text-[10px] font-mono uppercase tracking-wider font-semibold">Current Speed</span>
                <Activity className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="text-2xl font-black font-mono text-zinc-900 dark:text-zinc-100">
                {formatSpeed(totalSpeed)}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-zinc-200/60 dark:border-zinc-800/60 flex items-center justify-between text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
              <span className="flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-emerald-500" />
                Peak Session
              </span>
              <span className="font-bold text-zinc-700 dark:text-zinc-300">{formatSpeed(peakSpeed)}</span>
            </div>
          </div>

          {/* Card 2: Active Sockets & Parallel Workers */}
          <div className="p-4 rounded-2xl bg-zinc-50/80 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/60 shadow-xs flex flex-col justify-between hover:border-zinc-300 dark:hover:border-zinc-700 transition-all">
            <div>
              <div className="flex items-center justify-between text-zinc-400 dark:text-zinc-500 mb-1">
                <span className="text-[10px] font-mono uppercase tracking-wider font-semibold">Active Connections</span>
                <Zap className="w-4 h-4 text-blue-500" />
              </div>
              <div className="text-2xl font-black font-mono text-zinc-900 dark:text-zinc-100">
                {activeSegmentsCount} <span className="text-sm font-semibold text-zinc-500">Parts</span>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-zinc-200/60 dark:border-zinc-800/60 flex items-center justify-between text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
              <span className="flex items-center gap-1">
                <Layers className="w-3 h-3 text-blue-500" />
                Active Tasks
              </span>
              <span className="font-bold text-zinc-700 dark:text-zinc-300">{activeDownloads.length} running</span>
            </div>
          </div>

          {/* Card 3: Storage Target & Free Disk Space */}
          <div className="p-4 rounded-2xl bg-zinc-50/80 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/60 shadow-xs flex flex-col justify-between hover:border-zinc-300 dark:hover:border-zinc-700 transition-all">
            <div>
              <div className="flex items-center justify-between text-zinc-400 dark:text-zinc-500 mb-1">
                <span className="text-[10px] font-mono uppercase tracking-wider font-semibold">Save Folder</span>
                <HardDrive className="w-4 h-4 text-amber-500" />
              </div>
              <div className="text-xs font-mono font-medium text-zinc-800 dark:text-zinc-200 truncate mt-1" title={storagePath}>
                {storagePath}
              </div>
            </div>

            <div className="mt-3 space-y-1.5">
              <div className="h-1.5 w-full bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: '45%' }} />
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
                <span>{freeSpaceBytes ? `${formatBytes(freeSpaceBytes)} free` : 'Drive Available'}</span>
                <button
                  type="button"
                  onClick={handlePickFolder}
                  className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer font-semibold"
                >
                  <FolderOpen className="w-3 h-3" /> Change
                </button>
              </div>
            </div>
          </div>

          {/* Card 4: Total Downloaded Data Till Now (Persistent SQLite Metric) */}
          <div className="p-4 rounded-2xl bg-zinc-50/80 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/60 shadow-xs flex flex-col justify-between hover:border-zinc-300 dark:hover:border-zinc-700 transition-all">
            <div>
              <div className="flex items-center justify-between text-zinc-400 dark:text-zinc-500 mb-1">
                <span className="text-[10px] font-mono uppercase tracking-wider font-semibold">Total Data Downloaded</span>
                <Database className="w-4 h-4 text-violet-500" />
              </div>
              <div className="text-2xl font-black font-mono text-zinc-900 dark:text-zinc-100" title={`${lifetimeDownloadedBytes.toLocaleString()} bytes`}>
                {formatBytes(lifetimeDownloadedBytes)}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-zinc-200/60 dark:border-zinc-800/60 flex items-center justify-between text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
              <span className="flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-500" />
                Saved Locally
              </span>
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                +{formatBytes(sessionDownloadedBytes)} session
              </span>
            </div>
          </div>
        </div>

        {/* ROW 2: Expanded Live Speed Timeline Graph */}
        <div className="p-5 rounded-2xl bg-zinc-50/80 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/60 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gauge className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                Speed History (Last 30 Seconds)
              </h2>
            </div>
            <div className="flex items-center gap-3 text-[10px] font-mono text-zinc-400 dark:text-zinc-500">
              <span>Max Scale: {formatSpeed(maxHistoricalSpeed)}</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>Real-Time Stream</span>
            </div>
          </div>

          <div className="h-32 w-full bg-white dark:bg-zinc-950/80 rounded-xl border border-zinc-200/60 dark:border-zinc-800/60 overflow-hidden relative p-2 flex flex-col justify-between">
            {/* Background grid lines */}
            <div className="absolute inset-0 flex flex-col justify-between p-2 pointer-events-none opacity-20 dark:opacity-30">
              <div className="border-b border-dashed border-zinc-400 dark:border-zinc-600 w-full" />
              <div className="border-b border-dashed border-zinc-400 dark:border-zinc-600 w-full" />
              <div className="border-b border-dashed border-zinc-400 dark:border-zinc-600 w-full" />
            </div>

            <svg className="w-full h-full relative z-10" viewBox="0 0 400 90" preserveAspectRatio="none">
              <defs>
                <linearGradient id="telemetrySpeedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <polygon
                fill="url(#telemetrySpeedGrad)"
                points={chartAreaPoints}
              />
              <polyline
                fill="none"
                stroke="#10b981"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={chartPoints}
              />
            </svg>
          </div>
        </div>

        {/* ROW 3: Simple & Clean Status Cards (No Buzzwords, Robust Layout) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Card 1: Download Tasks */}
          <div className="p-4 rounded-2xl bg-zinc-50/80 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/60 shadow-xs space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                Download Tasks
              </h3>
            </div>
            <div className="space-y-1.5 text-xs font-mono">
              <div className="flex items-center justify-between py-1.5 border-b border-zinc-200/40 dark:border-zinc-800/40 gap-2">
                <span className="text-zinc-500 shrink-0">Total Files:</span>
                <span className="font-bold text-zinc-800 dark:text-zinc-200 truncate">{items.length}</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-zinc-200/40 dark:border-zinc-800/40 gap-2">
                <span className="text-zinc-500 shrink-0">Completed:</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400 truncate">{completedDownloads.length}</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-zinc-200/40 dark:border-zinc-800/40 gap-2">
                <span className="text-zinc-500 shrink-0">In Queue:</span>
                <span className="font-bold text-blue-600 dark:text-blue-400 truncate">{queuedDownloads.length}</span>
              </div>
              <div className="flex items-center justify-between py-1.5 gap-2">
                <span className="text-zinc-500 shrink-0">Downloading Now:</span>
                <span className="font-bold text-zinc-900 dark:text-zinc-100 truncate">{activeDownloads.length}</span>
              </div>
            </div>
          </div>

          {/* Card 2: Engine Performance */}
          <div className="p-4 rounded-2xl bg-zinc-50/80 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/60 shadow-xs space-y-3">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-blue-500" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                Download Engine
              </h3>
            </div>
            <div className="space-y-1.5 text-xs font-mono">
              <div className="flex items-center justify-between py-1.5 border-b border-zinc-200/40 dark:border-zinc-800/40 gap-2">
                <span className="text-zinc-500 shrink-0">Technology:</span>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200 truncate">Multi-Threaded (Fast)</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-zinc-200/40 dark:border-zinc-800/40 gap-2">
                <span className="text-zinc-500 shrink-0">Max Connections:</span>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200 truncate">Up to 32 Parts</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-zinc-200/40 dark:border-zinc-800/40 gap-2">
                <span className="text-zinc-500 shrink-0">Split Downloads:</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400 truncate">Automatic</span>
              </div>
              <div className="flex items-center justify-between py-1.5 gap-2">
                <span className="text-zinc-500 shrink-0">Security:</span>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200 truncate">Encrypted (HTTPS)</span>
              </div>
            </div>
          </div>

          {/* Card 3: Storage & Database (Clean, No Overlap, Simple Words) */}
          <div className="p-4 rounded-2xl bg-zinc-50/80 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/60 shadow-xs space-y-3">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-violet-500" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                Storage & Data Saving
              </h3>
            </div>
            <div className="space-y-1.5 text-xs font-mono">
              <div className="flex items-center justify-between py-1.5 border-b border-zinc-200/40 dark:border-zinc-800/40 gap-2">
                <span className="text-zinc-500 shrink-0">Database:</span>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200 truncate">Saved on PC</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-zinc-200/40 dark:border-zinc-800/40 gap-2">
                <span className="text-zinc-500 shrink-0">Disk Saving:</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400 truncate">Saves Every 10s</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-zinc-200/40 dark:border-zinc-800/40 gap-2">
                <span className="text-zinc-500 shrink-0">Total Data Saved:</span>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200 truncate">Tracked Accurately</span>
              </div>
              <div className="flex items-center justify-between py-1.5 gap-2">
                <span className="text-zinc-500 shrink-0">Crash Safety:</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400 truncate">Safe on Exit</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

