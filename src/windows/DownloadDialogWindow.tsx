import React, { useEffect, useState, useCallback } from 'react';
import { Button } from '../components/ui/Button';
import { AutoScrollText } from '../components/ui/AutoScrollText';
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
  AlertCircle,
  Sun,
  Moon,
  RotateCcw,
  ArrowRight,
  Monitor
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
  DownloadInfoModalPayload,
  isTauri
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

interface MockScenario {
  id: string;
  name: string;
  badge: string;
  url: string;
  filename: string;
  total_bytes: number;
  supports_ranges: boolean;
  freeSpaceBytes: number;
}

const MOCK_SCENARIOS: Record<string, MockScenario> = {
  iso: {
    id: 'iso',
    name: 'Ubuntu 24.04 ISO',
    badge: '5.72 GB • 8 Conns',
    url: 'https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso',
    filename: 'ubuntu-24.04-desktop-amd64.iso',
    total_bytes: 6144000000,
    supports_ranges: true,
    freeSpaceBytes: 184.5 * 1024 * 1024 * 1024,
  },
  setup: {
    id: 'setup',
    name: 'VS Code Setup',
    badge: '94.2 MB • Executable',
    url: 'https://code.visualstudio.com/sha/download?build=stable&os=win32-x64-user',
    filename: 'VSCodeUserSetup-x64-1.95.1.exe',
    total_bytes: 98779136,
    supports_ranges: true,
    freeSpaceBytes: 184.5 * 1024 * 1024 * 1024,
  },
  video: {
    id: 'video',
    name: '4K Nature Video',
    badge: '1.85 GB • MP4',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    filename: 'BigBuckBunny-4K-60fps.mp4',
    total_bytes: 1985000000,
    supports_ranges: true,
    freeSpaceBytes: 184.5 * 1024 * 1024 * 1024,
  },
  norange: {
    id: 'norange',
    name: 'Single Stream',
    badge: '432 MB • No Resume',
    url: 'https://live-archive.org/download/stream_backup_daily.tar',
    filename: 'stream_backup_daily.tar',
    total_bytes: 432537600,
    supports_ranges: false,
    freeSpaceBytes: 184.5 * 1024 * 1024 * 1024,
  },
  lowspace: {
    id: 'lowspace',
    name: 'Low Disk Warning',
    badge: '1.1 GB Free Space',
    url: 'https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso',
    filename: 'ubuntu-24.04-desktop-amd64.iso',
    total_bytes: 6144000000,
    supports_ranges: true,
    freeSpaceBytes: 1181116006, // 1.1 GB free space < 5.72 GB total!
  },
  probing: {
    id: 'probing',
    name: 'Probing State',
    badge: 'Detecting Size',
    url: 'https://cloud-cdn.download/heavy-asset-payload.zip',
    filename: 'heavy-asset-payload.zip',
    total_bytes: 0,
    supports_ranges: true,
    freeSpaceBytes: 184.5 * 1024 * 1024 * 1024,
  },
};

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

  // Browser sandbox state
  const [activeScenarioId, setActiveScenarioId] = useState<string>('iso');
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(() => {
    try {
      return localStorage.getItem('downex_theme') !== 'light';
    } catch {
      return true;
    }
  });
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((current) => (current === msg ? null : current));
    }, 3200);
  }, []);

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

  // Sync theme immediately
  useEffect(() => {
    if (isDarkTheme) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('downex_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('downex_theme', 'light');
    }
  }, [isDarkTheme]);

  // Update free disk space whenever savePath changes
  useEffect(() => {
    if (!savePath) return;
    let cancelled = false;
    getDiskFreeSpace(savePath)
      .then((bytes) => {
        if (!cancelled && bytes > 0) {
          // If in lowspace scenario in browser preview, preserve mock low space
          if (!isTauri && activeScenarioId === 'lowspace') {
            return;
          }
          setFreeSpaceBytes(bytes);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [savePath, activeScenarioId]);

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
      setTotalBytes(undefined);
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

  const applyScenario = useCallback((scenarioKey: string) => {
    const sc = MOCK_SCENARIOS[scenarioKey];
    if (!sc) return;
    setActiveScenarioId(sc.id);
    setUrl(sc.url);
    applyFilename(sc.filename);
    setTotalBytes(sc.total_bytes > 0 ? sc.total_bytes : undefined);
    setIsProbing(sc.total_bytes === 0);
    setSupportsRanges(sc.supports_ranges);
    setFreeSpaceBytes(sc.freeSpaceBytes);
  }, [applyFilename]);

  // Listen for payload from Tauri backend + check initial cached payload
  useEffect(() => {
    getDownloadDialogPayload().then((cached) => {
      if (cached) {
        applyPayload(cached);
      } else if (!isTauri) {
        // Auto-load default rich mock scenario in browser mode!
        const urlParams = new URLSearchParams(window.location.search);
        const requestedScenario = urlParams.get('scenario') || 'iso';
        applyScenario(requestedScenario in MOCK_SCENARIOS ? requestedScenario : 'iso');
      }
    });

    const unlisten = onOpenDownloadInfoModal((payload: DownloadInfoModalPayload) => {
      applyPayload(payload);
    });

    return () => {
      unlisten();
    };
  }, [applyPayload, applyScenario]);

  const handlePasteClipboard = useCallback(async () => {
    try {
      const clip = await getClipboardText();
      const trimmed = (clip || '').trim();
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        setUrl(trimmed);
        const guess = trimmed.split('?')[0].split('/').pop() || 'download.bin';
        applyFilename(guess);
        probeServer(trimmed);
        showToast('Pasted URL from clipboard');
      } else if (!isTauri) {
        const sample = 'https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso';
        setUrl(sample);
        applyFilename('ubuntu-24.04-desktop-amd64.iso');
        setTotalBytes(6144000000);
        setSupportsRanges(true);
        showToast('Sample URL loaded');
      }
    } catch {
      if (!isTauri) {
        const sample = 'https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso';
        setUrl(sample);
        applyFilename('ubuntu-24.04-desktop-amd64.iso');
        setTotalBytes(6144000000);
        setSupportsRanges(true);
        showToast('Sample URL loaded');
      }
    }
  }, [applyFilename, showToast]);

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
      } else if (!isTauri) {
        // Browser quick folder choices
        const choices = ['C:\Users\User\Downloads', 'D:\Downloads\ISOs', 'E:\Media\Videos', 'C:\Software\Packages'];
        const nextChoice = choices[(choices.indexOf(savePath) + 1) % choices.length] || choices[0];
        setSavePath(nextChoice);
        showToast(`Selected mock folder: ${nextChoice}`);
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
    if (!isTauri) {
      showToast('✕ Dialog closed (Simulated)');
      return;
    }
    await closeDownloadDialog();
  };

  const handleClearForm = () => {
    setUrl('');
    setFileBaseName('');
    setFileExtension('');
    setTotalBytes(undefined);
    setIsProbing(false);
    setActiveScenarioId('');
    showToast('Form cleared (Empty state)');
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

      if (!isTauri) {
        showToast(startImmediately ? '🚀 Download started! Added to queue.' : '⏸️ Saved to queue in paused state.');
        return;
      }

      // Close dialog window immediately
      await closeDownloadDialog();

      // Bring Downex main downloader window to front and show downloading list!
      await restoreManagerWindow();
    } catch (err) {
      if (!isTauri) {
        showToast('🚀 Download simulated in browser mode');
      } else {
        alert('Failed to initiate download: ' + err);
      }
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
    showToast('Copied URL to clipboard');
    setTimeout(() => setCopiedUrl(false), 1500);
  };


  const isLowSpace = totalBytes && freeSpaceBytes && freeSpaceBytes < totalBytes;

  // The Dialog Window Component
  const DialogContent = (
    <div className="w-full h-full flex flex-col bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 font-sans select-none overflow-hidden">
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
              <span>Checking file size</span>
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
      <div className="p-4.5 flex-1 flex flex-col justify-between gap-3 overflow-y-auto">
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
                {isLowSpace && <span className="text-[10px] bg-rose-500/10 text-rose-500 px-1 rounded ml-1 font-sans">Low Space</span>}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={savePath}
                onChange={(e) => setSavePath(e.target.value)}
                placeholder="Destination folder path"
                className="w-full px-3 py-2 pl-9 rounded-lg bg-zinc-50/80 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 text-xs font-mono text-zinc-800 dark:text-zinc-200 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 focus:bg-white dark:focus:bg-zinc-950 transition-all"
              />
              <Folder className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={handleBrowseFolder}
              title="Browse folder"
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
            <div className="flex items-center gap-2">
              {!url && (
                <button
                  type="button"
                  onClick={handlePasteClipboard}
                  className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:underline transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                  <span>Paste URL</span>
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
          <div className="px-3 py-1.5 min-h-[30px] rounded-lg bg-zinc-50/70 dark:bg-zinc-950/50 border border-zinc-200/80 dark:border-zinc-800/80 flex items-center overflow-hidden">
            <AutoScrollText
              text={url}
              className="text-[11px] font-mono text-zinc-700 dark:text-zinc-300"
              placeholder="No URL provided"
            />
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
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={handleClose}
          >
            Cancel
          </Button>

          {/* Download Later Button (Paused Queue) */}
          <Button
            type="button"
            variant="secondary"
            size="md"
            icon={<Clock className="w-3.5 h-3.5" />}
            disabled={!url.trim()}
            onClick={() => handleStartDownload(false)}
            title="Add to queue in paused state"
          >
            Later
          </Button>

          {/* Start Download Button (Primary Emerald) */}
          <Button
            type="button"
            variant="primary-emerald"
            size="md"
            icon={<Download className="w-3.5 h-3.5 stroke-[2.5]" />}
            loading={submitting}
            loadingText="Starting download"
            disabled={!url.trim()}
            onClick={() => handleStartDownload(true)}
          >
            Start Download
          </Button>
        </div>
      </div>
    </div>
  );

  // If running natively in Tauri desktop, render pure frameless window directly
  if (isTauri) {
    return (
      <div className="w-screen h-screen flex flex-col bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 font-sans select-none overflow-hidden">
        {DialogContent}
      </div>
    );
  }

  // If running in browser preview mode, wrap inside interactive desktop preview stage
  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-zinc-900 via-zinc-950 to-black text-zinc-100 flex flex-col items-center justify-center p-4 sm:p-6 relative font-sans selection:bg-emerald-500 selection:text-white">
      {/* Floating Dev Sandbox Navigation Bar */}
      <div className="w-[580px] max-w-full mb-3 px-3 py-2 rounded-xl bg-zinc-900/90 border border-zinc-800/90 backdrop-blur-md flex flex-wrap items-center justify-between gap-2 shadow-xl ring-1 ring-white/5">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-semibold tracking-tight text-zinc-200">
            Download Dialog Sandbox
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-xs">
          {/* Theme Toggle */}
          <button
            type="button"
            onClick={() => setIsDarkTheme(!isDarkTheme)}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
            title={isDarkTheme ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
          >
            {isDarkTheme ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>

          {/* Reset / Clear */}
          <button
            type="button"
            onClick={handleClearForm}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Clear Form / Test Blank State"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* Link to Download Complete Modal */}
          <a
            href="/?window=download_complete"
            className="px-2 py-1 rounded-lg text-[11px] font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors flex items-center gap-1 cursor-pointer"
            title="Inspect Download Complete Window"
          >
            <span>Complete Modal</span>
            <ArrowRight className="w-3 h-3" />
          </a>

          {/* Link to Full Main App */}
          <a
            href="/"
            className="px-2 py-1 rounded-lg text-[11px] font-medium text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/50 border border-emerald-900/60 transition-colors flex items-center gap-1 cursor-pointer"
            title="Go to Main Downex Dashboard"
          >
            <Monitor className="w-3 h-3" />
            <span>App</span>
          </a>
        </div>
      </div>

      {/* Scenario Pills Selector */}
      <div className="w-[580px] max-w-full mb-3 flex items-center gap-1.5 overflow-x-auto pb-1 text-xs select-none scrollbar-none">
        <span className="text-[11px] font-semibold text-zinc-400 shrink-0 mr-1">
          Preset:
        </span>
        {Object.entries(MOCK_SCENARIOS).map(([key, sc]) => {
          const isActive = activeScenarioId === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => applyScenario(key)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all whitespace-nowrap cursor-pointer shrink-0 border ${
                isActive
                  ? 'bg-emerald-600 text-white border-emerald-500 shadow-xs'
                  : 'bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border-zinc-800'
              }`}
            >
              {sc.name}
            </button>
          );
        })}
      </div>

      {/* Realistic Windows 11 Desktop Window Wrapper */}
      <div className="w-[580px] max-w-full rounded-xl shadow-2xl border border-zinc-300/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden ring-1 ring-black/5 dark:ring-white/10 transition-all">
        {DialogContent}
      </div>

      {/* Dimension Label */}
      <div className="w-[580px] max-w-full mt-2.5 px-2 flex items-center justify-between text-[11px] text-zinc-500 font-mono">
        <span>Native Dialog Size: 580 × 380 px</span>
        <span>Press <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 text-[10px]">Enter</kbd> to Start • <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 text-[10px]">Esc</kbd> to Cancel</span>
      </div>

      {/* Interactive Feedback Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl bg-zinc-900 text-white border border-zinc-700 shadow-2xl flex items-center gap-2 text-xs font-medium z-50 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
