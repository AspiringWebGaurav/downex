import React from 'react';
import { X, Download, RefreshCw, CheckCircle, AlertTriangle, ArrowRight } from 'lucide-react';
import { useAppVersionStore } from '../stores/appVersionStore';

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export const UpdateModal: React.FC = () => {
  const isModalOpen = useAppVersionStore((state) => state.isModalOpen);
  const closeModal = useAppVersionStore((state) => state.closeModal);
  const status = useAppVersionStore((state) => state.status);
  const formattedVersion = useAppVersionStore((state) => state.formattedVersion);
  const downloadUpdate = useAppVersionStore((state) => state.downloadUpdate);
  const installAndRestart = useAppVersionStore((state) => state.installAndRestart);

  if (!isModalOpen) return null;

  const targetVersion = status.targetVersion ? `v${status.targetVersion}` : 'New Version';
  const isDownloading = status.state === 'downloading' || status.state === 'verifying';
  const isReady = status.state === 'ready';
  const isInstalling = status.state === 'installing' || status.state === 'restarting';
  const percent = status.progress?.percentage || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs select-none animate-in fade-in duration-150">
      <div className="w-[420px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200/80 dark:border-zinc-800/80">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-violet-600 flex items-center justify-center text-white font-bold text-xs">
              ↓
            </div>
            <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 font-mono">
              Downex OTA Update
            </span>
          </div>
          <button
            onClick={closeModal}
            className="p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-700/60">
            <div>
              <div className="text-[11px] font-mono text-zinc-400 uppercase tracking-wide">Current Version</div>
              <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 font-mono">{formattedVersion}</div>
            </div>
            <ArrowRight className="w-4 h-4 text-zinc-400" />
            <div>
              <div className="text-[11px] font-mono text-violet-500 uppercase tracking-wide font-semibold">Available</div>
              <div className="text-sm font-bold text-violet-600 dark:text-violet-400 font-mono">{targetVersion}</div>
            </div>
          </div>

          {/* Release Notes */}
          {status.manifest?.notes && (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                What's New
              </span>
              <div className="p-2.5 rounded-md bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200/60 dark:border-zinc-800/80 text-xs text-zinc-600 dark:text-zinc-300 max-h-32 overflow-y-auto whitespace-pre-wrap font-sans leading-relaxed">
                {status.manifest.notes}
              </div>
            </div>
          )}

          {/* Progress / Status Display */}
          {isDownloading && (
            <div className="flex flex-col gap-1.5 pt-1">
              <div className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-300 font-mono">
                <span>{status.state === 'verifying' ? 'Verifying AES-256-GCM container...' : 'Downloading update...'}</span>
                <span>{percent}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-violet-600 transition-all duration-200"
                  style={{ width: `${percent}%` }}
                />
              </div>
              {status.progress && (
                <div className="text-[10px] text-zinc-400 font-mono text-right">
                  {formatBytes(status.progress.downloadedBytes)} / {formatBytes(status.progress.totalBytes)}
                </div>
              )}
            </div>
          )}

          {isReady && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-300/60 dark:border-emerald-800/60 text-xs text-emerald-700 dark:text-emerald-300 font-medium">
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Update verified and staged. Ready to install!</span>
            </div>
          )}

          {status.errorMessage && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-300/60 dark:border-rose-800/60 text-xs text-rose-700 dark:text-rose-300">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{status.errorMessage}</span>
            </div>
          )}
        </div>

        {/* Footer Actions (Mandatory User Consent) */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 bg-zinc-50/70 dark:bg-zinc-900/80 border-t border-zinc-200/80 dark:border-zinc-800/80">
          <button
            onClick={closeModal}
            disabled={isInstalling}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            {isReady ? 'Restart Later' : 'Later'}
          </button>

          {isReady ? (
            <button
              onClick={() => installAndRestart()}
              disabled={isInstalling}
              className="px-4 py-1.5 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
            >
              {isInstalling ? (
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
              onClick={() => downloadUpdate()}
              disabled={isDownloading || isInstalling}
              className="px-4 py-1.5 rounded-md text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white flex items-center gap-1.5 shadow-xs transition-all cursor-pointer disabled:opacity-50"
            >
              {isDownloading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Downloading...</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
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
