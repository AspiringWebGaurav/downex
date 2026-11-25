import React, { useEffect } from 'react';
import { X, Pause, Play, ListOrdered, AlertTriangle, File, RotateCcw, ShieldCheck } from 'lucide-react';
import { DownloadItem } from '../types/download';
import { getResumeCapability } from '../utils/format';

export interface BatchPauseConfirmModalProps {
  isOpen: boolean;
  action: 'pause' | 'resume' | 'queue' | 'start_queue' | null;
  items: DownloadItem[];
  onClose: () => void;
  onConfirm: () => void;
}

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export const BatchPauseConfirmModal: React.FC<BatchPauseConfirmModalProps> = ({
  isOpen,
  action,
  items,
  onClose,
  onConfirm,
}) => {
  // Handle ESC key to dismiss modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !action || items.length === 0) return null;

  // Filter affected items based on action
  const affectedItems = action === 'pause'
    ? items.filter((i) => i.status === 'downloading' || i.status === 'probing')
    : action === 'resume'
    ? items.filter((i) => i.status === 'paused' || i.status === 'failed' || i.status === 'error')
    : action === 'start_queue'
    ? items.filter((i) => i.status === 'queued')
    : items.filter((i) => i.status !== 'completed' && i.status !== 'queued');

  const finalAffected = affectedItems.length > 0 ? affectedItems : items;
  if (!isOpen || !action || finalAffected.length === 0) return null;

  // Identify items that do NOT support resume
  // For 'pause', all affected are active downloads.
  // For 'resume', all affected are paused/stopped downloads about to resume.
  // For 'queue', non-resumable items that are active or in progress will lose progress when paused.
  // For 'start_queue', any queued item that cannot resume (and had partial progress).
  const activeDownloads = finalAffected.filter(
    (i) => i.status === 'downloading' || i.status === 'probing'
  );

  const targetCheckItems = (action === 'pause' || action === 'resume' || action === 'start_queue')
    ? finalAffected
    : activeDownloads;

  const nonResumableItems = targetCheckItems.filter(
    (item) => !getResumeCapability(item).canResume
  );

  const resumableItems = targetCheckItems.filter(
    (item) => getResumeCapability(item).canResume
  );

  const totalDownloadedBytes = finalAffected.reduce(
    (acc, item) => acc + (item.downloaded_bytes || 0),
    0
  );
  const totalTargetBytes = finalAffected.reduce(
    (acc, item) => acc + (item.total_bytes || item.downloaded_bytes || 0),
    0
  );

  const nonResumableLostBytes = nonResumableItems.reduce(
    (acc, item) => acc + (item.downloaded_bytes || 0),
    0
  );

  const isPauseAction = action === 'pause';
  const isResumeAction = action === 'resume';
  const isStartQueueAction = action === 'start_queue';

  return (
    <div
      data-testid="batch-pause-queue-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] select-none p-4 transition-opacity duration-150"
      onClick={onClose}
    >
      <div
        data-testid="batch-pause-queue-dialog"
        className="w-[520px] max-w-[94vw] bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden select-none border border-zinc-200 dark:border-zinc-800 shadow-2xl modal-enter-instant flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title Bar Strip */}
        <div className="h-8 px-3.5 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 select-none cursor-move shrink-0">
          <div className="flex items-center gap-2">
            <span
              className={`font-mono-tabular text-[10.5px] uppercase tracking-wider font-semibold ${
                isPauseAction
                  ? 'text-amber-600 dark:text-amber-400'
                  : isResumeAction || isStartQueueAction
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-violet-600 dark:text-violet-400'
              }`}
            >
              {isPauseAction
                ? 'BATCH PAUSE'
                : isResumeAction
                ? 'BATCH RESUME'
                : isStartQueueAction
                ? 'START QUEUE'
                : 'MOVE TO QUEUE'}
            </span>
            <span className="text-[10px] font-mono-tabular text-zinc-400">
              {isPauseAction
                ? `HOLD TRANSFERS (${targetCheckItems.length} ACTIVE)`
                : isResumeAction
                ? `RE-OPEN CONNECTIONS (${targetCheckItems.length} PAUSED)`
                : isStartQueueAction
                ? `1-BY-1 PIPELINE (${targetCheckItems.length} QUEUED)`
                : `MOVE TO PIPELINE (${targetCheckItems.length} FILES)`}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            data-testid="batch-pause-queue-close-btn"
            className="p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer focus:outline-none"
          >
            <X className="w-3.5 h-3.5 stroke-[1.8]" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-3.5 space-y-2.5 text-xs">
          {/* Subtitle & Status Summary */}
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-[12.5px] font-bold text-zinc-900 dark:text-zinc-100 tracking-tight leading-tight">
                {isPauseAction
                  ? `Pause ${targetCheckItems.length} Active ${targetCheckItems.length === 1 ? 'Download' : 'Downloads'}?`
                  : isResumeAction
                  ? `Resume ${targetCheckItems.length} Paused ${targetCheckItems.length === 1 ? 'Download' : 'Downloads'}?`
                  : isStartQueueAction
                  ? `Start 1-by-1 Queue (${targetCheckItems.length} Files)?`
                  : `Move ${targetCheckItems.length} ${targetCheckItems.length === 1 ? 'Download' : 'Downloads'} to Queue?`}
              </h3>
              <p className="text-[10.5px] text-zinc-500 dark:text-zinc-400 leading-tight truncate">
                {isPauseAction
                  ? 'Active multi-stream connections will be closed and put on hold.'
                  : isResumeAction
                  ? 'Multi-socket parallel streams will be reopened to continue downloading.'
                  : isStartQueueAction
                  ? 'Downloads will execute one after another sequentially at maximum speed.'
                  : 'Files will wait in line in the Queues list to download sequentially.'}
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] font-mono-tabular font-medium text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/80 px-2 py-0.5 border border-zinc-200 dark:border-zinc-700 shrink-0">
              <span>{formatBytes(totalDownloadedBytes)}</span>
              <span className="text-zinc-300 dark:text-zinc-600">•</span>
              <span className="text-zinc-800 dark:text-zinc-200 font-semibold">
                {targetCheckItems.length} Items ({formatBytes(totalTargetBytes)})
              </span>
            </div>
          </div>

          {/* CRITICAL WARNING: Non-Resumable Downloads (Data Loss Warning) */}
          {nonResumableItems.length > 0 && (
            <div className="space-y-1.5">
              <div className="px-2.5 py-2 bg-amber-500/10 dark:bg-amber-950/30 border border-amber-500/40 flex items-start gap-2 text-amber-900 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="min-w-0 space-y-0.5 flex-1">
                  <div className="flex items-center justify-between gap-1 flex-wrap">
                    <span className="text-[11px] font-bold tracking-tight text-amber-800 dark:text-amber-300">
                      WARNING: {nonResumableItems.length} {nonResumableItems.length === 1 ? 'FILE DOES' : 'FILES DO'} NOT SUPPORT RESUME
                    </span>
                    <span className="text-[9px] font-mono-tabular uppercase px-1 py-0.2 bg-amber-500/20 text-amber-800 dark:text-amber-200 font-bold border border-amber-500/30">
                      {isResumeAction ? 'WILL RESTART FROM 0%' : 'PROGRESS WILL BE LOST'}
                    </span>
                  </div>
                  <p className="text-[10px] text-amber-700/90 dark:text-amber-300/90 leading-relaxed font-sans">
                    {isResumeAction ? (
                      <>
                        The host server does not support HTTP Range requests. Resuming will discard{' '}
                        <strong className="font-semibold text-amber-900 dark:text-amber-100">
                          {formatBytes(nonResumableLostBytes)}
                        </strong>{' '}
                        of previously downloaded data and restart from 0%.
                      </>
                    ) : (
                      <>
                        The host server does not support HTTP Range requests. If paused or placed in queue,{' '}
                        <strong className="font-semibold text-amber-900 dark:text-amber-100">
                          {formatBytes(nonResumableLostBytes)}
                        </strong>{' '}
                        of downloaded data will be discarded and must restart from 0%.
                      </>
                    )}
                  </p>
                </div>
              </div>

              {/* Scrollable List of Non-Resumable Downloads */}
              <div className="border border-amber-500/30 dark:border-amber-500/20 bg-amber-500/[0.03] dark:bg-amber-950/20 p-2 space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-mono-tabular text-amber-700 dark:text-amber-300 uppercase pb-1 border-b border-amber-500/20">
                  <span className="font-semibold">Cannot Resume ({nonResumableItems.length} files)</span>
                  <span>{isResumeAction ? 'Will Restart from 0%' : 'Progress Will Be Lost'}</span>
                </div>

                <div className="max-h-[140px] overflow-y-auto space-y-1.5 pr-1">
                  {nonResumableItems.map((item) => {
                    const ext = (() => {
                      const dotIdx = item.filename.lastIndexOf('.');
                      return dotIdx > 0 ? item.filename.slice(dotIdx + 1).toUpperCase() : '';
                    })();
                    const progress = item.total_bytes && item.total_bytes > 0
                      ? Math.min(100, Math.round((item.downloaded_bytes / item.total_bytes) * 100))
                      : null;

                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-2 p-1.5 bg-white/80 dark:bg-zinc-900/80 border border-amber-300/60 dark:border-amber-700/50 text-[10.5px] font-mono-tabular shadow-2xs"
                      >
                        <div className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
                          <File className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          <span className="truncate font-semibold text-zinc-900 dark:text-zinc-100" title={item.filename}>
                            {item.filename}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {ext && (
                            <span className="px-1 py-0.2 text-[9px] font-semibold bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 uppercase">
                              .{ext}
                            </span>
                          )}
                          <span className="text-[9.5px] text-zinc-600 dark:text-zinc-300 font-semibold bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 border border-amber-300/50 dark:border-amber-700/50">
                            {formatBytes(item.downloaded_bytes)}
                            {progress !== null ? ` (${progress}%)` : ''}
                          </span>
                          <span className="text-[8.5px] font-bold uppercase px-1.5 py-0.5 border border-rose-500/40 text-rose-600 dark:text-rose-400 bg-rose-500/5 flex items-center gap-1">
                            <RotateCcw className="w-2.5 h-2.5" />
                            <span>NO RESUME</span>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Safe Resumable Downloads Notice / List */}
          {resumableItems.length > 0 && (
            <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 p-2 space-y-1">
              <div className="flex items-center justify-between text-[10px] font-mono-tabular text-zinc-500 uppercase pb-1 border-b border-zinc-200/70 dark:border-zinc-800/70">
                <div className="flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-emerald-500" />
                  <span>
                    {isResumeAction ? 'Safe to Resume' : 'Safe to Pause'} ({resumableItems.length} files)
                  </span>
                </div>
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                  RESUME OK (0% DATA LOSS)
                </span>
              </div>

              {nonResumableItems.length === 0 ? (
                <p className="text-[11px] text-zinc-600 dark:text-zinc-400 py-1 font-sans leading-relaxed">
                  All {targetCheckItems.length} {targetCheckItems.length === 1 ? 'download supports' : 'downloads support'} HTTP Range requests.
                  {isResumeAction
                    ? ' All connections will safely continue from current progress with zero data loss.'
                    : isPauseAction
                    ? ' You can safely pause and resume them at any time without losing any progress.'
                    : ' They can be safely organized in the 1-by-1 queue with zero data loss.'}
                </p>
              ) : (
                <div className="max-h-[90px] overflow-y-auto space-y-1 pt-1 pr-1">
                  {resumableItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 p-1 bg-white/70 dark:bg-zinc-900/70 border border-zinc-200/60 dark:border-zinc-800/60 text-[10px] font-mono-tabular"
                    >
                      <div className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
                        <File className="w-3 h-3 text-zinc-400 shrink-0" />
                        <span className="truncate text-zinc-700 dark:text-zinc-300" title={item.filename}>
                          {item.filename}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 text-zinc-500">
                        <span>{formatBytes(item.downloaded_bytes)}</span>
                        <span className="text-[8.5px] px-1 py-0.2 border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5">
                          RESUME OK
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Bottom Actions Strip */}
          <div className="pt-2 flex items-center justify-between border-t border-zinc-200 dark:border-zinc-800 mt-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              data-testid="batch-pause-queue-cancel-btn"
              className="h-7.5 px-3.5 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-mono-tabular text-[10px] uppercase tracking-wider text-zinc-700 dark:text-zinc-300 cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={() => {
                onConfirm();
                onClose();
              }}
              data-testid="batch-pause-queue-confirm-btn"
              className={`h-7.5 px-4 font-mono-tabular text-[10.5px] uppercase tracking-wider font-bold shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer ${
                isPauseAction
                  ? 'bg-amber-600 hover:bg-amber-700 text-white'
                  : isResumeAction || isStartQueueAction
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'bg-violet-600 hover:bg-violet-700 text-white'
              }`}
            >
              {isPauseAction ? (
                <>
                  <Pause className="w-3 h-3 fill-current" />
                  <span>Pause All ({targetCheckItems.length})</span>
                </>
              ) : isResumeAction ? (
                <>
                  <Play className="w-3 h-3 fill-current" />
                  <span>Proceed &amp; Resume All ({targetCheckItems.length})</span>
                </>
              ) : isStartQueueAction ? (
                <>
                  <Play className="w-3 h-3 fill-current" />
                  <span>Proceed &amp; Start Queue ({targetCheckItems.length})</span>
                </>
              ) : (
                <>
                  <ListOrdered className="w-3.5 h-3.5" />
                  <span>Proceed &amp; Move to Queue ({targetCheckItems.length})</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
