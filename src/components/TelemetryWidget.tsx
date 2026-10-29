import React, { useEffect, useState } from 'react';
import { Activity, HardDrive, Zap, FolderOpen, Database } from 'lucide-react';
import { useDownloadStore } from '../stores/downloadStore';
import { getDefaultDownloadDir, openFolderPicker, setDefaultDownloadDir } from '../services/tauriService';
import { formatBytes, formatSpeed } from '../utils/format';

interface TelemetryWidgetProps {
  layout?: 'sidebar' | 'embedded';
}

export const TelemetryWidget: React.FC<TelemetryWidgetProps> = ({ layout = 'sidebar' }) => {
  const totalSpeed = useDownloadStore((state) => state.totalSpeed);
  const speedHistory = useDownloadStore((state) => state.speedHistory);
  const items = useDownloadStore((state) => state.items);
  const lifetimeDownloadedBytes = useDownloadStore((state) => state.lifetimeDownloadedBytes);
  const sessionDownloadedBytes = useDownloadStore((state) => state.sessionDownloadedBytes);
  const [storagePath, setStoragePath] = useState<string>('Downloads\\Downex');

  useEffect(() => {
    getDefaultDownloadDir()
      .then((dir) => {
        if (dir) setStoragePath(dir);
      })
      .catch(() => {});
  }, []);

  const handlePickFolder = async () => {
    try {
      const picked = await openFolderPicker();
      if (picked) {
        const saved = await setDefaultDownloadDir(picked);
        setStoragePath(saved);
      }
    } catch (err) {
      console.warn('Failed to pick folder:', err);
    }
  };

  const activeDownloads = items.filter((i) => i.status === 'downloading');
  const activeSegmentsCount = activeDownloads.reduce((acc, curr) => acc + (curr.segments?.length || 1), 0);

  // Generate SVG sparkline path
  const maxSpeed = Math.max(...speedHistory, 1024 * 1024 * 10); // at least 10MB scale
  const points = speedHistory
    .map((val, idx) => {
      const x = (idx / (speedHistory.length - 1)) * 140;
      const y = 35 - (val / maxSpeed) * 30;
      return `${x},${y}`;
    })
    .join(' ');

  if (layout === 'embedded') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Card 1: Live Speed & Throughput */}
        <div className="p-3.5 rounded-xl bg-zinc-50/80 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/60 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-zinc-400 dark:text-zinc-500 mb-1">
              <span className="text-[10px] font-mono uppercase tracking-wider font-semibold">Download Speed</span>
              <Activity className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100">
              {formatSpeed(totalSpeed)}
            </div>
          </div>

          <div className="mt-3 h-10 w-full bg-white dark:bg-zinc-950/80 rounded border border-zinc-200/50 dark:border-zinc-800/50 overflow-hidden relative">
            <svg className="w-full h-full" viewBox="0 0 140 35" preserveAspectRatio="none">
              <polyline
                fill="none"
                stroke="#10b981"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={points}
              />
            </svg>
          </div>
        </div>

        {/* Card 2: Active Sockets & Parallel Workers */}
        <div className="p-3.5 rounded-xl bg-zinc-50/80 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/60 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-zinc-400 dark:text-zinc-500 mb-1">
              <span className="text-[10px] font-mono uppercase tracking-wider font-semibold">Active Connections</span>
              <Zap className="w-4 h-4 text-blue-500" />
            </div>
            <div className="text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100">
              {activeSegmentsCount} Active Parts
            </div>
          </div>
          <div className="text-xs font-mono text-zinc-500 dark:text-zinc-400 mt-2">
            Multi-part download acceleration active
          </div>
        </div>

        {/* Card 3: Dynamic Storage Target */}
        <div className="p-3.5 rounded-xl bg-zinc-50/80 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/60 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-zinc-400 dark:text-zinc-500 mb-1">
              <span className="text-[10px] font-mono uppercase tracking-wider font-semibold">Storage Target</span>
              <HardDrive className="w-4 h-4 text-zinc-400" />
            </div>
            <div className="text-xs font-mono font-medium text-zinc-800 dark:text-zinc-200 truncate" title={storagePath}>
              {storagePath}
            </div>
          </div>

          <div className="mt-2 space-y-1">
            <div className="h-1.5 w-full bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: '42%' }} />
            </div>
            <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
              <span>Drive Available</span>
              <button
                type="button"
                onClick={handlePickFolder}
                className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <FolderOpen className="w-3 h-3" /> Change
              </button>
            </div>
          </div>
        </div>

        {/* Card 4: Total Downloaded Data Till Now (Persistent SQLite Metric) */}
        <div className="p-3.5 rounded-xl bg-zinc-50/80 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/60 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-zinc-400 dark:text-zinc-500 mb-1">
              <span className="text-[10px] font-mono uppercase tracking-wider font-semibold">Total Data Downloaded</span>
              <Database className="w-4 h-4 text-violet-500" />
            </div>
            <div className="text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100">
              {formatBytes(lifetimeDownloadedBytes)}
            </div>
          </div>

          <div className="mt-2 pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60 flex items-center justify-between text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Saved Locally
            </span>
            <span title="Downloaded during this session">
              +{formatBytes(sessionDownloadedBytes)} session
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-56 h-full flex flex-col gap-3 p-3 select-none bg-zinc-50/50 dark:bg-zinc-900/30 border-l border-zinc-200/80 dark:border-zinc-800/60 shrink-0">
      {/* Live Speed Card */}
      <div className="p-3 rounded-xl bg-white dark:bg-zinc-900/70 border border-zinc-200/80 dark:border-zinc-800/60 shadow-xs">
        <div className="flex items-center justify-between text-zinc-400 dark:text-zinc-500 mb-1">
          <span className="text-[10px] font-mono uppercase tracking-wider">Download Speed</span>
          <Activity className="w-3.5 h-3.5 text-emerald-500" />
        </div>
        <div className="text-lg font-bold font-mono text-zinc-900 dark:text-zinc-100">
          {formatSpeed(totalSpeed)}
        </div>

        {/* Sparkline */}
        <div className="mt-2 h-9 w-full bg-zinc-50 dark:bg-zinc-950/60 rounded border border-zinc-200/50 dark:border-zinc-800/50 overflow-hidden relative">
          <svg className="w-full h-full" viewBox="0 0 140 35" preserveAspectRatio="none">
            <polyline
              fill="none"
              stroke="#10b981"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={points}
            />
          </svg>
        </div>
      </div>

      {/* Connection & Disk Telemetry */}
      <div className="p-3 rounded-xl bg-white dark:bg-zinc-900/70 border border-zinc-200/80 dark:border-zinc-800/60 shadow-xs space-y-2.5">
        <div>
          <div className="flex items-center justify-between text-zinc-400 dark:text-zinc-500 mb-1">
            <span className="text-[10px] font-mono uppercase tracking-wider">Active Sockets</span>
            <Zap className="w-3.5 h-3.5 text-blue-500" />
          </div>
          <div className="text-sm font-semibold font-mono text-zinc-900 dark:text-zinc-100">
            {activeSegmentsCount} Parallel Workers
          </div>
        </div>

        <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/60">
          <div className="flex items-center justify-between text-zinc-400 dark:text-zinc-500 mb-1">
            <span className="text-[10px] font-mono uppercase tracking-wider">Storage Target</span>
            <HardDrive className="w-3.5 h-3.5 text-zinc-400" />
          </div>
          <div className="text-xs font-mono font-medium text-zinc-700 dark:text-zinc-300 truncate" title={storagePath}>
            {storagePath}
          </div>
          <div className="mt-1 h-1.5 w-full bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full" style={{ width: '42%' }} />
          </div>
          <div className="mt-1 flex justify-between text-[10px] font-mono text-zinc-400">
            <span>Drive Available</span>
            <button
              type="button"
              onClick={handlePickFolder}
              className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
            >
              <FolderOpen className="w-3 h-3" /> Change
            </button>
          </div>
        </div>
      </div>

      {/* Card 4 (Sidebar): Lifetime Data Transferred */}
      <div className="p-3 rounded-xl bg-white dark:bg-zinc-900/70 border border-zinc-200/80 dark:border-zinc-800/60 shadow-xs">
        <div className="flex items-center justify-between text-zinc-400 dark:text-zinc-500 mb-1">
          <span className="text-[10px] font-mono uppercase tracking-wider">Total Downloaded</span>
          <Database className="w-3.5 h-3.5 text-violet-500" />
        </div>
        <div className="text-base font-bold font-mono text-zinc-900 dark:text-zinc-100">
          {formatBytes(lifetimeDownloadedBytes)}
        </div>
        <div className="text-[10px] font-mono text-zinc-400 mt-1 flex items-center justify-between">
          <span>Lifetime transfer</span>
          <span className="text-emerald-600 dark:text-emerald-400 font-medium">SQLite</span>
        </div>
      </div>
    </div>
  );
};
