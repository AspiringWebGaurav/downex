import React, { useState } from 'react';
import { useAppVersionStore } from '../stores/appVersionStore';
import { useDownloadStore } from '../stores/downloadStore';
import { Button } from './ui/Button';
import { Download, RefreshCw, X, AlertCircle, CheckCircle2, ArrowDown, FileText } from 'lucide-react';
import { formatVersion, compareSemver } from '../utils/version';

export const UpdateNotification: React.FC = () => {
  const status = useAppVersionStore((state) => state.status);
  const currentVersion = useAppVersionStore((state) => state.currentVersion);
  const isToastDismissed = useAppVersionStore((state) => state.isToastDismissed);
  const dismissToast = useAppVersionStore((state) => state.dismissToast);
  const downloadUpdate = useAppVersionStore((state) => state.downloadUpdate);
  const installAndRestart = useAppVersionStore((state) => state.installAndRestart);
  const checkForUpdates = useAppVersionStore((state) => state.checkForUpdates);
  const openSettingsSubView = useDownloadStore((state) => state.openSettingsSubView);

  const [isActionLoading, setIsActionLoading] = useState(false);

  // GPN / Enterprise Rule: If same version (idle / up-to-date) -> NO SHOW!
  // Only show when next version is available, downloading, verifying, ready, or error.
  const hasLegitUpdate =
    Boolean(status.targetVersion) &&
    Boolean(status.manifest) &&
    compareSemver(status.targetVersion!, currentVersion) > 0;

  const isRealActive =
    !isToastDismissed &&
    status.state !== 'idle' &&
    status.state !== 'checking' &&
    status.state !== 'up-to-date' &&
    status.state !== 'installing' &&
    status.state !== 'restarting' &&
    (status.state === 'available' || status.state === 'ready' ? hasLegitUpdate : true);

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
      id="update-notification-toast"
      className="fixed bottom-5 right-5 z-50 w-[350px] max-w-[calc(100vw-32px)] select-none animate-in fade-in slide-in-from-bottom-2 duration-150"
    >
      <div className="bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border border-zinc-200/80 dark:border-zinc-800/80 rounded-2xl shadow-xl ring-1 ring-black/5 dark:ring-white/5 p-4 flex flex-col gap-3 text-zinc-900 dark:text-zinc-100">
        {/* Header Row */}
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            {status.state === 'ready' ? (
              <div className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/80 dark:border-emerald-800/80 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            ) : status.state === 'error' ? (
              <div className="w-7 h-7 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-200/80 dark:border-rose-800/80 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0">
                <AlertCircle className="w-4 h-4" />
              </div>
            ) : status.state === 'verifying' ? (
              <div className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/80 dark:border-emerald-800/80 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            ) : status.state === 'downloading' ? (
              <div className="w-7 h-7 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200/80 dark:border-zinc-700/80 flex items-center justify-center text-zinc-900 dark:text-zinc-100 shrink-0">
                <ArrowDown className="w-3.5 h-3.5 stroke-[2.5] animate-bounce" />
              </div>
            ) : (
              <div className="w-7 h-7 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200/80 dark:border-zinc-700/80 flex items-center justify-center text-zinc-900 dark:text-zinc-100 shrink-0">
                <Download className="w-3.5 h-3.5 stroke-[2.2]" />
              </div>
            )}

            <h4 className="text-xs font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5 truncate">
              {status.state === 'available' && (
                <>
                  <span>Update Available</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200/80 dark:border-zinc-700/80">
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
            className="w-6 h-6 rounded-md flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Body Description - Clean, simple, no tech buzzwords */}
        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed font-normal line-clamp-2" title={status.errorMessage}>
          {status.state === 'available' && `Downex ${targetVer} is ready to download.`}
          {status.state === 'downloading' && 'Downloading the latest update file...'}
          {status.state === 'verifying' && 'Checking update integrity and security...'}
          {status.state === 'ready' && 'Update is ready. Restart Downex to apply.'}
          {status.state === 'error' && (status.errorMessage || 'Could not download update. Please try again.')}
        </p>

        {/* Progress Bar (during downloading or verifying) - High-visibility animated bar, zero digits/sizes */}
        {(status.state === 'downloading' || status.state === 'verifying') && (
          <div className="w-full pt-1.5 pb-1">
            <div className="relative w-full h-3.5 rounded-full bg-zinc-100 dark:bg-zinc-800/90 overflow-hidden ring-1 ring-inset ring-black/5 dark:ring-white/10 p-0.5 shadow-inner">
              <div
                className="h-full bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-400 dark:from-emerald-500 dark:via-emerald-400 dark:to-teal-300 transition-all duration-200 rounded-full relative overflow-hidden animate-progress-pulse min-w-[16px]"
                style={{ width: `${status.state === 'verifying' ? 100 : Math.max(2, percent)}%` }}
              >
                <div className="animate-progress-glow" />
              </div>
            </div>
          </div>
        )}

        {/* Actions Row */}
        <div className={`flex items-center justify-between gap-2 ${status.state === 'error' ? 'border-t border-zinc-100 dark:border-zinc-800/80 pt-2.5 mt-0.5' : 'pt-0.5'}`}>
          {status.state === 'available' ? (
            <>
              <button
                type="button"
                onClick={() => openSettingsSubView('patch-notes')}
                className="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 flex items-center gap-1.5 transition-colors cursor-pointer select-none group"
                title="View Release Changelog & New Features"
              >
                <FileText className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-700 dark:group-hover:text-zinc-200 transition-colors" />
                <span className="font-medium">View Patch Notes</span>
              </button>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={dismissToast}
                >
                  Later
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  shimmer
                  icon={<Download className="w-3.5 h-3.5 stroke-[2.2]" />}
                  loading={isActionLoading}
                  loadingText="Starting..."
                  onClick={handleDownload}
                >
                  Download
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-end gap-2 w-full">
              {status.state === 'ready' && (
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  fullWidth
                  shimmer
                  icon={<RefreshCw className="w-3.5 h-3.5" />}
                  loading={isActionLoading}
                  loadingText="Restarting..."
                  onClick={handleRestart}
                >
                  Restart & Apply
                </Button>
              )}

              {status.state === 'error' && (
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  icon={<RefreshCw className="w-3.5 h-3.5" />}
                  loading={isActionLoading}
                  onClick={handleRetry}
                >
                  Retry
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
