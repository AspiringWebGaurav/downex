import React, { useEffect } from 'react';
import { X, Power, File, Clock } from 'lucide-react';
import { DownloadItem } from '../types/download';
import { formatBytes } from '../utils/format';

interface AutoShutdownConfirmModalProps {
  isOpen: boolean;
  item: DownloadItem | null;
  onClose: () => void;
  onConfirm: (taskId: string) => void;
}

export const AutoShutdownConfirmModal: React.FC<AutoShutdownConfirmModalProps> = ({
  isOpen,
  item,
  onClose,
  onConfirm,
}) => {
  // ESC to dismiss, Enter to confirm
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter') {
        if (item) {
          onConfirm(item.id);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, item, onClose, onConfirm]);

  if (!isOpen || !item) return null;

  const handleConfirm = () => {
    onConfirm(item.id);
  };

  const ext = (() => {
    const dotIdx = item.filename.lastIndexOf('.');
    return dotIdx > 0 ? item.filename.slice(dotIdx + 1).toUpperCase() : '';
  })();

  return (
    <div
      data-testid="auto-shutdown-confirm-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] select-none p-4 transition-opacity duration-150"
      onClick={onClose}
    >
      <div
        className="w-[460px] max-w-[94vw] bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden select-none border border-zinc-200 dark:border-zinc-800 shadow-2xl modal-enter-instant flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title Bar Strip */}
        <div className="h-8 px-3.5 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 select-none shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-mono-tabular text-[10.5px] uppercase tracking-wider text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-1.5">
              <Power className="w-3 h-3 stroke-[2.2]" />
              AUTO-SHUTDOWN
            </span>
            <span className="text-[10px] font-mono-tabular text-zinc-400">
              POWER CONFIRMATION
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

        {/* Content Body - Compact & Symmetric */}
        <div className="p-3.5 flex flex-col gap-2.5">
          <div>
            <h3 className="text-[12.5px] font-bold text-zinc-900 dark:text-zinc-100 mb-0.5 tracking-tight leading-tight">
              Shut down PC after download?
            </h3>
            <p className="text-[10.5px] text-zinc-500 dark:text-zinc-400 leading-tight">
              When this download completes, Downex will safely shut down your computer.
            </p>
          </div>

          {/* Download File Card */}
          <div className="p-2 bg-zinc-50/60 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-zinc-200/80 dark:bg-zinc-800 flex items-center justify-center shrink-0">
              {ext ? (
                <span className="text-[9px] font-mono-tabular font-bold text-zinc-700 dark:text-zinc-300">
                  .{ext}
                </span>
              ) : (
                <File className="w-3.5 h-3.5 text-zinc-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold text-zinc-900 dark:text-zinc-100 truncate" title={item.filename}>
                {item.filename}
              </div>
              <div className="text-[9.5px] font-mono-tabular text-zinc-400">
                {item.total_bytes && item.total_bytes > 0 ? formatBytes(item.total_bytes) : 'Active download'}
              </div>
            </div>
          </div>

          {/* Safety Notice Banner */}
          <div className="px-2 py-1 bg-amber-500/[0.08] dark:bg-amber-950/30 border border-amber-500/25 flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
            <Clock className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-[10px] leading-tight font-mono-tabular font-medium">
              You will have a 30-second countdown to cancel when the download finishes.
            </span>
          </div>
        </div>

        {/* Bottom Actions Strip */}
        <div className="px-3.5 py-2 bg-zinc-50 dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            data-testid="auto-shutdown-cancel-btn"
            className="h-7 px-3 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-mono-tabular text-[10px] uppercase tracking-wider text-zinc-700 dark:text-zinc-300 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            data-testid="auto-shutdown-confirm-btn"
            className="h-7 px-3.5 font-mono-tabular text-[10px] uppercase tracking-wider font-semibold shadow-xs transition-all cursor-pointer flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white shadow-rose-600/25"
          >
            <Power className="w-3 h-3 stroke-[2.2]" />
            <span>Turn On Auto-Shutdown</span>
          </button>
        </div>
      </div>
    </div>
  );
};
