import React, { useState, useEffect } from 'react';
import { X, Trash2, File, HardDrive, ShieldCheck, AlertTriangle, Check } from 'lucide-react';
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
  const [deleteFromDisk, setDeleteFromDisk] = useState<boolean>(() => {
    try {
      return localStorage.getItem('downex_delete_from_disk_pref') === 'true';
    } catch {
      return false;
    }
  });

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
    try {
      localStorage.setItem('downex_delete_from_disk_pref', String(checked));
    } catch (e) {
      console.warn('Failed to save delete preference:', e);
    }
  };

  const handleConfirm = () => {
    onConfirm(item.id, deleteFromDisk);
    onClose();
  };

  const percent =
    item.total_bytes && item.total_bytes > 0
      ? Math.min(100, Math.round((item.downloaded_bytes / item.total_bytes) * 100))
      : 0;

  return (
    <div
      data-testid="delete-confirm-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] select-none p-4 transition-opacity duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[500px] bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col modal-enter-instant"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — Modern Typography Hierarchy with Monospace Stats (Image 2 style) */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-800/80 bg-zinc-50/40 dark:bg-zinc-950/40">
          <div>
            <h3 className="text-[17px] font-bold text-zinc-900 dark:text-zinc-100 tracking-tight flex items-baseline gap-1">
              <span>Delete.</span>
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Remove download task from Downex.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Clean Monospace Stats (Matching Image 2 Metric Header) */}
            <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-mono font-medium text-zinc-600 dark:text-zinc-400 bg-zinc-100/80 dark:bg-zinc-800/80 px-2.5 py-1 rounded-md border border-zinc-200/60 dark:border-zinc-700/60">
              <span>{formatBytes(item.downloaded_bytes)}</span>
              <span className="text-zinc-300 dark:text-zinc-600">•</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{percent}% Complete</span>
            </div>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              title="Close modal (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body Content */}
        <div className="p-6 space-y-4">
          {/* Target File Summary Card */}
          <div className="p-3.5 rounded-xl bg-zinc-50/80 dark:bg-zinc-950/60 border border-zinc-200/80 dark:border-zinc-800/80 flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200/80 dark:border-zinc-700/80 flex items-center justify-center text-zinc-700 dark:text-zinc-200 shrink-0 shadow-2xs mt-0.5">
              <File className="w-4.5 h-4.5 stroke-[1.8]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate" title={item.filename}>
                  {item.filename}
                </h4>
                <span className="sm:hidden text-[10px] font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                  {percent}%
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate mt-0.5" title={item.destination_path}>
                {item.destination_path}
              </p>
              <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500 dark:text-zinc-400 mt-1">
                <span>{formatBytes(item.downloaded_bytes)} of {formatBytes(item.total_bytes)}</span>
              </div>
            </div>
          </div>

          <p className="text-xs text-zinc-600 dark:text-zinc-300">
            Are you sure you want to remove this download from Downex?
          </p>

          {/* Interactive Disk Deletion Toggle Card (Before & After select from disk) */}
          <div
            data-testid="delete-from-disk-toggle"
            onClick={() => handleCheckboxChange(!deleteFromDisk)}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer select-none space-y-2.5 ${
              deleteFromDisk
                ? 'border-rose-500/40 dark:border-rose-500/40 bg-rose-500/[0.03] dark:bg-rose-950/20 shadow-2xs'
                : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 hover:border-zinc-300 dark:hover:border-zinc-700'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                {/* Modern Custom Checkbox Box */}
                <div
                  className={`w-4.5 h-4.5 rounded-sm flex items-center justify-center transition-colors ${
                    deleteFromDisk
                      ? 'bg-rose-600 border border-rose-600 text-white shadow-2xs'
                      : 'border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800'
                  }`}
                >
                  {deleteFromDisk && <Check className="w-3 h-3 stroke-[3]" />}
                </div>

                <span
                  className={`text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    deleteFromDisk
                      ? 'text-rose-700 dark:text-rose-300'
                      : 'text-zinc-900 dark:text-zinc-100'
                  }`}
                >
                  <HardDrive className={`w-3.5 h-3.5 ${deleteFromDisk ? 'text-rose-500' : 'text-zinc-400 dark:text-zinc-500'}`} />
                  Also delete file from disk / device
                </span>
              </div>

              {/* Tag Badge */}
              <span
                className={`text-[9.5px] font-mono font-bold px-2 py-0.5 rounded border transition-colors ${
                  deleteFromDisk
                    ? 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/20'
                    : 'text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800/80 border-zinc-200/80 dark:border-zinc-700/80'
                }`}
              >
                {deleteFromDisk ? 'PERMANENT WIPE' : 'OPTIONAL'}
              </span>
            </div>

            {/* Dynamic Status / Alert Banner directly inspired by Image 2 Banner */}
            {deleteFromDisk ? (
              // AFTER SELECT FROM DISK: Refined Warning Banner
              <div className="px-3 py-2 rounded-lg bg-rose-500/10 dark:bg-rose-950/40 border border-rose-500/30 flex items-center justify-between text-xs text-rose-800 dark:text-rose-300">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
                  <span className="text-[11.5px] leading-tight font-medium">
                    Permanent wipe: The downloaded file on your computer storage will be deleted.
                  </span>
                </div>
              </div>
            ) : (
              // BEFORE SELECT FROM DISK: Safe Mode Banner
              <div className="px-3 py-2 rounded-lg bg-emerald-500/[0.08] dark:bg-emerald-950/30 border border-emerald-500/25 flex items-center justify-between text-xs text-emerald-800 dark:text-emerald-300">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="text-[11.5px] leading-tight font-medium">
                    Safe mode: The file stays safely on your computer. Only the task record is removed.
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions — Crisp High-Contrast Action Row (Image 2 Style) */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-100 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-950/40">
          <button
            type="button"
            onClick={onClose}
            data-testid="delete-cancel-btn"
            className="px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer uppercase tracking-wider"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            data-testid="delete-confirm-btn"
            className={`px-5 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider shadow-sm transition-all cursor-pointer flex items-center gap-1.5 ${
              deleteFromDisk
                ? 'bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white shadow-rose-600/25'
                : 'bg-zinc-900 hover:bg-black dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900'
            }`}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{deleteFromDisk ? 'Delete from Device' : 'Remove from List'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
