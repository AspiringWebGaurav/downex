import React, { useState, useEffect } from 'react';
import { updateService } from '../services/updateService';
import { injectMockDownloadItem, clearMockDownloads } from '../services/tauriService';
import { useDownloadStore } from '../stores/downloadStore';
import { DownloadItem } from '../types/download';
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
  Sparkles
} from 'lucide-react';

export const DevUpdateSimulator: React.FC = () => {
  // Only render in dev or browser preview mode
  const isDev = Boolean((import.meta as any).env?.DEV || typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__);
  const [isOpen, setIsOpen] = useState(false);
  const [isLiveTickerActive, setIsLiveTickerActive] = useState(true);

  // Live Speed Limiter Simulation Loop (Ticks every 500ms for active mock downloads)
  useEffect(() => {
    if (!isDev || !isLiveTickerActive) return;

    const interval = setInterval(() => {
      const items = useDownloadStore.getState().items;
      const hasActiveMock = items.some(
        (i) => i.id.startsWith('mock-') && i.status === 'downloading'
      );
      if (!hasActiveMock) return;

      useDownloadStore.setState((state) => {
        let changed = false;
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
            // Realistic micro-jitter ±1.5% around the cap
            effectiveRate = cappedRate * (0.985 + Math.random() * 0.03);
          } else {
            // Natural line speed with subtle ±2% network wave
            effectiveRate = naturalBase * (0.98 + Math.random() * 0.04);
          }

          const addedBytes = Math.round(effectiveRate * 0.5);
          const newDownloaded = Math.min(total, item.downloaded_bytes + addedBytes);
          const isComplete = newDownloaded >= total;

          const remainingBytes = Math.max(0, total - newDownloaded);
          const etaSec = isComplete
            ? 0
            : Math.max(1, Math.round(remainingBytes / Math.max(1, effectiveRate)));

          // Update active segments for realistic animation in IDM details
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

        return changed ? { items: newItems } : state;
      });
    }, 500);

    return () => clearInterval(interval);
  }, [isDev, isLiveTickerActive]);

  if (!isDev) {
    return null;
  }

  // --- Start Mock Active Downloads ---
  const startSpeedTestDownload = (planMbps: 30 | 100 | 200 | 500) => {
    const plans = {
      30: {
        filename: 'driver-pack-2026.zip',
        total: 1258291200, // 1.2 GB
        downloaded: 314572800, // 25%
        speedBps: 3625000, // ~29 Mbps -> snaps to 30 Mbps tier
        eta: 260,
      },
      100: {
        filename: 'ubuntu-24.04-desktop-amd64.iso',
        total: 4800000000, // 4.8 GB
        downloaded: 1200000000, // 25%
        speedBps: 12250000, // ~98 Mbps -> snaps to 100 Mbps tier
        eta: 293,
      },
      200: {
        filename: 'large-dataset-v2.tar.gz',
        total: 10485760000, // 10.5 GB
        downloaded: 3460300800, // 33%
        speedBps: 24500000, // ~196 Mbps -> snaps to 200 Mbps tier
        eta: 286,
      },
      500: {
        filename: 'enterprise-backup-image.vhdx',
        total: 26214400000, // 25 GB
        downloaded: 10485760000, // 40%
        speedBps: 61250000, // ~490 Mbps -> snaps to 500 Mbps tier
        eta: 256,
      },
    };

    const cfg = plans[planMbps];
    const segmentCount = 8;
    const chunkSize = Math.floor(cfg.total / segmentCount);
    const mockSegments = Array.from({ length: segmentCount }, (_, idx) => {
      const start = idx * chunkSize;
      const end = idx === segmentCount - 1 ? cfg.total - 1 : (idx + 1) * chunkSize - 1;
      const segDownloaded = Math.floor((cfg.downloaded / segmentCount));
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
      destination_path: `C:\\Users\\gaura\\Downloads\\Downex\\${cfg.filename}`,
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
    }));
  };

  // Start fresh download from 0% with active ticker
  const startFreshDownloadFromZero = () => {
    const total = 3221225472; // 3.0 GB
    const speed = 12500000; // ~100 Mbps
    const activeMock: DownloadItem = {
      id: 'mock-active-' + Date.now(),
      url: 'https://cdn.example.org/fresh-download-sample.zip',
      filename: 'fresh-download-sample.zip',
      destination_path: 'C:\\Users\\gaura\\Downloads\\Downex\\fresh-download-sample.zip',
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
    }));
  };

  const addCompletedMock = () => {
    const completedMock: DownloadItem = {
      id: 'mock-completed-' + Date.now(),
      url: 'https://gphost.eu.cc/raw/downex-desktop',
      filename: 'Downex-0.0.0-Setup.exe',
      destination_path: 'C:\\Users\\gaura\\Downloads\\Downex\\Downex-0.0.0-Setup.exe',
      total_bytes: 3562767,
      downloaded_bytes: 3562767,
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
      items: [completedMock, ...prev.items.filter((i) => i.filename !== 'Downex-0.0.0-Setup.exe')],
      selectedView: 'all',
    }));
  };

  const clearMocks = () => {
    clearMockDownloads();
    useDownloadStore.setState({ items: [] });
  };

  const openPrefilledModal = () => {
    useDownloadStore.getState().openNewModalWithData({
      url: 'https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso',
      filename: 'ubuntu-24.04-desktop-amd64.iso',
      total_bytes: 6144000000,
      supports_ranges: true,
    });
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 select-none font-sans flex flex-col items-center">
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-900/90 dark:bg-white/90 text-white dark:text-zinc-900 text-xs font-medium shadow-lg backdrop-blur-md hover:scale-105 active:scale-95 transition-all cursor-pointer border border-zinc-700/50 dark:border-zinc-200/50"
          title="Open Dev QA Simulator & Download Tester"
        >
          <FlaskConical className="w-3.5 h-3.5 text-emerald-400 dark:text-emerald-600 animate-pulse" />
          <span>Dev QA & Download Tester</span>
          <ChevronUp className="w-3.5 h-3.5 opacity-60" />
        </button>
      ) : (
        <div className="w-[340px] rounded-2xl bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border border-zinc-200/80 dark:border-zinc-800/80 p-4 shadow-2xl flex flex-col gap-3 text-zinc-900 dark:text-zinc-100 animate-in fade-in slide-in-from-bottom-2 duration-150 max-h-[85vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center gap-1.5">
              <FlaskConical className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-xs font-bold tracking-tight">Dev QA & Download Tester</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              title="Close panel"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>

          {/* Section 1: Start Active Downloads (Live Streaming) */}
          <div className="flex flex-col gap-2 p-2.5 rounded-xl bg-emerald-500/[0.06] dark:bg-emerald-950/20 border border-emerald-500/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 text-[10.5px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                <Play className="w-3 h-3 fill-current" />
                <span>Start Active Downloads (Live):</span>
              </div>
              <button
                type="button"
                onClick={() => setIsLiveTickerActive(!isLiveTickerActive)}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-mono font-semibold transition-colors cursor-pointer ${
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

            {/* Direct Start Download Buttons */}
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => startSpeedTestDownload(100)}
                className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold shadow-xs transition-colors cursor-pointer"
                title="Start active live download running at ~100 Mbps (snaps to 100 Mbps tier for 50%/80% tests)"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>▶ Start 100 Mbps</span>
              </button>

              <button
                onClick={startFreshDownloadFromZero}
                className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-[11px] font-semibold shadow-xs transition-colors cursor-pointer"
                title="Start a fresh live download starting at 0% (watch it progress from 0 bytes!)"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>▶ Start Fresh (0%)</span>
              </button>

              <button
                onClick={() => startSpeedTestDownload(200)}
                className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white text-[11px] font-medium transition-colors cursor-pointer"
                title="Start active download running at 200 Mbps (snaps to 200 Mbps tier)"
              >
                <Zap className="w-3 h-3 text-emerald-400" />
                <span>200 Mbps Plan</span>
              </button>

              <button
                onClick={() => startSpeedTestDownload(500)}
                className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white text-[11px] font-medium transition-colors cursor-pointer"
                title="Start active Gigabit download running at 500 Mbps"
              >
                <Zap className="w-3 h-3 text-indigo-400" />
                <span>500 Mbps Fiber</span>
              </button>
            </div>

            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 px-0.5 leading-tight">
              💡 <strong>Tip:</strong> Click any Start button above to see the download row with the inline Speed Limiter. Click <strong>20M, 50M, 100M</strong> or enter <strong>Custom Mbps</strong> to test live throttling.
            </p>
          </div>

          {/* Section 2: Download Modals & Dialogs */}
          <div className="flex flex-col gap-1.5">
            <div className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider px-1">
              Test New Download Modals:
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={openPrefilledModal}
                className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-[11px] font-medium transition-colors cursor-pointer"
                title="Open New Download modal pre-populated with an Ubuntu ISO (test the 'Download' button inside the modal)"
              >
                <FileDown className="w-3.5 h-3.5 text-emerald-500" />
                <span>Prefilled Modal</span>
              </button>

              <button
                onClick={() => useDownloadStore.getState().setNewModalOpen(true)}
                className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-[11px] font-medium transition-colors cursor-pointer"
                title="Open empty New Download modal to paste a custom URL"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Enter Custom URL</span>
              </button>
            </div>
          </div>

          {/* Section 3: Manage Downloads Table */}
          <div className="flex flex-col gap-1.5 pt-1 border-t border-zinc-100 dark:border-zinc-800">
            <div className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider px-1">
              Manage Table:
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={addCompletedMock}
                className="flex items-center justify-center gap-1 px-1.5 py-1.5 rounded-lg bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-800/60 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200/80 dark:border-zinc-700/80 text-[11px] font-medium transition-colors cursor-pointer"
                title="Add a completed download item to test completed card state"
              >
                <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>Add Completed</span>
              </button>

              <button
                onClick={clearMocks}
                className="flex items-center justify-center gap-1 px-1.5 py-1.5 rounded-lg bg-zinc-50 hover:bg-rose-50 dark:bg-zinc-800/60 dark:hover:bg-rose-950/40 text-zinc-600 hover:text-rose-600 dark:text-zinc-400 dark:hover:text-rose-400 border border-zinc-200/80 dark:border-zinc-700/80 text-[11px] font-medium transition-colors cursor-pointer"
                title="Clear all downloads from the table"
              >
                <Trash2 className="w-3 h-3 shrink-0" />
                <span>Clear All</span>
              </button>
            </div>
          </div>

          {/* Section 4: OTA Update Flow Simulator */}
          <div className="flex flex-col gap-1.5 pt-1 border-t border-zinc-100 dark:border-zinc-800">
            <div className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider px-1">
              OTA Update Flow Tester:
            </div>

            <button
              onClick={() => updateService.simulateUpdate('auto')}
              className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-black dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 text-xs font-medium shadow-xs transition-colors cursor-pointer"
              title="Simulate autonomous background update check, download, verification, and ready state"
            >
              <div className="flex items-center gap-1.5">
                <Play className="w-3 h-3 fill-current" />
                <span>Run Full OTA Flow</span>
              </div>
              <span className="text-[10px] opacity-75 font-mono">Auto</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
