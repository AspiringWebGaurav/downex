import React, { useState, useEffect } from 'react';
import { X, Trash2, File, HardDrive } from 'lucide-react';
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
  const [isCloseHovered, setIsCloseHovered] = useState(false);

  // Cleanly reset hover state whenever modal opens/closes
  useEffect(() => {
    setIsCloseHovered(false);
  }, [isOpen]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs select-none animate-in fade-in duration-150 p-4">
      <div className="w-full max-w-[460px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-950/40">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 flex items-center justify-center">
              <Trash2 className="w-3.5 h-3.5" />
            </div>
            <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 font-mono">
              Delete Download
            </span>
          </div>
          <button
            onClick={() => {
              setIsCloseHovered(false);
              onClose();
            }}
            onMouseEnter={() => setIsCloseHovered(true)}
            onMouseLeave={() => setIsCloseHovered(false)}
            className={`p-1 rounded transition-colors cursor-pointer focus:outline-none ${
              isCloseHovered
                ? 'bg-rose-500 text-white dark:bg-rose-600'
                : 'text-zinc-400 dark:text-zinc-500 bg-transparent'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3.5">
          {/* Target File Summary Card */}
          <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200/80 dark:border-zinc-800/80 flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-zinc-200/60 dark:bg-zinc-800 flex items-center justify-center text-zinc-600 dark:text-zinc-300 shrink-0 mt-0.5">
              <File className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate" title={item.filename}>
                {item.filename}
              </h4>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate font-mono mt-0.5" title={item.destination_path}>
                {item.destination_path}
              </p>
              <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500 dark:text-zinc-400 mt-1.5">
                <span>{formatBytes(item.downloaded_bytes)} of {formatBytes(item.total_bytes)}</span>
                <span>•</span>
                <span className="font-semibold">{percent}% complete</span>
              </div>
            </div>
          </div>

          <p className="text-xs text-zinc-600 dark:text-zinc-300">
            Are you sure you want to remove this download from Downex?
          </p>

          {/* Device Wipe Toggle Checkbox (User Feature) */}
          <label className="flex items-start gap-3 p-3 rounded-lg border border-zinc-200/90 dark:border-zinc-800/90 bg-zinc-50/70 dark:bg-zinc-950/40 cursor-pointer hover:bg-zinc-100/70 dark:hover:bg-zinc-900/50 transition-colors">
            <input
              type="checkbox"
              checked={deleteFromDisk}
              onChange={(e) => handleCheckboxChange(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-zinc-300 text-rose-600 focus:ring-rose-500 cursor-pointer accent-rose-600"
            />
            <div className="space-y-0.5 select-none">
              <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-rose-500" />
                Also delete file from disk / device
              </span>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-normal">
                {deleteFromDisk ? (
                  <span className="text-rose-600 dark:text-rose-400 font-medium">
                    ⚠️ Checked: The downloaded file will be completely wiped from your computer storage.
                  </span>
                ) : (
                  <span>
                    Unchecked: The file stays safely on your computer. Only removes the task from the Downex list.
                  </span>
                )}
              </p>
            </div>
          </label>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-950/40">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer flex items-center gap-1.5 ${
              deleteFromDisk
                ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/20'
                : 'bg-zinc-800 hover:bg-zinc-900 dark:bg-zinc-700 dark:hover:bg-zinc-600'
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
