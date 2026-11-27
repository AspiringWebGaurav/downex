import React, { useEffect, useState } from 'react';
import {
  AppWindow,
  Check,
  Copy,
  FileBox,
  Folder,
  FolderOpen,
  Link2,
  X,
} from 'lucide-react';
import {
  DownloadCompletePayload,
  getDefaultDownloadDir,
  openFileFolder,
  openFileWith,
} from '../services/tauriService';
import { useDownloadStore } from '../stores/downloadStore';
import { formatBytes } from '../utils/format';

interface DownloadCompleteModalProps {
  isStandalone?: boolean;
  standalonePayload?: DownloadCompletePayload | null;
  onStandaloneClose?: () => void;
  cardRef?: React.RefObject<HTMLDivElement | null>;
}

export const DownloadCompleteModal: React.FC<DownloadCompleteModalProps> = ({
  isStandalone = false,
  standalonePayload = null,
  onStandaloneClose,
  cardRef,
}) => {
  const storePayload = useDownloadStore((state) => state.completeModalPayload);
  const closeCompleteModal = useDownloadStore((state) => state.closeCompleteModal);

  const payload = isStandalone ? standalonePayload : storePayload;
  const [copiedField, setCopiedField] = useState<'url' | 'path' | null>(null);

  const handleClose = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    if (isStandalone && onStandaloneClose) {
      onStandaloneClose();
    } else {
      closeCompleteModal();
    }
  };

  useEffect(() => {
    if (!payload) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [payload, isStandalone]);

  if (!payload) return null;

  const totalBytes = payload.total_bytes || payload.downloaded_bytes || 0;
  const formattedSize = totalBytes > 0 ? formatBytes(totalBytes) : 'Complete';
  const displayFilename = payload.filename || 'Download Complete';
  const displayUrl = payload.url || '';
  const displayPath = payload.destination_path || '';

  const lastDot = displayFilename.lastIndexOf('.');
  const fileBaseName = lastDot > 0 ? displayFilename.slice(0, lastDot) : displayFilename;
  const fileExtension = lastDot > 0 ? displayFilename.slice(lastDot + 1).toUpperCase() : '';

  const copyToClipboard = (text: string, field: 'url' | 'path') => {
    try {
      navigator.clipboard?.writeText(text).catch(() => {});
    } catch {}
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  const handleOpenWith = async () => {
    if (displayPath) {
      try {
        await openFileWith(displayPath);
      } catch (e) {
        console.warn('Open file with error:', e);
      }
      handleClose();
    }
  };

  const handleOpenFolder = async () => {
    try {
      if (displayPath) {
        await openFileFolder(displayPath);
      } else {
        const defaultDir = await getDefaultDownloadDir();
        if (defaultDir) await openFileFolder(defaultDir);
      }
    } catch (e) {
      console.warn('Open folder error:', e);
    }
    handleClose();
  };

  const dialogCard = (
    <div
      ref={cardRef}
      data-testid="download-complete-card"
      className={`flex flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden select-none border border-zinc-200 dark:border-zinc-800 shadow-2xl ${
        isStandalone ? 'w-full h-full' : 'w-[540px] max-w-[94vw] modal-enter-instant'
      }`}
    >
      {/* Title Bar - 1:1 with NewDownloadModal */}
      <div
        {...(isStandalone ? { 'data-tauri-drag-region': true } : {})}
        className="h-8 px-3.5 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 select-none shrink-0"
      >
        <div {...(isStandalone ? { 'data-tauri-drag-region': true } : {})} className="flex items-center gap-2">
          <span
            {...(isStandalone ? { 'data-tauri-drag-region': true } : {})}
            className="font-mono-tabular text-[10.5px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400 font-semibold"
          >
            DOWNLOAD COMPLETE
          </span>
          <span
            {...(isStandalone ? { 'data-tauri-drag-region': true } : {})}
            className="text-[10px] font-mono-tabular text-zinc-400"
          >
            TASK SAVED 100%
          </span>
        </div>
        <button
          type="button"
          onClick={handleClose}
          title="Close (Esc)"
          className="p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer focus:outline-none"
        >
          <X className="w-3.5 h-3.5 stroke-[1.8]" />
        </button>
      </div>

      {/* Form Body - 1:1 with NewDownloadModal */}
      <div className="p-3.5 space-y-2.5 flex-1">
        {/* Row 1: File Name */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-semibold text-zinc-900 dark:text-zinc-100">
              File Name
            </label>
            <span className="text-[10px] font-mono-tabular text-zinc-400">
              SAVED ARTIFACT
            </span>
          </div>
          <div className="flex items-center border border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50">
            <div className="pl-2.5 pr-1.5 text-zinc-400 dark:text-zinc-500">
              <FileBox className="w-3.5 h-3.5" />
            </div>
            <span
              className="flex-1 py-1.5 text-[12px] font-mono-tabular font-medium text-zinc-900 dark:text-zinc-100 truncate select-all"
              title={displayFilename}
            >
              {fileBaseName}
            </span>
            {fileExtension && (
              <span className="px-1.5 py-0.5 mr-2 text-[10px] font-mono-tabular font-semibold bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 uppercase shrink-0">
                .{fileExtension}
              </span>
            )}
          </div>
        </div>

        {/* Row 2: Streamlined Info Strip */}
        <div className="grid grid-cols-2 gap-2">
          <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-950/40 px-2.5 py-1.5 flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-[9.5px] uppercase font-mono-tabular text-zinc-400 leading-tight">
                File Size
              </div>
              <div className="font-mono-tabular text-[12.5px] font-bold text-zinc-900 dark:text-zinc-100 leading-snug truncate">
                {formattedSize}
              </div>
            </div>
            <span className="text-[9.5px] font-mono-tabular px-1.5 py-0.5 border border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 shrink-0">
              100% COMPLETE
            </span>
          </div>

          <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-950/40 px-2.5 py-1.5 flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-[9.5px] uppercase font-mono-tabular text-zinc-400 leading-tight">
                Storage
              </div>
              <div className="font-mono-tabular text-[12.5px] font-bold text-zinc-900 dark:text-zinc-100 leading-snug truncate">
                Verified on Disk
              </div>
            </div>
            <span className="text-[9.5px] font-mono-tabular text-zinc-400 uppercase shrink-0">
              LOCAL DISK
            </span>
          </div>
        </div>

        {/* Row 3: Save To */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-semibold text-zinc-900 dark:text-zinc-100">
              Save To
            </label>
            <span className="text-[10px] font-mono-tabular text-zinc-400">
              SAVED LOCATION
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1 min-w-0">
              <div
                className="w-full px-2.5 py-1.5 pl-8 border border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-950/50 text-[11px] font-mono-tabular text-zinc-900 dark:text-zinc-100 truncate select-all"
                title={displayPath}
              >
                {displayPath}
              </div>
              <Folder className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            <button
              type="button"
              onClick={() => copyToClipboard(displayPath, 'path')}
              className="h-7.5 px-2.5 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-mono-tabular text-[10px] uppercase tracking-wider shrink-0 cursor-pointer flex items-center gap-1"
              title="Copy folder/file path"
            >
              {copiedField === 'path' ? (
                <Check className="w-3 h-3 text-emerald-500" />
              ) : (
                <Copy className="w-3 h-3 text-zinc-400" />
              )}
              <span>{copiedField === 'path' ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </div>

        {/* Row 4: Source URL */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-semibold text-zinc-900 dark:text-zinc-100">
              Source URL
            </label>
            <button
              type="button"
              onClick={() => copyToClipboard(displayUrl, 'url')}
              className="text-[10px] font-mono-tabular font-semibold text-emerald-600 dark:text-emerald-400 hover:underline transition-colors flex items-center gap-1 cursor-pointer"
            >
              {copiedField === 'url' ? (
                <Check className="w-3 h-3 text-emerald-500" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
              <span>{copiedField === 'url' ? 'COPIED' : 'COPY'}</span>
            </button>
          </div>
          <div className="flex items-center border border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-950/50 px-2.5 py-1.5">
            <Link2 className="w-3.5 h-3.5 text-zinc-400 mr-2 shrink-0" />
            <span
              className="flex-1 text-[11px] font-mono-tabular text-zinc-900 dark:text-zinc-100 truncate select-all"
              title={displayUrl}
            >
              {displayUrl}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Actions - Flush 1:1 with NewDownloadModal */}
      <div className="px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between shrink-0 mt-auto">
        <button
          type="button"
          onClick={handleOpenWith}
          className="h-7.5 px-3 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-mono-tabular text-[11px] uppercase tracking-wider hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-1.5 cursor-pointer"
          title="Choose application to open this file"
        >
          <AppWindow className="w-3.5 h-3.5 text-zinc-400" />
          <span>Open With...</span>
        </button>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleClose}
            className="h-7.5 px-3 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-mono-tabular text-[11px] uppercase tracking-wider hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            Close
          </button>

          <button
            type="button"
            data-testid="complete-open-folder-btn"
            onClick={handleOpenFolder}
            className="h-7.5 px-3.5 bg-black text-white border border-black hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:border-white dark:hover:bg-zinc-200 font-mono-tabular text-[11px] uppercase tracking-wider font-semibold flex items-center gap-1.5 cursor-pointer"
            title="Open containing folder and highlight file"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>Open Folder</span>
          </button>
        </div>
      </div>
    </div>
  );

  if (isStandalone) {
    return dialogCard;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-100"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      {dialogCard}
    </div>
  );
};
