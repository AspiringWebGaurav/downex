import React, { useState } from 'react';
import { Button } from './ui/Button';
import {
  X,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Loader2,
  Sparkles,
  Check,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { useAppVersionStore } from '../stores/appVersionStore';
import { compareSemver } from '../utils/version';
import { formatBytes } from '../utils/format';

export const UpdateModal: React.FC = () => {
  const isModalOpen = useAppVersionStore((state) => state.isModalOpen);
  const closeModal = useAppVersionStore((state) => state.closeModal);
  const status = useAppVersionStore((state) => state.status);
  const currentVersion = useAppVersionStore((state) => state.currentVersion);
  const formattedVersion = useAppVersionStore((state) => state.formattedVersion);
  const checkForUpdates = useAppVersionStore((state) => state.checkForUpdates);
  const downloadAndApplyUpdate = useAppVersionStore((state) => state.downloadAndApplyUpdate);
  const installAndRestart = useAppVersionStore((state) => state.installAndRestart);

  const [isLoading, setIsLoading] = useState(false);
  const [isCloseHovered, setIsCloseHovered] = useState(false);

  // Keep modal open even during restarting state so user sees live handoff feedback!
  if (!isModalOpen) return null;

  const isChecking = status.state === 'checking';
  const isRestarting = status.state === 'restarting';
  const hasLegitUpdate =
    Boolean(status.manifest) &&
    Boolean(status.targetVersion) &&
    compareSemver(status.targetVersion!, currentVersion) > 0;

  const isAvailable = status.state === 'available' && hasLegitUpdate;
  const isDownloading = status.state === 'downloading' || status.state === 'verifying';
  const isReady = status.state === 'ready' && hasLegitUpdate;
  const isInstalling = status.state === 'installing';
  const isError = status.state === 'error' || Boolean(status.errorMessage);
  const isUpToDate = !isChecking && !isRestarting && !isAvailable && !isDownloading && !isReady && !isInstalling && !isError;
  const percent = status.progress?.percentage || 0;

  const targetVersion = status.targetVersion ? `v${status.targetVersion}` : formattedVersion;

  const handleDownloadAndInstall = async () => {
    setIsLoading(true);
    try {
      await downloadAndApplyUpdate();
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

  const handleRecheck = async () => {
    setIsLoading(true);
    try {
      await checkForUpdates(false);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs select-none animate-in fade-in duration-150 p-4">
      <div className="w-[470px] max-w-full bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/70 dark:bg-zinc-950/50">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-6 h-6 rounded-md flex items-center justify-center text-white font-bold text-xs shadow-2xs ${
                isRestarting
                  ? 'bg-amber-600 animate-pulse'
                  : isUpToDate
                  ? 'bg-emerald-600'
                  : isAvailable || isReady
                  ? 'bg-violet-600'
                  : isError
                  ? 'bg-rose-600'
                  : 'bg-zinc-700'
              }`}
            >
              {isRestarting ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : isUpToDate ? (
                <Check className="w-3.5 h-3.5" />
              ) : isAvailable || isReady ? (
                <Sparkles className="w-3.5 h-3.5" />
              ) : isError ? (
                <AlertTriangle className="w-3.5 h-3.5" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              )}
            </div>
            <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 tracking-tight">
              {isRestarting
                ? 'Applying Update & Restarting...'
                : isUpToDate
                ? 'Downex is Up to Date'
                : isChecking
                ? 'Checking for Updates'
                : isAvailable
                ? 'Downex Software Update'
                : isReady
                ? 'Update Ready to Install'
                : isError
                ? 'Update Notice'
                : 'Downex Update Manager'}
            </span>
          </div>

          {!isRestarting && (
            <button
              onClick={() => {
                setIsCloseHovered(false);
                closeModal();
              }}
              onMouseEnter={() => setIsCloseHovered(true)}
              onMouseLeave={() => setIsCloseHovered(false)}
              disabled={isInstalling || isDownloading}
              className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors cursor-pointer focus:outline-none disabled:opacity-50 ${
                isCloseHovered
                  ? 'bg-rose-500 text-white dark:bg-rose-600'
                  : 'text-zinc-400 dark:text-zinc-500 bg-transparent'
              }`}
              title="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Body Content */}
        <div className="p-5 flex flex-col gap-4">
          {/* STATE 0: RESTARTING / APPLYING */}
          {isRestarting && (
            <div className="py-6 flex flex-col items-center justify-center text-center gap-4">
              <div className="relative flex items-center justify-center">
                <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
                  <RefreshCw className="w-7 h-7 animate-spin" />
                </div>
              </div>
              <div className="space-y-1.5 max-w-sm">
                <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  Restarting Downex ({targetVersion})...
                </h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed font-sans">
                  Active downloads paused safely. The watchdog supervisor is performing the atomic NTFS binary swap and launching the new version.
                </p>
              </div>

              {/* Progress Steps Checklist */}
              <div className="w-full mt-2 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200/80 dark:border-zinc-800/80 flex flex-col gap-2 text-[11px] font-mono text-left">
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>1. Package downloaded & unpacked (AES-256-GCM)</span>
                </div>
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  <span>2. Minisign Ed25519 signature verified</span>
                </div>
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 animate-pulse font-semibold">
                  <Zap className="w-3.5 h-3.5 shrink-0" />
                  <span>3. Swapping binary & launching new process...</span>
                </div>
              </div>
            </div>
          )}

          {/* STATE 1: CHECKING */}
          {!isRestarting && isChecking && (
            <div className="py-6 flex flex-col items-center justify-center text-center gap-3">
              <Loader2 className="w-8 h-8 text-violet-600 dark:text-violet-400 animate-spin" />
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  Connecting to Release Registry...
                </h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-xs">
                  Querying GPHost Cloud Engine for latest binary releases, security patches, and remote tasks.
                </p>
              </div>
            </div>
          )}

          {/* STATE 2: UP TO DATE */}
          {!isRestarting && !isChecking && isUpToDate && !isError && (
            <div className="py-2 flex flex-col gap-4">
              <div className="flex items-center gap-3.5 p-3.5 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/80">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-emerald-900 dark:text-emerald-200 leading-tight">
                    You're Running the Latest Version!
                  </h4>
                  <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
                    Downex <span className="font-mono font-bold">{formattedVersion}</span> is currently the newest available release.
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/70 dark:border-zinc-700/60 flex items-center justify-between text-xs font-mono">
                <span className="text-zinc-500 dark:text-zinc-400">Current Runtime:</span>
                <span className="font-bold text-zinc-900 dark:text-zinc-100">{formattedVersion} (Up to Date)</span>
              </div>

              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 text-center leading-relaxed">
                Your installation has all latest multi-socket acceleration enhancements, remote task healing, and security patches.
              </p>
            </div>
          )}

          {/* STATE 3: AVAILABLE / DOWNLOADING / READY */}
          {!isRestarting && !isChecking && !isUpToDate && !isError && (
            <>
              {/* Version Comparison Box */}
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-zinc-50/90 dark:bg-zinc-800/40 border border-zinc-200/70 dark:border-zinc-700/60">
                <div>
                  <div className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider font-medium">Current Version</div>
                  <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 font-mono mt-0.5">{formattedVersion}</div>
                </div>
                <ArrowRight className="w-4 h-4 text-zinc-400 shrink-0" />
                <div>
                  <div className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 uppercase tracking-wider font-semibold">New Version Available</div>
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

              {/* Downloading Progress */}
              {isDownloading && (
                <div className="flex flex-col gap-2 pt-1">
                  <div className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-300 font-mono">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                      {status.state === 'verifying'
                        ? 'Verifying cryptographic signature...'
                        : `Downloading container (${percent}%)...`}
                    </span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      {status.state === 'verifying' ? '100%' : `${percent}%`}
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full bg-emerald-600 transition-all duration-200 rounded-full"
                      style={{ width: `${status.state === 'verifying' ? 100 : percent}%` }}
                    />
                  </div>
                  {status.progress && status.progress.totalBytes > 0 && status.state !== 'verifying' && (
                    <div className="flex justify-between text-[10px] font-mono text-zinc-400">
                      <span>{formatBytes(status.progress.downloadedBytes)}</span>
                      <span>{formatBytes(status.progress.totalBytes)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Staged & Ready */}
              {isReady && !isDownloading && (
                <div className="flex items-center gap-2.5 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/80 text-xs text-emerald-800 dark:text-emerald-300 font-medium">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Update verified and staged on disk. Ready to apply!</span>
                </div>
              )}
            </>
          )}

          {/* STATE 4: ERROR */}
          {!isRestarting && isError && (
            <div className="py-2 flex flex-col gap-3">
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-800/80 text-xs text-rose-700 dark:text-rose-300">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <span className="font-bold">Update Notice</span>
                  <p className="leading-snug">
                    {status.errorMessage || 'Could not contact release server. Please check your network connection.'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        {!isRestarting && (
          <div className="flex items-center justify-between px-5 py-3.5 bg-zinc-50/80 dark:bg-zinc-950/50 border-t border-zinc-200/80 dark:border-zinc-800/80">
            <div>
              {!isChecking && (
                <button
                  type="button"
                  onClick={handleRecheck}
                  disabled={isLoading || isDownloading || isInstalling}
                  className="text-xs font-mono text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                  <span>Check Again</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {isUpToDate ? (
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={closeModal}
                >
                  OK
                </Button>
              ) : isReady ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="md"
                    disabled={isInstalling || isLoading}
                    onClick={closeModal}
                  >
                    Restart Later
                  </Button>
                  <Button
                    type="button"
                    variant="primary-emerald"
                    size="md"
                    icon={<RefreshCw className="w-3.5 h-3.5" />}
                    loading={isInstalling || isLoading}
                    loadingText="Restarting..."
                    onClick={handleRestart}
                  >
                    Restart & Apply Now
                  </Button>
                </>
              ) : isAvailable ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="md"
                    disabled={isDownloading || isInstalling || isLoading}
                    onClick={closeModal}
                  >
                    Later
                  </Button>
                  <Button
                    type="button"
                    variant="primary-emerald"
                    size="md"
                    icon={<Download className="w-3.5 h-3.5 stroke-[2.5]" />}
                    loading={isDownloading || isLoading}
                    loadingText="Updating..."
                    disabled={isDownloading || isInstalling || isLoading}
                    onClick={handleDownloadAndInstall}
                  >
                    Download & Install Now
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  onClick={closeModal}
                >
                  Close
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
