import React, { useState } from 'react';
import { useAppVersionStore } from '../stores/appVersionStore';
import { Download, RefreshCw, X, AlertCircle, CheckCircle2, Sparkles } from 'lucide-react';
import { formatVersion } from '../utils/version';

export const UpdateNotification: React.FC = () => {
  const status = useAppVersionStore((state) => state.status);
  const isToastDismissed = useAppVersionStore((state) => state.isToastDismissed);
  const dismissToast = useAppVersionStore((state) => state.dismissToast);
  const downloadUpdate = useAppVersionStore((state) => state.downloadUpdate);
  const installAndRestart = useAppVersionStore((state) => state.installAndRestart);
  const checkForUpdates = useAppVersionStore((state) => state.checkForUpdates);

  const [isActionLoading, setIsActionLoading] = useState(false);

  // GPN Rule: If same version (idle / up-to-date) -> NO SHOW!
  // Only show when next version is available, downloading, verifying, ready, or error.
  const isRealActive =
    !isToastDismissed &&
    status.state !== 'idle' &&
    status.state !== 'checking' &&
    status.state !== 'up-to-date' &&
    status.state !== 'installing' &&
    status.state !== 'restarting';

  if (!isRealActive) {
    return null;
  }

  const handleDownload = async () => {
    setIsActionLoading(true);
    try {
      await downloadUpdate();
    } catch {
      // Error handled in update service state
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleRestart = async () => {
    setIsActionLoading(true);
    try {
      await installAndRestart();
    } catch {
      setIsActionLoading(false);
    }
  };

  const handleRetry = async () => {
    setIsActionLoading(true);
    try {
      if (status.manifest) {
        await downloadUpdate();
      } else {
        await checkForUpdates(false);
      }
    } catch {
      // Error handled in update service state
    } finally {
      setIsActionLoading(false);
    }
  };

  const percent = status.progress?.percentage || 0;
  const targetVer = status.targetVersion ? formatVersion(status.targetVersion) : 'New Version';

  return (
    <div
      className="fixed bottom-5 right-5 z-50 w-[390px] max-w-[calc(100vw-32px)] select-none animate-in fade-in slide-in-from-bottom-3 duration-200"
    >
      <div className="bg-white/98 dark:bg-zinc-900/98 backdrop-blur-md border border-zinc-200/90 dark:border-zinc-800 rounded-2xl shadow-[0_12px_36px_rgba(0,0,0,0.1)] p-4 sm:p-5 flex flex-col gap-3 text-zinc-900 dark:text-zinc-100">
        {/* Header Row */}
        <div className="flex items-start justify-between gap-3 relative">
          <div className="flex items-center gap-3.5 min-w-0">
            {status.state === 'ready' ? (
              <div className="w-11 h-11 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200/80 dark:border-emerald-800/80 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 shadow-xs">
                <CheckCircle2 className="w-5 h-5 stroke-[2]" />
              </div>
            ) : status.state === 'error' ? (
              <div className="w-11 h-11 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200/80 dark:border-rose-800/80 text-rose-500 dark:text-rose-400 flex items-center justify-center shrink-0 shadow-xs">
                <AlertCircle className="w-5 h-5 stroke-[2]" />
              </div>
            ) : (
              <div className="w-11 h-11 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200/80 dark:border-emerald-800/80 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 shadow-xs">
                <Sparkles className="w-5 h-5 stroke-[2]" />
              </div>
            )}

            <div className="min-w-0">
              <h4 className="text-[13.5px] font-bold tracking-tight text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                {status.state === 'available' && (
                  <>
                    <span>Update Available</span>
                    <span className="px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-emerald-100 dark:bg-emerald-950/90 text-emerald-800 dark:text-emerald-300">
                      {targetVer}
                    </span>
                  </>
                )}
                {status.state === 'downloading' && 'Downloading update...'}
                {status.state === 'verifying' && 'Verifying package...'}
                {status.state === 'ready' && `Update Ready • ${targetVer}`}
                {status.state === 'error' && 'Update Notice'}
              </h4>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed font-normal line-clamp-2" title={status.errorMessage}>
                {status.state === 'available' && `Downex ${targetVer} is available with new fixes & features.`}
                {status.state === 'downloading' && 'Streaming verified update payload from server...'}
                {status.state === 'verifying' && 'Authenticating AES-256-GCM container & signature...'}
                {status.state === 'ready' && 'Ready to apply! Restart Downex to update immediately.'}
                {status.state === 'error' && (status.errorMessage || 'Could not download update.')}
              </p>
            </div>
          </div>

          <button
            onClick={dismissToast}
            className="w-6 h-6 rounded-md flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Progress Bar (during downloading or verifying) */}
        {(status.state === 'downloading' || status.state === 'verifying') && (
          <div className="flex flex-col gap-1 pt-0.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
              <span>{status.state === 'verifying' ? 'Verifying package integrity...' : 'Downloading update...'}</span>
              <span>{status.state === 'verifying' ? '100%' : `${percent}%`}</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-emerald-600 dark:bg-emerald-500 transition-all duration-200 rounded-full"
                style={{ width: `${status.state === 'verifying' ? 100 : percent}%` }}
              />
            </div>
          </div>
        )}

        {/* Actions Row */}
        <div className={`flex items-center justify-end gap-2.5 ${status.state === 'error' ? 'border-t border-zinc-100 dark:border-zinc-800/80 pt-2.5 mt-0.5' : 'pt-1'}`}>
          {status.state === 'available' && (
            <>
              <button
                onClick={dismissToast}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100/80 dark:hover:bg-zinc-800/80 transition-colors cursor-pointer"
              >
                Later
              </button>
              <button
                onClick={handleDownload}
                disabled={isActionLoading}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#00875a] hover:bg-[#00744e] active:scale-[0.98] text-white flex items-center gap-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-50"
              >
                {isActionLoading ? (
                  <>
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>Starting...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>Download</span>
                  </>
                )}
              </button>
            </>
          )}

          {status.state === 'ready' && (
            <button
              onClick={handleRestart}
              disabled={isActionLoading}
              className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-[#00875a] hover:bg-[#00744e] active:scale-[0.98] text-white flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-50"
            >
              {isActionLoading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Restarting...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Restart & Apply</span>
                </>
              )}
            </button>
          )}

          {status.state === 'error' && (
            <button
              onClick={handleRetry}
              disabled={isActionLoading}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isActionLoading ? 'animate-spin' : ''}`} />
              <span>Retry</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
