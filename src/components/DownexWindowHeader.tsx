import React from 'react';
import { X, Check, RefreshCw, Download, AlertTriangle } from 'lucide-react';
import { minimizeToBackground } from '../services/tauriService';
import { useAppVersionStore } from '../stores/appVersionStore';

export const DownexWindowHeader: React.FC = () => {
  const formattedVersion = useAppVersionStore((state) => state.formattedVersion);
  const status = useAppVersionStore((state) => state.status);
  const openModal = useAppVersionStore((state) => state.openModal);

  const handleClose = async () => {
    try {
      await minimizeToBackground();
    } catch (err) {
      console.error('Failed to minimize to background:', err);
    }
  };

  return (
    <div
      data-tauri-drag-region
      className="relative h-9 w-full flex items-center justify-between px-3 select-none bg-white dark:bg-zinc-950 z-40 shrink-0 border-b border-zinc-200/80 dark:border-zinc-800/60"
    >
      {/* Left Branding with Dynamic Version Resolution */}
      <div className="flex items-center gap-2" data-tauri-drag-region>
        <img src="/icon.png" alt="Downex" className="w-4 h-4 rounded-xs shadow-xs" />
        <span className="text-[12px] font-semibold tracking-wide text-zinc-900 dark:text-zinc-100 font-mono">
          DOWNEX
        </span>
        <span
          title="Dynamic runtime version (persisted & synced with Windows Registry)"
          className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-semibold"
        >
          {formattedVersion}
        </span>
      </div>

      {/* Center Dynamic Status / Update Pill (GPN Pattern) */}
      <div
        className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-auto"
        data-tauri-drag-region="false"
      >
        {status.state === 'checking' ? (
          <div className="flex items-center gap-2 px-2.5 h-6 rounded bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-[11px] font-mono text-zinc-600 dark:text-zinc-300">
            <RefreshCw className="w-3 h-3 animate-spin text-zinc-500 shrink-0" />
            <span>Checking updates...</span>
          </div>
        ) : status.state === 'up-to-date' ? (
          <div className="flex items-center gap-1.5 px-2.5 h-6 rounded bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300/80 dark:border-emerald-800/80 text-[11px] font-mono text-emerald-700 dark:text-emerald-300">
            <Check className="w-3 h-3 text-emerald-600 shrink-0 stroke-[2.5]" />
            <span>Up to date • {formattedVersion}</span>
          </div>
        ) : status.state === 'available' && status.manifest ? (
          <div className="flex items-center gap-2 px-2.5 h-6 rounded bg-violet-50 dark:bg-violet-950/40 border border-violet-300 dark:border-violet-800 text-[11px] font-mono text-violet-800 dark:text-violet-300 shadow-xs">
            <span className="font-semibold">{status.manifest.version} Available</span>
            <button
              type="button"
              onClick={openModal}
              className="px-2 h-4 rounded bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-semibold uppercase flex items-center gap-1 cursor-pointer transition-all"
            >
              <Download className="w-2.5 h-2.5" />
              <span>Update</span>
            </button>
          </div>
        ) : status.state === 'ready' ? (
          <div className="flex items-center gap-2 px-2.5 h-6 rounded bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-[11px] font-mono text-emerald-800 dark:text-emerald-300 shadow-xs">
            <span className="font-semibold">{status.targetVersion} Ready</span>
            <button
              type="button"
              onClick={openModal}
              className="px-2 h-4 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold uppercase flex items-center gap-1 cursor-pointer transition-all"
            >
              <RefreshCw className="w-2.5 h-2.5" />
              <span>Restart</span>
            </button>
          </div>
        ) : status.state === 'error' && Boolean(status.isManualCheck) ? (
          <div className="flex items-center gap-1.5 px-2.5 h-6 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-[11px] font-mono text-rose-700 dark:text-rose-300">
            <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />
            <span>Check failed</span>
          </div>
        ) : null}
      </div>

      {/* Right Window Control: Close 'X' Button (GPN Style) */}
      <div className="flex items-center" data-tauri-drag-region="false">
        <button
          type="button"
          onClick={handleClose}
          title="Close to System Tray"
          className="group relative w-8 h-6 flex items-center justify-center rounded-[2px] text-zinc-400 dark:text-zinc-500 hover:text-white dark:hover:text-white hover:bg-[#e81123] dark:hover:bg-[#e81123] active:bg-[#c42b1c] transition-colors duration-100 cursor-pointer"
        >
          <X className="w-3.5 h-3.5 stroke-[2.2]" />
        </button>
      </div>
    </div>
  );
};
