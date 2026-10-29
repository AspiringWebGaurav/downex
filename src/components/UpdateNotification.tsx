import React, { useState } from 'react';
import { useAppVersionStore } from '../stores/appVersionStore';
import { Download, RefreshCw, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { formatVersion } from '../utils/version';

export const UpdateNotification: React.FC = () => {
  const status = useAppVersionStore((state) => state.status);
  const isToastDismissed = useAppVersionStore((state) => state.isToastDismissed);
  const dismissToast = useAppVersionStore((state) => state.dismissToast);
  const downloadUpdate = useAppVersionStore((state) => state.downloadUpdate);
  const installAndRestart = useAppVersionStore((state) => state.installAndRestart);
  const checkForUpdates = useAppVersionStore((state) => state.checkForUpdates);

  const [isActionLoading, setIsActionLoading] = useState(false);

  // GPN / Enterprise Rule: If same version (idle / up-to-date) -> NO SHOW!
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
      className="fixed bottom-5 right-5 z-50 w-[350px] max-w-[calc(100vw-32px)] select-none animate-in fade-in slide-in-from-bottom-2 duration-150"
    >
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg p-3.5 flex flex-col gap-2.5 text-zinc-900 dark:text-zinc-100">
        {/* Header Row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {status.state === 'ready' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : status.state === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-400 shrink-0" />
            ) : (
              <div className="w-4.5 h-4.5 rounded bg-[#00875a] flex items-center justify-center text-white font-bold text-[10px] shrink-0 leading-none shadow-2xs">
                ↓
              </div>
            )}

            <h4 className="text-xs font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5 truncate">
              {status.state === 'available' && (
                <>
                  <span>Update Available</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/60">
                    {targetVer}
                  </span>
                </>
              )}
              {status.state === 'downloading' && 'Downloading update...'}
              {status.state === 'verifying' && 'Verifying package...'}
              {status.state === 'ready' && `Update Ready (${targetVer})`}
              {status.state === 'error' && 'Update Notice'}
            </h4>
          </div>

          <button
            onClick={dismissToast}
            className="w-5 h-5 rounded flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Body Description */}
        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed font-normal line-clamp-2" title={status.errorMessage}>
          {status.state === 'available' && `Downex ${targetVer} is available with fixes and performance improvements.`}
          {status.state === 'downloading' && 'Streaming verified update payload from server...'}
          {status.state === 'verifying' && 'Authenticating cryptographic Minisign signature...'}
          {status.state === 'ready' && 'Ready to install. Restart Downex to apply now.'}
          {status.state === 'error' && (status.errorMessage || 'Could not download update.')}
        </p>

        {/* Progress Bar (during downloading or verifying) */}
        {(status.state === 'downloading' || status.state === 'verifying') && (
          <div className="flex flex-col gap-1 pt-0.5">
            <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 dark:text-zinc-500">
              <span>{status.state === 'verifying' ? 'Verifying package...' : 'Downloading...'}</span>
              <span>{status.state === 'verifying' ? '100%' : `${percent}%`}</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-[#00875a] transition-all duration-200 rounded-full"
                style={{ width: `${status.state === 'verifying' ? 100 : percent}%` }}
              />
            </div>
          </div>
        )}

        {/* Actions Row */}
        <div className={`flex items-center justify-end gap-2 ${status.state === 'error' ? 'border-t border-zinc-100 dark:border-zinc-800/80 pt-2 mt-0.5' : 'pt-0.5'}`}>
          {status.state === 'available' && (
            <>
              <button
                onClick={dismissToast}
                className="px-2.5 py-1 rounded-md text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                Later
              </button>
              <button
                onClick={handleDownload}
                disabled={isActionLoading}
                className="px-3 py-1.5 rounded-md text-xs font-semibold bg-[#00875a] hover:bg-[#00744e] active:scale-[0.98] text-white flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer disabled:opacity-50"
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
              className="w-full py-1.5 px-3 rounded-md text-xs font-semibold bg-[#00875a] hover:bg-[#00744e] active:scale-[0.98] text-white flex items-center justify-center gap-1.5 shadow-2xs transition-all cursor-pointer disabled:opacity-50"
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
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${isActionLoading ? 'animate-spin' : ''}`} />
              <span>Retry</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
