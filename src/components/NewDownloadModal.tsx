import React, { useEffect, useState } from 'react';
import { Button } from './ui/Button';
import { 
  X, 
  Download, 
  Folder, 
  Clock, 
  FileBox, 
  Layers, 
  CheckCircle2, 
  AlertCircle, 
  HardDrive, 
  Copy, 
  Check 
} from 'lucide-react';
import { useDownloadStore } from '../stores/downloadStore';
import { 
  getDefaultDownloadDir, 
  getDiskFreeSpace, 
  openFolderPicker, 
  probeUrl, 
  restoreManagerWindow, 
  hideMainWindow,
  getClipboardText
} from '../services/tauriService';

function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return 'Unknown size';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function splitFilenameAndExt(fullName: string): { base: string; ext: string } {
  const clean = fullName.trim();
  const lastDot = clean.lastIndexOf('.');
  if (lastDot > 0 && lastDot < clean.length - 1) {
    return {
      base: clean.substring(0, lastDot),
      ext: clean.substring(lastDot),
    };
  }
  return { base: clean, ext: '' };
}

export const NewDownloadModal: React.FC<{ isStandalone?: boolean }> = ({ isStandalone = false }) => {
  const isNewModalOpen = useDownloadStore((state) => state.isNewModalOpen);
  const setNewModalOpen = useDownloadStore((state) => state.setNewModalOpen);
  const setIsStandaloneModal = useDownloadStore((state) => state.setIsStandaloneModal);
  const initialModalData = useDownloadStore((state) => state.initialModalData);
  const addNewDownload = useDownloadStore((state) => state.addNewDownload);

  const [url, setUrl] = useState('');
  const [fileBaseName, setFileBaseName] = useState('');
  const [fileExtension, setFileExtension] = useState('');
  const [savePath, setSavePath] = useState('');
  const [freeSpaceBytes, setFreeSpaceBytes] = useState<number | null>(null);
  const [rememberPath, setRememberPath] = useState(true);
  const [totalBytes, setTotalBytes] = useState<number | undefined>();
  const [supportsRanges, setSupportsRanges] = useState(true);
  const [isProbing, setIsProbing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [isCloseHovered, setIsCloseHovered] = useState(false);

  // Cleanly reset hover state whenever modal opens/closes, or on window blur/focus
  useEffect(() => {
    setIsCloseHovered(false);
    const clearHover = () => setIsCloseHovered(false);
    window.addEventListener('blur', clearHover);
    window.addEventListener('focus', clearHover);
    return () => {
      window.removeEventListener('blur', clearHover);
      window.removeEventListener('focus', clearHover);
    };
  }, [isNewModalOpen]);

  const applyFilename = (fullName: string) => {
    const { base, ext } = splitFilenameAndExt(fullName);
    setFileBaseName(base);
    setFileExtension(ext);
  };

  // Disk space check
  useEffect(() => {
    if (!savePath) return;
    let cancelled = false;
    getDiskFreeSpace(savePath).then((bytes) => {
      if (!cancelled && bytes > 0) {
        setFreeSpaceBytes(bytes);
      }
    });
    return () => { cancelled = true; };
  }, [savePath]);

  // Initialize modal state on open
  useEffect(() => {
    if (isNewModalOpen) {
      getDefaultDownloadDir().then((dir) => {
        setSavePath(dir);
      });

      if (initialModalData && initialModalData.url) {
        setUrl(initialModalData.url);
        const name = initialModalData.filename || initialModalData.url.split('?')[0].split('/').pop() || 'download.bin';
        applyFilename(name);
        if (initialModalData.total_bytes) {
          setTotalBytes(initialModalData.total_bytes);
        }
        setSupportsRanges(initialModalData.supports_ranges ?? true);
        setIsProbing(false);
      } else {
        const isClipboardWatchEnabled = (() => {
          try {
            return localStorage.getItem('downex_clipboard_watch') !== 'false';
          } catch {
            return true;
          }
        })();

        if (isClipboardWatchEnabled) {
          getClipboardText()
            .then((clip) => {
              const trimmed = (clip || '').trim();
              if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                setUrl(trimmed);
                const guess = trimmed.split('?')[0].split('/').pop() || 'download.bin';
                applyFilename(guess);
              }
            })
            .catch(() => {});
        }
      }
    } else {
      setUrl('');
      setFileBaseName('');
      setFileExtension('');
      setTotalBytes(undefined);
    }
  }, [isNewModalOpen, initialModalData]);

  // When URL changes, probe server to get real filename and Content-Length
  useEffect(() => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl || (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://'))) {
      return;
    }

    if (initialModalData && initialModalData.url === trimmedUrl && initialModalData.filename) {
      return;
    }

    const urlGuess = trimmedUrl.split('?')[0].split('/').pop() || 'download.bin';
    applyFilename(urlGuess);

    let cancelled = false;
    setIsProbing(true);

    const timer = setTimeout(async () => {
      try {
        const result = await probeUrl(trimmedUrl);
        if (cancelled || !result) return;

        if (result.filename) {
          applyFilename(result.filename);
        }
        if (result.total_bytes) {
          setTotalBytes(result.total_bytes);
        }
        setSupportsRanges(result.supports_ranges);
      } catch (e) {
        console.warn('Probe notice:', e);
      } finally {
        if (!cancelled) setIsProbing(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [url, initialModalData]);

  const handleBrowseFolder = async () => {
    try {
      const selected = await openFolderPicker();
      if (selected) {
        setSavePath(selected);
      }
    } catch (e) {
      console.warn('Folder picker error:', e);
    }
  };

  const handleCloseModal = async () => {
    setIsCloseHovered(false);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    if (isStandalone) {
      await hideMainWindow();
      setIsStandaloneModal(false);
    }
    setNewModalOpen(false);
  };

  // Keyboard navigation: Escape closes modal
  useEffect(() => {
    if (!isNewModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCloseModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isNewModalOpen, isStandalone]);

  const handleCreateDownload = async (startImmediately: boolean) => {
    if (!url.trim()) return;

    setSubmitting(true);
    try {
      const customHeaders: Record<string, string> = {};
      if (initialModalData) {
        if (initialModalData.cookies) customHeaders['Cookie'] = initialModalData.cookies;
        if (initialModalData.referer) customHeaders['Referer'] = initialModalData.referer;
        if (initialModalData.user_agent) customHeaders['User-Agent'] = initialModalData.user_agent;
      }
      const headersOpt = Object.keys(customHeaders).length > 0 ? customHeaders : undefined;
      const fullFilename = (fileBaseName.trim() + fileExtension.trim()) || undefined;

      await addNewDownload(
        url.trim(),
        savePath.trim() || undefined,
        undefined,
        headersOpt,
        startImmediately,
        fullFilename
      );

      if (isStandalone) {
        if (startImmediately) {
          await restoreManagerWindow();
        } else {
          await hideMainWindow();
        }
        setIsStandaloneModal(false);
      }
      setNewModalOpen(false);
    } catch (err) {
      alert('Failed to initiate download: ' + err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyUrl = () => {
    if (!url) return;
    navigator.clipboard?.writeText?.(url)?.catch((err) => {
      console.warn('Clipboard write notice:', err);
    });
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 1500);
  };

  let originHost = '';
  try {
    if (url) {
      const parsed = new URL(url);
      originHost = parsed.hostname + (parsed.pathname.length > 25 ? parsed.pathname.substring(0, 25) + '...' : parsed.pathname);
    }
  } catch {
    originHost = url.substring(0, 40) + '...';
  }

  const isLowSpace = totalBytes && freeSpaceBytes && freeSpaceBytes < totalBytes;

  if (!isNewModalOpen) return null;

  const dialogCard = (
    <div className={`flex flex-col bg-white dark:bg-zinc-900 overflow-hidden ${
      isStandalone 
        ? 'w-full h-full' 
        : 'w-[580px] rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-2xl animate-in fade-in zoom-in-95 duration-150'
    }`}>
      {/* Title Bar */}
      <div 
        {...(isStandalone ? { 'data-tauri-drag-region': true } : {})}
        className="h-10 px-4 flex items-center justify-between border-b border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/90 dark:bg-zinc-950/70 select-none cursor-move shrink-0"
      >
        <div {...(isStandalone ? { 'data-tauri-drag-region': true } : {})} className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded-md bg-emerald-600 dark:bg-emerald-500 flex items-center justify-center text-white shrink-0 shadow-xs">
            <Download className="w-3 h-3 stroke-[2.5]" />
          </div>
          <span {...(isStandalone ? { 'data-tauri-drag-region': true } : {})} className="font-semibold text-xs tracking-tight text-zinc-900 dark:text-zinc-100">
            Download File
          </span>
          {isProbing && (
            <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/80 dark:border-emerald-800/80 px-2.5 py-0.5 rounded-full flex items-center gap-2 ml-2">
              <span className="relative flex h-2.5 w-2.5 items-center justify-center shrink-0">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/80 animate-ping pointer-events-none" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.8)]" />
              </span>
              <span>Checking file size...</span>
            </span>
          )}
        </div>
        <button
          onClick={handleCloseModal}
          onMouseEnter={() => setIsCloseHovered(true)}
          onMouseLeave={() => setIsCloseHovered(false)}
          title="Close (Esc)"
          className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors cursor-pointer focus:outline-none ${
            isCloseHovered
              ? 'bg-rose-500 text-white dark:bg-rose-600'
              : 'text-zinc-400 dark:text-zinc-500 bg-transparent'
          }`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Form Body */}
      <div className="p-4.5 space-y-3">
        {/* Row 1: Editable File Name */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
              File Name
            </label>
            <span className="text-[11px] text-zinc-400 font-normal">
              Rename before download
            </span>
          </div>
          <div className="flex items-center rounded-lg bg-zinc-50/80 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/15 focus-within:bg-white dark:focus-within:bg-zinc-950 transition-all overflow-hidden">
            <div className="pl-3 pr-2 text-zinc-400 dark:text-zinc-500">
              <FileBox className="w-4 h-4" />
            </div>
            <input
              type="text"
              required
              placeholder="Filename"
              value={fileBaseName}
              onChange={(e) => setFileBaseName(e.target.value)}
              className="flex-1 py-2 text-xs font-medium text-zinc-900 dark:text-zinc-100 bg-transparent focus:outline-none"
            />
            {fileExtension && (
              <span className="px-2 py-0.5 mr-2 text-[11px] font-mono font-semibold rounded bg-zinc-200/70 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                .{fileExtension.replace(/^\./, '')}
              </span>
            )}
          </div>
        </div>

        {/* Row 2: File Size & Download Parts */}
        <div className="grid grid-cols-2 gap-3">
          {/* Card 1: File Size (Larger Digit) */}
          <div className="p-3.5 rounded-xl bg-zinc-50/80 dark:bg-zinc-950/60 border border-zinc-200/90 dark:border-zinc-800/90 flex flex-col justify-between gap-1.5">
            <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">File Size</span>
            <div className="text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100 tracking-tight">
              {formatBytes(totalBytes)}
            </div>
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5">
              {supportsRanges ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
              <span>{supportsRanges ? 'Can pause and resume' : 'Cannot pause or resume'}</span>
            </span>
          </div>

          {/* Card 2: Download Parts */}
          <div className="p-3.5 rounded-xl bg-zinc-50/80 dark:bg-zinc-950/60 border border-zinc-200/90 dark:border-zinc-800/90 flex flex-col justify-between gap-1.5">
            <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">Download Parts</span>
            <div className="flex items-center gap-2 text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100 tracking-tight">
              <Layers className="w-4 h-4 text-sky-500 shrink-0" />
              <span>{supportsRanges ? '8 Parts' : '1 Part'}</span>
            </div>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
              {supportsRanges ? 'Downloads in 8 parts at once' : 'Downloads in 1 part'}
            </span>
          </div>
        </div>

        {/* Row 3: Destination Folder + Live Disk Free Space */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
              Save To
            </label>
            {freeSpaceBytes !== null && (
              <span className={`text-[11px] font-mono flex items-center gap-1 ${
                isLowSpace 
                  ? 'text-rose-500 font-bold animate-pulse' 
                  : 'text-zinc-500 dark:text-zinc-400'
              }`}>
                <HardDrive className="w-3 h-3" />
                <span>{formatBytes(freeSpaceBytes)} free space</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={savePath}
                onChange={(e) => setSavePath(e.target.value)}
                placeholder="Destination folder path..."
                className="w-full px-3 py-2 pl-9 rounded-lg bg-zinc-50/80 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 text-xs font-mono text-zinc-800 dark:text-zinc-200 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 focus:bg-white dark:focus:bg-zinc-950 transition-all"
              />
              <Folder className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={handleBrowseFolder}
              title="Browse folder..."
            >
              Browse…
            </Button>
          </div>
        </div>

        {/* Row 4: Source URL (Compact Single Line) */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
              Source URL
            </label>
            <button
              type="button"
              onClick={handleCopyUrl}
              className="text-[11px] font-medium text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors flex items-center gap-1 cursor-pointer"
            >
              {copiedUrl ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
              <span>{copiedUrl ? 'Copied' : 'Copy URL'}</span>
            </button>
          </div>
          <div className="px-3 py-1.5 min-h-[30px] rounded-lg bg-zinc-50/70 dark:bg-zinc-950/50 border border-zinc-200/80 dark:border-zinc-800/80 text-[11px] font-mono text-zinc-500 dark:text-zinc-400 truncate select-all flex items-center" title={url}>
            {url ? (originHost || url) : <span className="text-zinc-400 dark:text-zinc-500 italic font-sans text-xs">No URL provided</span>}
          </div>
        </div>
      </div>

      {/* Bottom Actions */}
      <div className="px-4.5 py-3 bg-zinc-50/95 dark:bg-zinc-950/80 border-t border-zinc-200/80 dark:border-zinc-800/80 flex items-center justify-between shrink-0">
        <label className="flex items-center gap-2 cursor-pointer select-none group">
          <input
            type="checkbox"
            checked={rememberPath}
            onChange={(e) => setRememberPath(e.target.checked)}
            className="w-4 h-4 rounded border-zinc-300 text-emerald-600 accent-emerald-500 cursor-pointer"
          />
          <span className="text-xs text-zinc-600 dark:text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-200 transition-colors">
            Remember this folder
          </span>
        </label>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={handleCloseModal}
          >
            Cancel
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="md"
            icon={<Clock className="w-3.5 h-3.5" />}
            disabled={!url.trim()}
            onClick={() => handleCreateDownload(false)}
            title="Add to queue in paused state"
          >
            Later
          </Button>

          <Button
            type="button"
            variant="primary-emerald"
            size="md"
            icon={<Download className="w-3.5 h-3.5 stroke-[2.5]" />}
            loading={submitting}
            loadingText="Starting download..."
            disabled={!url.trim()}
            onClick={() => handleCreateDownload(true)}
          >
            Start Download
          </Button>
        </div>
      </div>
    </div>
  );

  if (isStandalone) {
    return dialogCard;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs select-none p-4">
      {dialogCard}
    </div>
  );
};
