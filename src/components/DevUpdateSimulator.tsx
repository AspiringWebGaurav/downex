import React, { useState } from 'react';
import { updateService } from '../services/updateService';
import { injectMockDownloadItem, clearMockDownloads } from '../services/tauriService';
import { useDownloadStore } from '../stores/downloadStore';
import { DownloadItem } from '../types/download';
import { 
  FlaskConical, 
  Play, 
  CheckCircle, 
  CheckCircle2,
  ArrowDown, 
  RefreshCw, 
  X, 
  ChevronUp, 
  ChevronDown, 
  Plus, 
  Trash2
} from 'lucide-react';

export const DevUpdateSimulator: React.FC = () => {
  // Only render in dev or browser preview mode
  const isDev = Boolean((import.meta as any).env?.DEV || typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__);
  const [isOpen, setIsOpen] = useState(false);

  if (!isDev) {
    return null;
  }

  const addCompletedMock = () => {
    const completedMock: DownloadItem = {
      id: 'mock-completed-' + Date.now(),
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
    injectMockDownloadItem(completedMock);
    useDownloadStore.setState((prev) => ({
      items: [completedMock, ...prev.items.filter((i) => i.filename !== 'Downex-0.0.0-Setup.exe')],
      selectedView: 'all',
    }));
  };

  const addActiveMock = () => {
    const activeMock: DownloadItem = {
      id: 'mock-active-' + Date.now(),
      url: 'https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso',
      filename: 'ubuntu-24.04-desktop-amd64.iso',
      destination_path: 'C:\\Users\\namit\\Downloads\\Downex\\ubuntu-24.04-desktop-amd64.iso',
      total_bytes: 6144000000,
      downloaded_bytes: 2764800000,
      status: 'downloading',
      queue_id: 'default',
      speed_bytes_sec: 24500000,
      eta_seconds: 138,
      supports_ranges: true,
      created_at: Date.now() - 120000,
      updated_at: Date.now(),
      segments: [
        { index: 0, start: 0, end: 768000000, downloaded: 500000000, speed_bytes_sec: 3100000, is_active: true },
        { index: 1, start: 768000001, end: 1536000000, downloaded: 450000000, speed_bytes_sec: 3000000, is_active: true },
        { index: 2, start: 1536000001, end: 2304000000, downloaded: 420000000, speed_bytes_sec: 3200000, is_active: true },
        { index: 3, start: 2304000001, end: 3072000000, downloaded: 400000000, speed_bytes_sec: 3100000, is_active: true },
        { index: 4, start: 3072000001, end: 3840000000, downloaded: 350000000, speed_bytes_sec: 2900000, is_active: true },
        { index: 5, start: 384000001, end: 4608000000, downloaded: 300000000, speed_bytes_sec: 3000000, is_active: true },
        { index: 6, start: 4608000001, end: 5376000000, downloaded: 200000000, speed_bytes_sec: 3100000, is_active: true },
        { index: 7, start: 5376000001, end: 6144000000, downloaded: 144800000, speed_bytes_sec: 3100000, is_active: true },
      ],
    };
    injectMockDownloadItem(activeMock);
    useDownloadStore.setState((prev) => ({
      items: [activeMock, ...prev.items.filter((i) => i.filename !== 'ubuntu-24.04-desktop-amd64.iso')],
      selectedView: 'all',
    }));
  };

  const clearMocks = () => {
    clearMockDownloads();
    useDownloadStore.setState({ items: [] });
  };

  const triggerDownloadModal = () => {
    useDownloadStore.getState().openNewModalWithData({
      url: 'https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso',
      filename: 'ubuntu-24.04-desktop-amd64.iso',
      total_bytes: 6144000000,
      supports_ranges: true,
    });
  };

  return (
    <div className="fixed bottom-4 left-4 z-50 select-none font-sans">
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-900/90 dark:bg-white/90 text-white dark:text-zinc-900 text-xs font-medium shadow-lg backdrop-blur-md hover:scale-105 active:scale-95 transition-all cursor-pointer border border-zinc-700/50 dark:border-zinc-200/50"
          title="Interactive Dev Simulator & Mocks"
        >
          <FlaskConical className="w-3.5 h-3.5 text-emerald-400 dark:text-emerald-600 animate-pulse" />
          <span>Dev Mocks & Tester</span>
          <ChevronUp className="w-3 h-3 opacity-60" />
        </button>
      ) : (
        <div className="w-72 rounded-2xl bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border border-zinc-200/80 dark:border-zinc-800/80 p-3.5 shadow-2xl flex flex-col gap-2.5 text-zinc-900 dark:text-zinc-100 animate-in fade-in slide-in-from-bottom-2 duration-150 max-h-[85vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between pb-1.5 border-b border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center gap-1.5">
              <FlaskConical className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-xs font-semibold">Dev QA Simulator & Mocks</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Section 1: Download Mocks & Trigger Modal */}
          <div className="flex flex-col gap-1.5">
            <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider px-1">
              Download Mocks & Modal:
            </div>

            <button
              onClick={triggerDownloadModal}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium shadow-xs transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Trigger Download Modal</span>
              </div>
              <span className="text-[10px] opacity-80">Test Modal</span>
            </button>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={addCompletedMock}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/80 text-xs font-medium transition-colors cursor-pointer"
                title="Add Downex 0.0.0 Completed download card"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="truncate">+ Complete Mock</span>
              </button>

              <button
                onClick={addActiveMock}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/40 dark:hover:bg-sky-900/50 text-sky-700 dark:text-sky-300 border border-sky-200/80 dark:border-sky-800/80 text-xs font-medium transition-colors cursor-pointer"
                title="Add active in-progress downloading card"
              >
                <ArrowDown className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                <span className="truncate">+ Active Mock</span>
              </button>
            </div>

            <button
              onClick={clearMocks}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 text-[11px] font-medium transition-colors cursor-pointer"
              title="Clear all mock downloads from table"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear Downloads</span>
            </button>
          </div>

          {/* Section 2: OTA Update Flow Simulator */}
          <div className="flex flex-col gap-1.5 pt-1 border-t border-zinc-100 dark:border-zinc-800">
            <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider px-1">
              OTA Update Flow Tester:
            </div>

            <button
              onClick={() => updateService.simulateUpdate('auto')}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium shadow-xs transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-1.5">
                <Play className="w-3 h-3 fill-current" />
                <span>Run Full OTA Flow</span>
              </div>
              <span className="text-[10px] opacity-80">Auto</span>
            </button>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => updateService.simulateUpdate('available')}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-medium transition-colors cursor-pointer"
              >
                <ArrowDown className="w-3 h-3 text-emerald-500" />
                <span>1. Available</span>
              </button>

              <button
                onClick={() => updateService.simulateUpdate('downloading')}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-medium transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3 h-3 text-blue-500 animate-spin" />
                <span>2. In-Progress</span>
              </button>

              <button
                onClick={() => updateService.simulateUpdate('verifying')}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-medium transition-colors cursor-pointer"
              >
                <CheckCircle className="w-3 h-3 text-emerald-500" />
                <span>3. Verifying</span>
              </button>

              <button
                onClick={() => updateService.simulateUpdate('ready')}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-medium transition-colors cursor-pointer"
              >
                <CheckCircle className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                <span>4. Ready</span>
              </button>
            </div>

            <button
              onClick={() => updateService.simulateUpdate('idle')}
              className="mt-0.5 w-full flex items-center justify-center gap-1.5 px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 text-[11px] font-medium transition-colors cursor-pointer"
            >
              <X className="w-3 h-3" />
              <span>Reset & Close Update Modal</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
