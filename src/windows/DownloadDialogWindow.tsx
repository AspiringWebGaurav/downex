import React, { useEffect, useState, useCallback } from 'react';
import { 
  X, 
  Download, 
  Folder, 
  Clock, 
  Copy, 
  Check, 
  HardDrive, 
  Layers, 
  FileBox, 
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { 
  addDownload, 
  closeDownloadDialog, 
  getDefaultDownloadDir, 
  getDiskFreeSpace, 
  openFolderPicker, 
  probeUrl, 
  onOpenDownloadInfoModal, 
  getDownloadDialogPayload,
  restoreManagerWindow,
  getClipboardText,
  DownloadInfoModalPayload
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

export const DownloadDialogWindow: React.FC = () => {
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
  const [incomingHeaders, setIncomingHeaders] = useState<Record<string, string> | undefined>();
  const [isCloseHovered, setIsCloseHovered] = useState(false);

  // Cleanly reset hover state on window blur, focus, or visibility changes
  useEffect(() => {
    const clearHover = () => setIsCloseHovered(false);
    window.addEventListener('blur', clearHover);
    window.addEventListener('focus', clearHover);
    document.addEventListener('visibilitychange', clearHover);
    window.addEventListener('mouseleave', clearHover);
    return () => {
      window.removeEventListener('blur', clearHover);
      window.removeEventListener('focus', clearHover);
      document.removeEventListener('visibilitychange', clearHover);
      window.removeEventListener('mouseleave', clearHover);
    };
  }, []);

  // Sync theme immediately and show window gracefully
  useEffect(() => {
    const isDark = localStorage.getItem('downex_theme') === 'dark';
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  // Update free disk space whenever savePath changes
  useEffect(() => {
    if (!savePath) return;
    let cancelled = false;
    getDiskFreeSpace(savePath)
      .then((bytes) => {
        if (!cancelled && bytes > 0) {
          setFreeSpaceBytes(bytes);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [savePath]);

  // Load default download directory on mount
  useEffect(() => {
    getDefaultDownloadDir().then((dir) => {
      setSavePath(dir);
    });
  }, []);

  // Update filename state helper
  const applyFilename = useCallback((fullName: string) => {
    const { base, ext } = splitFilenameAndExt(fullName);
    setFileBaseName(base);
    setFileExtension(ext);
  }, []);

  const applyPayload = useCallback((payload: DownloadInfoModalPayload) => {
    if (!payload || !payload.url) return;

    setUrl(payload.url);
    const name = payload.filename || payload.url.split('?')[0].split('/').pop() || 'download.bin';
    applyFilename(name);

    if (payload.total_bytes && payload.total_bytes > 0) {
      setTotalBytes(payload.total_bytes);
      setIsProbing(false);
    } else {
      setIsProbing(true);
    }
    if (payload.supports_ranges !== undefined) {
      setSupportsRanges(payload.supports_ranges);
    }

    const headers: Record<string, string> = {};
    if (payload.cookies) headers['Cookie'] = payload.cookies;
    if (payload.referer) headers['Referer'] = payload.referer;
    if (payload.user_agent) headers['User-Agent'] = payload.user_agent;
    setIncomingHeaders(Object.keys(headers).length > 0 ? headers : undefined);
  }, [applyFilename]);

  // Listen for payload from Tauri backend + check initial cached payload
  useEffect(() => {
    getDownloadDialogPayload().then((cached) => {
      if (cached) applyPayload(cached);
    });

    const unlisten = onOpenDownloadInfoModal((payload: DownloadInfoModalPayload) => {
      applyPayload(payload);
    });

    return () => {
      unlisten();
    };
  }, [applyPayload]);

  const handlePasteClipboard = useCallback(async () => {
    try {
      const clip = await getClipboardText();
      const trimmed = (clip || '').trim();
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        setUrl(trimmed);
        const guess = trimmed.split('?')[0].split('/').pop() || 'download.bin';
        applyFilename(guess);
        probeServer(trimmed);
      }
    } catch {}
  }, [applyFilename]);

  const probeServer = async (targetUrl: string) => {
    setIsProbing(true);
    try {
      const result = await probeUrl(targetUrl);
      if (result) {
        if (result.filename) {
          applyFilename(result.filename);
        }
        if (result.total_bytes) {
          setTotalBytes(result.total_bytes);
        }
        setSupportsRanges(result.supports_ranges);
      }
    } catch (e) {
      console.warn('Probe error:', e);
    } finally {
      setIsProbing(false);
    }
  };

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

  const handleClose = async () => {
    setIsCloseHovered(false);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    await closeDownloadDialog();
  };

  const handleStartDownload = async (startImmediately: boolean) => {
    if (!url.trim()) return;

    setSubmitting(true);
    try {
      const fullFilename = (fileBaseName.trim() + fileExtension.trim()) || undefined;

      await addDownload(
        url.trim(),
        savePath.trim() || undefined,
        undefined,
        incomingHeaders,
        startImmediately,
        fullFilename
      );

      // Close dialog window immediately
      await closeDownloadDialog();

      // Bring Downex main downloader window to front and show downloading list!
      await restoreManagerWindow();
    } catch (err) {
      alert('Failed to initiate download: ' + err);
    } finally {
      setSubmitting(false);
    }
  };

  // Keyboard navigation: Enter to start, Esc to cancel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
        // Trigger download on Enter
        e.preventDefault();
        handleStartDownload(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [url, fileBaseName, fileExtension, savePath, incomingHeaders]);

  const handleCopyUrl = () => {
    if (!url) return;
    navigator.clipboard?.writeText?.(url)?.catch((err) => {
      console.warn('Clipboard write notice:', err);
    });
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 1500);
  };

  // Format hostname for origin row
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

  return (
    <div className="w-screen h-screen flex flex-col bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 font-sans select-none overflow-hidden">
      {/* Frameless Drag Title Bar */}
      <div 
        data-tauri-drag-region
        className="h-10 px-4 flex items-center justify-between border-b border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/90 dark:bg-zinc-950/70 select-none cursor-move shrink-0"
      >
        <div data-tauri-drag-region className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded-md bg-emerald-600 dark:bg-emerald-500 flex items-center justify-center text-white shrink-0 shadow-xs">
            <Download className="w-3 h-3 stroke-[2.5]" />
          </div>
          <span data-tauri-drag-region className="font-semibold text-xs tracking-tight text-zinc-900 dark:text-zinc-100">
            Download File
          </span>
          {isProbing && (
            <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/80 dark:border-emerald-800/80 px-2.5 py-0.5 rounded-full flex items-center gap-2 ml-2">
              <span className="relative flex h-2.5 w-2.5 items-center justify-center shrink-0">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/80 animate-ping pointer-events-none" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.8)]" />
              </span>
              <span>Probing link...</span>
            </span>
          )}
        </div>
        <button
          onClick={handleClose}
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

      {/* Main Form Body */}
      <div className="p-4.5 flex-1 flex flex-col justify-between gap-3 overflow-hidden">
        {/* Row 1: Prominent Editable File Name */}
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

        {/* Row 2: Vital Metrics (Size & Acceleration) */}
        <div className="grid grid-cols-2 gap-3">
          {/* Card 1: File Size & Range Support */}
          <div className="p-3 rounded-lg bg-zinc-50/70 dark:bg-zinc-950/50 border border-zinc-200/80 dark:border-zinc-800/80 flex flex-col justify-between gap-1">
            <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">File Size</span>
            <div className="text-sm font-semibold font-mono text-zinc-900 dark:text-zinc-100 tracking-tight">
              {formatBytes(totalBytes)}
            </div>
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
              {supportsRanges ? <CheckCircle2 className="w-3 h-3 shrink-0" /> : <AlertCircle className="w-3 h-3 text-amber-500 shrink-0" />}
              {supportsRanges ? 'Resume supported' : 'Single connection'}
            </span>
          </div>

          {/* Card 2: Acceleration */}
          <div className="p-3 rounded-lg bg-zinc-50/70 dark:bg-zinc-950/50 border border-zinc-200/80 dark:border-zinc-800/80 flex flex-col justify-between gap-1">
            <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Transfer</span>
            <div className="flex items-center gap-1.5 text-sm font-semibold font-mono text-zinc-900 dark:text-zinc-100">
              <Layers className="w-3.5 h-3.5 text-sky-500 shrink-0" />
              <span>{supportsRanges ? '8 Connections' : '1 Connection'}</span>
            </div>
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate">
              {supportsRanges ? 'Accelerated download' : 'Standard download'}
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
            <button
              type="button"
              onClick={handleBrowseFolder}
              title="Browse folder..."
              className="px-3 py-2 rounded-lg text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200/80 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 border border-zinc-200/80 dark:border-zinc-700/80 transition-colors shadow-xs shrink-0 cursor-pointer"
            >
              Browse…
            </button>
          </div>
        </div>

        {/* Row 4: Source URL (Compact Single Line) */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
              Source URL
            </label>
            <div className="flex items-center gap-2">
              {!url && (
                <button
                  type="button"
                  onClick={handlePasteClipboard}
                  className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:underline transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                  <span>Paste from Clipboard</span>
                </button>
              )}
              {url && (
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="text-[11px] font-medium text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors flex items-center gap-1 cursor-pointer"
                >
                  {copiedUrl ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedUrl ? 'Copied' : 'Copy URL'}</span>
                </button>
              )}
            </div>
          </div>
          <div className="px-3 py-1.5 min-h-[30px] rounded-lg bg-zinc-50/70 dark:bg-zinc-950/50 border border-zinc-200/80 dark:border-zinc-800/80 text-[11px] font-mono text-zinc-500 dark:text-zinc-400 truncate select-all flex items-center" title={url}>
            {url ? (originHost || url) : <span className="text-zinc-400 dark:text-zinc-500 italic font-sans text-xs">No URL provided</span>}
          </div>
        </div>
      </div>

      {/* Bottom Bar: Quick Options & Actions */}
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
          {/* Cancel Button */}
          <button
            type="button"
            onClick={handleClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            Cancel
          </button>

          {/* Download Later Button (Paused Queue) */}
          <button
            type="button"
            disabled={submitting || !url.trim()}
            onClick={() => handleStartDownload(false)}
            title="Add to queue in paused state"
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-zinc-100 hover:bg-zinc-200/80 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 border border-zinc-200/80 dark:border-zinc-700/80 transition-all flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-40"
          >
            <Clock className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
            <span>Later</span>
          </button>

          {/* Start Download Button (Primary Emerald) */}
          <button
            type="button"
            disabled={submitting || !url.trim()}
            onClick={() => handleStartDownload(true)}
            className="px-4.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white shadow-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>{submitting ? 'Connecting...' : 'Start Download'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
