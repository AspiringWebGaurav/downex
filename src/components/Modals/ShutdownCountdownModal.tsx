import React, { useEffect, useState } from 'react';
import { Power, X, CheckCircle2 } from 'lucide-react';
import { 
  onShutdownCountdown, 
  onShutdownCancelled, 
  cancelShutdownCountdown, 
  triggerImmediateShutdown,
  ShutdownCountdownPayload 
} from '../../services/tauriService';
import { formatBytes } from '../../utils/format';

export const ShutdownCountdownModal: React.FC = () => {
  const [countdownData, setCountdownData] = useState<ShutdownCountdownPayload | null>(null);

  useEffect(() => {
    const unlistenCountdown = onShutdownCountdown((payload) => {
      setCountdownData(payload);
    });

    const unlistenCancelled = onShutdownCancelled(() => {
      setCountdownData(null);
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && countdownData) {
        handleCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      unlistenCountdown();
      unlistenCancelled();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [countdownData]);

  const handleCancel = async () => {
    await cancelShutdownCountdown();
    setCountdownData(null);
  };

  const handleShutdownNow = async () => {
    await triggerImmediateShutdown();
    setCountdownData(null);
  };

  if (!countdownData || countdownData.seconds_left <= 0) {
    return null;
  }

  const seconds = countdownData.seconds_left;
  const progressPercent = Math.max(0, Math.min(100, (seconds / 30) * 100));

  return (
    <div
      data-testid="shutdown-countdown-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div 
        className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-rose-500/30 overflow-hidden text-zinc-900 dark:text-zinc-100 flex flex-col"
        role="dialog"
        aria-modal="true"
      >
        {/* Header Ribbon */}
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-rose-500/10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-rose-500/20 text-rose-600 dark:text-rose-400 flex items-center justify-center">
              <Power className="w-4 h-4 stroke-[2.5] animate-pulse" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight text-rose-600 dark:text-rose-400 uppercase">
                Shutdown Scheduled
              </h2>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Download verified & safe on disk
              </p>
            </div>
          </div>
          <button
            onClick={handleCancel}
            title="Cancel shutdown (Esc)"
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 text-center">
          {/* Target File Card */}
          <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/80 dark:border-zinc-700/80 text-left space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span className="truncate">{countdownData.filename || 'Download Completed'}</span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400 pl-5">
              <span>{countdownData.total_bytes ? formatBytes(countdownData.total_bytes) : '100% Complete'}</span>
              <span className="font-mono text-emerald-600 dark:text-emerald-400 font-medium">NTFS Synced & Closed</span>
            </div>
          </div>

          {/* Large Countdown Display */}
          <div className="flex flex-col items-center justify-center py-2 space-y-2">
            <div className="text-[11px] font-semibold tracking-wider uppercase text-zinc-500 dark:text-zinc-400">
              Shutting down computer in
            </div>
            <div className="flex items-baseline justify-center gap-1 font-mono">
              <span className="text-6xl font-black tracking-tight text-rose-600 dark:text-rose-400 tabular-nums">
                {seconds}
              </span>
              <span className="text-lg font-bold text-zinc-400 dark:text-zinc-500">s</span>
            </div>

            {/* Countdown Progress Bar */}
            <div className="w-48 h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden border border-zinc-200 dark:border-zinc-700/80">
              <div 
                className="h-full bg-rose-500 transition-all duration-1000 ease-linear rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed px-4">
            If you are still at your computer, click <strong>Cancel</strong> to stay on. Otherwise, your system will cleanly shut down with zero file loss.
          </p>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 flex items-center justify-end gap-3">
          <button
            type="button"
            data-testid="cancel-shutdown-btn"
            onClick={handleCancel}
            className="px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all cursor-pointer uppercase tracking-wider"
          >
            Cancel / Stay On
          </button>
          <button
            type="button"
            data-testid="shutdown-now-btn"
            onClick={handleShutdownNow}
            className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white text-xs font-semibold shadow-md shadow-rose-600/20 transition-all cursor-pointer flex items-center gap-2 uppercase tracking-wider"
          >
            <Power className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Shut Down Now</span>
          </button>
        </div>
      </div>
    </div>
  );
};
