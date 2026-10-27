import React, { useState } from 'react';
import { X, Download, RefreshCw, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { useAppVersionStore } from '../stores/appVersionStore';

export const UpdateModal: React.FC = () => {
  const isModalOpen = useAppVersionStore((state) => state.isModalOpen);
  const closeModal = useAppVersionStore((state) => state.closeModal);
  const status = useAppVersionStore((state) => state.status);
  const formattedVersion = useAppVersionStore((state) => state.formattedVersion);
  const downloadUpdate = useAppVersionStore((state) => state.downloadUpdate);
  const installAndRestart = useAppVersionStore((state) => state.installAndRestart);

  const [isLoading, setIsLoading] = useState(false);

  if (!isModalOpen) return null;

  const targetVersion = status.targetVersion ? `v${status.targetVersion}` : 'New Version';
  const isDownloading = status.state === 'downloading' || status.state === 'verifying';
  const isReady = status.state === 'ready';
  const isInstalling = status.state === 'installing' || status.state === 'restarting';
  const percent = status.progress?.percentage || 0;

  const handleDownload = async () => {
    setIsLoading(true);
    try {
      await downloadUpdate();
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestart = async () => {
    setIsLoading(true);
    try {
      await installAndRestart();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs select-none animate-in fade-in duration-150">
      <div className="w-[440px] max-w-[calc(100vw-32px)] bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/70 dark:bg-zinc-950/50">
          <div className="flex items-center gap-2.5">
            <div className="w-5 h-5 rounded-md bg-[#00875a] flex items-center justify-center text-white font-bold text-xs shadow-2xs">
              ↓
            </div>
            <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 tracking-tight">
              Downex Software Update
            </span>
          </div>
          <button
            onClick={closeModal}
            className="w-6 h-6 rounded-md flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-3.5">
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-zinc-50/90 dark:bg-zinc-800/40 border border-zinc-200/70 dark:border-zinc-700/60">
            <div>
              <div className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider font-medium">Current Version</div>
              <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 font-mono mt-0.5">{formattedVersion}</div>
            </div>
            <ArrowRight className="w-4 h-4 text-zinc-400 shrink-0" />
            <div>
              <div className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 uppercase tracking-wider font-semibold">Target Version</div>
              <div className="text-sm font-bold text-emerald-700 dark:text-emerald-300 font-mono mt-0.5">{targetVersion}</div>
            </div>
          </div>

          {/* Release Notes */}
          {status.manifest?.notes && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                What's New in this Release
              </span>
              <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950/50 border border-zinc-200/70 dark:border-zinc-800/80 text-xs text-zinc-600 dark:text-zinc-300 max-h-36 overflow-y-auto whitespace-pre-wrap font-sans leading-relaxed">
                {status.manifest.notes}
              </div>
            </div>
          )}

          {/* Progress / Status Display */}
          {isDownloading && (
            <div className="flex flex-col gap-1.5 pt-1">
              <div className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-300 font-mono">
                <span>{status.state === 'verifying' ? 'Verifying package integrity...' : 'Downloading update...'}</span>
                <span>{status.state === 'verifying' ? '100%' : `${percent}%`}</span>
              </div>
              <div className="w-full h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-[#00875a] transition-all duration-200 rounded-full"
                  style={{ width: `${status.state === 'verifying' ? 100 : percent}%` }}
                />
              </div>
            </div>
          )}

          {isReady && (
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/80 text-xs text-emerald-800 dark:text-emerald-300 font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Update verified and staged. Ready to install!</span>
            </div>
          )}

          {status.errorMessage && (
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-800/80 text-xs text-rose-700 dark:text-rose-300">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span className="leading-snug">{status.errorMessage}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 bg-zinc-50/80 dark:bg-zinc-950/50 border-t border-zinc-200/80 dark:border-zinc-800/80">
          <button
            onClick={closeModal}
            disabled={isInstalling || isLoading}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            {isReady ? 'Restart Later' : 'Later'}
          </button>

          {isReady ? (
            <button
              onClick={handleRestart}
              disabled={isInstalling || isLoading}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#00875a] hover:bg-[#00744e] active:scale-[0.98] text-white flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
            >
              {isInstalling || isLoading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Restarting...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Restart & Apply Now</span>
                </>
              )}
            </button>
          ) : (
            <button
              onClick={handleDownload}
              disabled={isDownloading || isInstalling || isLoading}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#00875a] hover:bg-[#00744e] active:scale-[0.98] text-white flex items-center gap-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-50"
            >
              {isDownloading || isLoading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Downloading...</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Download & Install</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
