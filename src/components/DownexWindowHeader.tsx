import React, { useState, useEffect } from 'react';
import { X, Check, RefreshCw, Download, AlertTriangle } from 'lucide-react';
import { minimizeToBackground } from '../services/tauriService';
import { useAppVersionStore } from '../stores/appVersionStore';
import { compareSemver } from '../utils/version';

export const DownexWindowHeader: React.FC = () => {
  const formattedVersion = useAppVersionStore((state) => state.formattedVersion);
  const currentVersion = useAppVersionStore((state) => state.currentVersion);
  const status = useAppVersionStore((state) => state.status);
  const openModal = useAppVersionStore((state) => state.openModal);
  const [isCloseHovered, setIsCloseHovered] = useState(false);

  // Cleanly reset hover state on window blur, focus, or visibility changes
  // to prevent stuck hover/highlight states when the UI or modal appears
  useEffect(() => {
    const clearHover = () => setIsCloseHovered(false);

    window.addEventListener('blur', clearHover);
    window.addEventListener('focus', clearHover);
    document.addEventListener('visibilitychange', clearHover);
    window.addEventListener('mouseleave', clearHover);

    return () => {
      window.removeEventListener('blur', clearHover);
      window.removeEventListener('focus', clearHover);
      document.removeEventListener('visibilitychange', clearHover);
      window.removeEventListener('mouseleave', clearHover);
    };
  }, []);

  const handleClose = async () => {
    setIsCloseHovered(false);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    try {
      await minimizeToBackground();
    } catch (err) {
      console.error('Failed to minimize to background:', err);
    }
  };

  return (
    <div
      className="relative h-9 w-full flex items-center justify-between px-3 select-none bg-white dark:bg-zinc-950 z-40 shrink-0 border-b border-zinc-200/80 dark:border-zinc-800/60"
    >
      {/* Draggable Titlebar Area: Underlying region handles native window movement */}
      <div data-tauri-drag-region className="absolute inset-0 z-0 pointer-events-auto" />

      {/* Left Branding with Dynamic Version Resolution */}
      <div className="relative z-10 flex items-center gap-2 pointer-events-none select-none">
        <img src="/icon-arrow.png" alt="Downex" className="w-4 h-4 object-contain shrink-0" />
        <span className="font-brand text-[18px] text-zinc-900 dark:text-zinc-100 tracking-wide leading-none pt-0.5">
          downex
        </span>
        <span
          title="Dynamic runtime version (persisted & synced with Windows Registry)"
          className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-semibold pointer-events-auto"
        >
          {formattedVersion}
        </span>
      </div>

      {/* Center Dynamic Status / Update Pill (GPN Pattern) */}
      <div
        className="relative z-10 flex items-center justify-center pointer-events-auto"
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
        ) : status.state === 'available' && status.manifest && status.targetVersion && compareSemver(status.targetVersion, currentVersion) > 0 ? (
          <div
            onClick={openModal}
            className="group relative flex items-center gap-2 pl-2.5 pr-1.5 h-7 rounded-full bg-gradient-to-r from-violet-50 via-purple-50/70 to-indigo-50 dark:from-violet-950/50 dark:via-zinc-900 dark:to-indigo-950/40 border border-violet-200/90 dark:border-violet-800/60 shadow-xs hover:border-violet-300 dark:hover:border-violet-700 transition-all cursor-pointer overflow-hidden select-none"
            title={`Downex ${status.manifest.version} Available - Click to Review & Install`}
          >
            {/* Ambient Dynamic Shimmer Sweep */}
            <div className="animate-badge-shimmer" />

            {/* Glowing Pulse Dot */}
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-600 dark:bg-violet-400" />
            </span>

            {/* Text & Version */}
            <div className="relative z-10 flex items-center gap-1.5 text-[11px] font-medium text-violet-900 dark:text-violet-200 tracking-tight">
              <span>Update Available</span>
              <span className="px-1.5 py-0.5 rounded-md font-mono text-[10px] font-bold bg-violet-200/70 dark:bg-violet-900/60 text-violet-800 dark:text-violet-200 border border-violet-300/60 dark:border-violet-700/60">
                v{status.manifest.version}
              </span>
            </div>

            {/* Micro Action Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openModal();
              }}
              className="relative z-10 flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-violet-600 hover:bg-violet-700 active:scale-95 text-white text-[10px] font-semibold shadow-2xs group-hover:shadow-xs transition-all cursor-pointer overflow-hidden shrink-0"
            >
              <div className="animate-btn-shimmer" />
              <Download className="w-2.5 h-2.5 stroke-[2.5]" />
              <span>Update</span>
            </button>
          </div>
        ) : status.state === 'downloading' || status.state === 'verifying' ? (
          <div
            onClick={openModal}
            className="group relative flex items-center gap-2 px-3 h-7 rounded-full bg-zinc-100/90 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-[11px] font-mono text-zinc-700 dark:text-zinc-300 shadow-xs cursor-pointer select-none overflow-hidden"
            title="Click to view update progress"
          >
            <div className="animate-badge-shimmer" />
            <RefreshCw className="w-3 h-3 animate-spin text-emerald-500 shrink-0" />
            <span className="relative z-10 font-sans font-medium text-xs">
              {status.state === 'verifying' ? 'Verifying...' : `Downloading ${status.progress?.percentage || 0}%`}
            </span>
          </div>
        ) : status.state === 'ready' && status.targetVersion && compareSemver(status.targetVersion, currentVersion) > 0 ? (
          <div
            onClick={openModal}
            className="group relative flex items-center gap-2 pl-2.5 pr-1.5 h-7 rounded-full bg-gradient-to-r from-emerald-50 via-teal-50/70 to-emerald-50 dark:from-emerald-950/50 dark:via-zinc-900 dark:to-teal-950/40 border border-emerald-200/90 dark:border-emerald-800/60 shadow-xs hover:border-emerald-300 dark:hover:border-emerald-700 transition-all cursor-pointer overflow-hidden select-none"
            title={`Downex v${status.targetVersion} Ready - Click to Restart & Apply`}
          >
            {/* Ambient Dynamic Shimmer Sweep */}
            <div className="animate-badge-shimmer" />

            {/* Glowing Pulse Dot */}
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600 dark:bg-emerald-400" />
            </span>

            {/* Text & Version */}
            <div className="relative z-10 flex items-center gap-1.5 text-[11px] font-medium text-emerald-900 dark:text-emerald-200 tracking-tight">
              <span>Update Ready</span>
              <span className="px-1.5 py-0.5 rounded-md font-mono text-[10px] font-bold bg-emerald-200/70 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 border border-emerald-300/60 dark:border-emerald-700/60">
                v{status.targetVersion}
              </span>
            </div>

            {/* Micro Action Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openModal();
              }}
              className="relative z-10 flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-[10px] font-semibold shadow-2xs group-hover:shadow-xs transition-all cursor-pointer overflow-hidden shrink-0"
            >
              <div className="animate-btn-shimmer" />
              <RefreshCw className="w-2.5 h-2.5 stroke-[2.5]" />
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

      {/* Right Window Control: Close 'X' Button (Strict Hover-Only Highlight) */}
      <div className="relative z-10 flex items-center pointer-events-auto">
        <button
          type="button"
          onClick={handleClose}
          onMouseEnter={() => setIsCloseHovered(true)}
          onMouseLeave={() => setIsCloseHovered(false)}
          title="Close to System Tray"
          className={`group relative w-8 h-6 flex items-center justify-center rounded-[2px] transition-colors duration-100 cursor-pointer focus:outline-none ${
            isCloseHovered
              ? 'bg-[#e81123] text-white'
              : 'text-zinc-400 dark:text-zinc-500 bg-transparent'
          }`}
        >
          <X className="w-3.5 h-3.5 stroke-[2.2]" />
        </button>
      </div>
    </div>
  );
};
