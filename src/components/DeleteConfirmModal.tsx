import React, { useState, useEffect } from 'react';
import { X, Trash2, File, HardDrive, ShieldCheck, AlertTriangle, Check, Folder } from 'lucide-react';
import { DownloadItem } from '../types/download';

interface DeleteConfirmModalProps {
  isOpen: boolean;
  item: DownloadItem | null;
  onClose: () => void;
  onConfirm: (id: string, deleteFileFromDisk: boolean) => void;
}

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  item,
  onClose,
  onConfirm,
}) => {
  const isCompletedItem = item?.status === 'completed';

  // Keep finished downloads protected by Safe Mode by default; incomplete/unconfirmed tasks default to cleaning partial staging files
  const [deleteFromDisk, setDeleteFromDisk] = useState<boolean>(() => !isCompletedItem);

  // Reset per opened item with zero cross-file persistence
  useEffect(() => {
    if (isOpen) {
      setDeleteFromDisk(item?.status !== 'completed');
      try {
        localStorage.removeItem('downex_delete_from_disk_pref');
      } catch {}
    }
  }, [isOpen, item?.id, item?.status]);

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

  if (!isOpen || !item) return null;

  const handleCheckboxChange = (checked: boolean) => {
    setDeleteFromDisk(checked);
  };

  const handleConfirm = () => {
    onConfirm(item.id, deleteFromDisk);
    onClose();
  };

  const percent =
    item.total_bytes && item.total_bytes > 0
      ? Math.min(100, Math.round((item.downloaded_bytes / item.total_bytes) * 100))
      : 0;

  const isDownloading = item.status === 'downloading' || item.status === 'probing';

  const ext = (() => {
    const dotIdx = item.filename.lastIndexOf('.');
    return dotIdx > 0 ? item.filename.slice(dotIdx + 1).toUpperCase() : '';
  })();

  return (
    <div
      data-testid="delete-confirm-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] select-none p-4 transition-opacity duration-150"
      onClick={onClose}
    >
      <div
        data-testid="delete-modal-dialog"
        className="w-[460px] max-w-[94vw] bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden select-none border border-zinc-200 dark:border-zinc-800 shadow-2xl modal-enter-instant flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title Bar Strip */}
        <div className="h-8 px-3.5 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 select-none cursor-move shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-mono-tabular text-[10.5px] uppercase tracking-wider text-rose-600 dark:text-rose-400 font-semibold">
              {isDownloading ? 'STOP & DELETE' : 'DELETE DOWNLOAD'}
            </span>
            <span className="text-[10px] font-mono-tabular text-zinc-400">
              TASK REMOVAL
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer focus:outline-none"
          >
            <X className="w-3.5 h-3.5 stroke-[1.8]" />
          </button>
        </div>

        {/* Form Body - Compact & Symmetric */}
        <div className="p-3.5 space-y-2.5">
          {/* Subtitle & Status Banner */}
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-[12.5px] font-bold text-zinc-900 dark:text-zinc-100 tracking-tight leading-tight">
                {isDownloading ? 'Stop & Delete.' : 'Delete.'}
              </h3>
              <p className="text-[10.5px] text-zinc-500 dark:text-zinc-400 leading-tight truncate">
                {isDownloading
                  ? 'Cancel active transfer and remove from Downex.'
                  : 'Remove download task from Downex.'}
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] font-mono-tabular font-medium text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/80 px-2 py-0.5 border border-zinc-200 dark:border-zinc-700 shrink-0">
              <span>{formatBytes(item.downloaded_bytes)}</span>
              <span className="text-zinc-300 dark:text-zinc-600">•</span>
              {isDownloading ? (
                <span className="text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                  {percent}% Downloading
                </span>
              ) : (
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                  {percent}% Complete
                </span>
              )}
            </div>
          </div>

          {/* Unified File Summary & Location Box */}
          <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 p-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <File className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span
                  className="font-mono-tabular text-[11.5px] font-semibold text-zinc-900 dark:text-zinc-100 truncate select-all"
                  title={item.filename}
                >
                  {item.filename}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 font-mono-tabular">
                {ext && (
                  <span className="px-1.5 py-0.5 text-[9.5px] font-semibold bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 uppercase">
                    .{ext}
                  </span>
                )}
                <span className="text-[10px] font-semibold text-zinc-600 dark:text-zinc-400 bg-white dark:bg-zinc-800 px-1.5 py-0.5 border border-zinc-200 dark:border-zinc-700">
                  {formatBytes(item.total_bytes)}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1 border-t border-zinc-200/70 dark:border-zinc-800/70 text-[10px] font-mono-tabular text-zinc-500 dark:text-zinc-400">
              <div className="flex items-center gap-1.5 min-w-0 flex-1 truncate" title={item.destination_path}>
                <Folder className="w-3 h-3 text-zinc-400 shrink-0" />
                <span className="truncate">{item.destination_path}</span>
              </div>
              <span className={`text-[9px] font-semibold uppercase px-1 py-0.2 border shrink-0 ${
                item.status === 'completed'
                  ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5'
                  : isDownloading
                  ? 'border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/5'
                  : 'border-zinc-300 dark:border-zinc-700 text-zinc-500'
              }`}>
                {item.status === 'completed' ? 'SAVED' : isDownloading ? 'ACTIVE' : 'PAUSED'}
              </span>
            </div>
          </div>

          {/* Disk Deletion Toggle Card (Compact Single Unit) */}
          <div
            data-testid="delete-from-disk-toggle"
            onClick={() => handleCheckboxChange(!deleteFromDisk)}
            className={`p-2 border transition-all cursor-pointer select-none space-y-1.5 ${
              deleteFromDisk
                ? 'border-rose-500/50 bg-rose-500/[0.04] dark:bg-rose-950/20'
                : 'border-zinc-300 dark:border-zinc-700 bg-zinc-50/40 dark:bg-zinc-900/40 hover:border-zinc-400 dark:hover:border-zinc-600'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={`w-3.5 h-3.5 rounded-xs flex items-center justify-center transition-colors shrink-0 ${
                    deleteFromDisk
                      ? 'bg-rose-600 border border-rose-600 text-white'
                      : 'border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800'
                  }`}
                >
                  {deleteFromDisk && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                </div>

                <span
                  className={`text-[11px] font-semibold flex items-center gap-1.5 font-mono-tabular truncate ${
                    deleteFromDisk
                      ? 'text-rose-700 dark:text-rose-300'
                      : 'text-zinc-900 dark:text-zinc-100'
                  }`}
                >
                  <HardDrive className={`w-3.5 h-3.5 shrink-0 ${deleteFromDisk ? 'text-rose-500' : 'text-zinc-400'}`} />
                  <span className="truncate">
                    {!isCompletedItem
                      ? 'Also delete partial file from disk'
                      : 'Also delete file from disk / device'}
                  </span>
                </span>
              </div>

              <span
                className={`text-[9px] font-mono-tabular font-bold px-1.5 py-0.5 border shrink-0 transition-colors uppercase ${
                  deleteFromDisk
                    ? 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/30'
                    : 'text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700'
                }`}
              >
                {deleteFromDisk ? 'PERMANENT WIPE' : isCompletedItem ? 'OPTIONAL' : 'STAGING CLEANUP'}
              </span>
            </div>

            {/* Dynamic Status / Alert Banner */}
            {deleteFromDisk ? (
              <div className="px-2 py-1 bg-rose-500/10 dark:bg-rose-950/40 border border-rose-500/30 flex items-center gap-1.5 text-rose-800 dark:text-rose-300">
                <AlertTriangle className="w-3 h-3 text-rose-600 dark:text-rose-400 shrink-0" />
                <span className="text-[10px] leading-tight font-mono-tabular font-medium">
                  {isCompletedItem
                    ? 'Permanent wipe: The file on your computer will be deleted.'
                    : 'Clean removal: Incomplete staging data (unconfirmed.*.downex) will be deleted with no orphan files left.'}
                </span>
              </div>
            ) : isCompletedItem ? (
              <div className="px-2 py-1 bg-emerald-500/[0.08] dark:bg-emerald-950/30 border border-emerald-500/25 flex items-center gap-1.5 text-emerald-800 dark:text-emerald-300">
                <ShieldCheck className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="text-[10px] leading-tight font-mono-tabular font-medium">
                  Safe mode: The file stays safely on your computer. Only the task record is removed.
                </span>
              </div>
            ) : (
              <div className="px-2 py-1 bg-amber-500/[0.08] dark:bg-amber-950/30 border border-amber-500/25 flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
                <ShieldCheck className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="text-[10px] leading-tight font-mono-tabular font-medium">
                  Orphan guard: Unconfirmed .downex staging files are still cleaned up when an incomplete task is removed.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Bottom Actions Strip */}
        <div className="px-3.5 py-2 bg-zinc-50 dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            data-testid="delete-cancel-btn"
            className="h-7 px-3 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-mono-tabular text-[10px] uppercase tracking-wider text-zinc-700 dark:text-zinc-300 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            data-testid="delete-confirm-btn"
            className={`h-7 px-3.5 font-mono-tabular text-[10px] uppercase tracking-wider font-semibold shadow-xs transition-all cursor-pointer flex items-center gap-1.5 ${
              deleteFromDisk
                ? 'bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white shadow-rose-600/25'
                : 'bg-zinc-900 hover:bg-black dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900'
            }`}
          >
            <Trash2 className="w-3 h-3" />
            <span>
              {isDownloading
                ? (deleteFromDisk ? 'Stop & Delete File' : 'Stop & Remove')
                : (deleteFromDisk ? 'Delete from Device' : 'Remove from List')}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
