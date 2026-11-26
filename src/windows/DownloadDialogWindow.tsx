import React, { useEffect, useState, useCallback, useRef } from 'react';
import { 
  X, 
  Folder, 
  Copy, 
  Check, 
  HardDrive, 
  FileBox, 
  CheckCircle2,
  Sun,
  Moon,
  RotateCcw,
  ArrowRight,
  Monitor,
  Link2,
  ClipboardPaste,
  FileText,
  Shield,
  Mail,
  Lock
} from 'lucide-react';
import { useHardwareBanStore } from '../stores/hardwareBanStore';
import { initHardwareEventService } from '../services/hardwareEventService';
import { 
  addDownload, 
  closeDownloadDialog, 
  getDefaultDownloadDir, 
  setDefaultDownloadDir, 
  getDiskFreeSpace, 
  openFolderPicker, 
  probeUrl, 
  onOpenDownloadInfoModal, 
  getDownloadDialogPayload,
  restoreManagerWindow,
  getClipboardText,
  extractSizeFromUrl,
  checkIsHardwareBanned,
  onHardwareBanChanged,
  DownloadInfoModalPayload,
  isTauri,
  openExternalUrl,
  getDownexWebBaseUrl
} from '../services/tauriService';
import { 
  getCachedDownloadDir, 
  setCachedDownloadDir, 
  getCachedDiskFreeSpace, 
  setCachedDiskFreeSpace 
} from '../services/modalPreload';
import { MarqueeFileName } from '../components/MarqueeFileName';

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
  const [savePath, setSavePath] = useState<string>(getCachedDownloadDir);
  const [freeSpaceBytes, setFreeSpaceBytes] = useState<number | null>(getCachedDiskFreeSpace);
  const [rememberPath, setRememberPath] = useState(true);
  const [totalBytes, setTotalBytes] = useState<number | undefined>();
  const [supportsRanges, setSupportsRanges] = useState(true);
  const [isProbing, setIsProbing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [incomingHeaders, setIncomingHeaders] = useState<Record<string, string> | undefined>();

  // Browser sandbox state
  const [activeScenarioId, setActiveScenarioId] = useState<string>('iso');
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(() => {
    try {
      const explicit = localStorage.getItem('downex_theme_explicit');
      return explicit === 'true' && localStorage.getItem('downex_theme') === 'dark';
    } catch {
      return false;
    }
  });
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((current) => (current === msg ? null : current));
    }, 3200);
  }, []);



  // Reactive hardware ban state
  const isBanned = useHardwareBanStore((state) => state.isBanned);
  const hwid = useHardwareBanStore((state) => state.hwid);
  const banReason = useHardwareBanStore((state) => state.banReason);

  useEffect(() => {
    useHardwareBanStore.getState().initBanStatus();
    const cleanup = initHardwareEventService();
    const unlistenBan = onHardwareBanChanged(async (payload) => {
      if (isTauri) {
        const confirmed = await checkIsHardwareBanned().catch(() => Boolean(payload.is_banned));
        useHardwareBanStore.getState().setBannedLive(confirmed, payload.reason);
      } else {
        useHardwareBanStore.getState().setBannedLive(Boolean(payload.is_banned), payload.reason);
      }
    });
    return () => {
      unlistenBan();
      cleanup();
    };
  }, []);

  const baseUrl = getDownexWebBaseUrl();
  const termsUrl = `${baseUrl}/terms#dos-and-donts`;
  const policiesUrl = `${baseUrl}/privacy`;
  const hardwarePatchUrl = `${baseUrl}/terms#hardware-enforcement`;

  const handleOpenTerms = (e: React.MouseEvent) => {
    e.preventDefault();
    openExternalUrl(termsUrl);
  };

  const handleOpenPolicies = (e: React.MouseEvent) => {
    e.preventDefault();
    openExternalUrl(policiesUrl);
  };

  const handleOpenHardwarePatch = (e: React.MouseEvent) => {
    e.preventDefault();
    openExternalUrl(hardwarePatchUrl);
  };

  const [copiedId, setCopiedId] = useState(false);
  const probeSeqRef = useRef(0);
  const handleCopyId = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!hwid) return;
    try {
      await navigator.clipboard.writeText(hwid);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = hwid;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  const handleOpenManager = async () => {
    try {
      await restoreManagerWindow();
      if (isTauri) {
        await closeDownloadDialog();
      }
    } catch {}
  };

  const banSubtitle =
    banReason &&
    banReason !== 'Administrative hardware ban enforced.' &&
    banReason !== 'You have been banned from App Owner' &&
    banReason !== 'You have been banned from ADMIN'
      ? banReason
      : 'This is hardware patched. Formatting System and reinstalling App will not bypass this.';

  // Sync theme immediately
  useEffect(() => {
    if (isDarkTheme) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkTheme]);

  // Update free disk space whenever savePath changes (saves to synchronous cache)
  useEffect(() => {
    if (!savePath) return;
    let cancelled = false;
    getDiskFreeSpace(savePath)
      .then((bytes) => {
        if (!cancelled && bytes > 0) {
          if (!isTauri && activeScenarioId === 'lowspace') {
            return;
          }
          setFreeSpaceBytes(bytes);
          setCachedDiskFreeSpace(bytes);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [savePath, activeScenarioId]);

  // Load default download directory on mount in background
  useEffect(() => {
    getDefaultDownloadDir().then((dir) => {
      if (dir && dir.trim()) {
        setSavePath(dir.trim());
        setCachedDownloadDir(dir.trim());
      }
    });
  }, []);

  // Update filename state helper
  const applyFilename = useCallback((fullName: string) => {
    if (!fullName || !fullName.trim()) {
      setFileBaseName('');
      setFileExtension('');
      return;
    }
    const { base, ext } = splitFilenameAndExt(fullName);
    setFileBaseName(base);
    setFileExtension(ext);
  }, []);

  // Dynamically sync when URL is empty or cleared
  useEffect(() => {
    const trimmed = url.trim();
    if (!trimmed) {
      probeSeqRef.current += 1;
      setFileBaseName('');
      setFileExtension('');
      setTotalBytes(undefined);
      setIsProbing(false);
      setIncomingHeaders(undefined);
    } else if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      probeSeqRef.current += 1;
      setTotalBytes(undefined);
      setIsProbing(false);
    }
  }, [url]);

  const applyPayload = useCallback((payload: DownloadInfoModalPayload) => {
    if (!payload || !payload.url) return;

    probeSeqRef.current += 1;
    setUrl(payload.url);
    const name = payload.filename || payload.url.split('?')[0].split('/').pop() || 'download.bin';
    applyFilename(name);

    if (payload.destination_folder && payload.destination_folder.trim()) {
      setSavePath(payload.destination_folder.trim());
    }

    if (isTauri) {
      checkIsHardwareBanned()
        .then((banned) => {
          if (banned) {
            useHardwareBanStore.getState().setBannedLive(true);
          }
        })
        .catch(() => {});
    }

    const next: Record<string, string> = {};
    if (payload.cookies) next['Cookie'] = payload.cookies;
    if (payload.referer) next['Referer'] = payload.referer;
    if (payload.user_agent) next['User-Agent'] = payload.user_agent;
    setIncomingHeaders(Object.keys(next).length > 0 ? next : undefined);

    if (payload.supports_ranges !== undefined) {
      setSupportsRanges(payload.supports_ranges);
    }

    const detectedSize = (payload.total_bytes && payload.total_bytes > 0)
      ? payload.total_bytes
      : extractSizeFromUrl(payload.url);

    if (detectedSize && detectedSize > 0) {
      setTotalBytes(detectedSize);
      setIsProbing(false);
    } else {
      setTotalBytes(undefined);
      void probeServer(payload.url);
    }
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
    const seq = ++probeSeqRef.current;
    const preSize = extractSizeFromUrl(targetUrl);
    if (preSize && preSize > 0) {
      setTotalBytes(preSize);
    }
    setIsProbing(true);
    try {
      const result = await probeUrl(targetUrl);
      if (seq !== probeSeqRef.current) return;
      if (result) {
        if (result.filename) {
          applyFilename(result.filename);
        }
        if (result.total_bytes && result.total_bytes > 0) {
          setTotalBytes(result.total_bytes);
        }
        if (result.supports_ranges !== undefined) {
          setSupportsRanges(result.supports_ranges);
        }
      }
    } catch (e) {
      console.warn('Probe error:', e);
    } finally {
      if (seq === probeSeqRef.current) {
        setIsProbing(false);
        setTotalBytes((prev) => prev || extractSizeFromUrl(targetUrl));
      }
    }
  };

  const handleBrowseFolder = async () => {
    try {
      const selected = await openFolderPicker();
      if (selected) {
        setSavePath(selected);
      } else if (!isTauri) {
        // Browser quick folder choices
        const choices = ['C:\\Users\\User\\Downloads', 'D:\\Downloads\\ISOs', 'E:\\Media\\Videos', 'C:\\Software\\Packages'];
        const nextChoice = choices[(choices.indexOf(savePath) + 1) % choices.length] || choices[0];
        setSavePath(nextChoice);
        showToast(`Selected mock folder: ${nextChoice}`);
      }
    } catch (e) {
      console.warn('Folder picker error:', e);
    }
  };

  const handleClose = async () => {
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
    probeSeqRef.current += 1;
    setUrl('');
    setFileBaseName('');
    setFileExtension('');
    setTotalBytes(undefined);
    setIsProbing(false);
    setActiveScenarioId('');
    setIncomingHeaders(undefined);
    showToast('Form cleared (Empty state)');
  };

  const handleStartDownload = async (startImmediately: boolean) => {
    if (submitting || !url.trim()) return;
    try {
      const parsed = new URL(url.trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        showToast('Only http:// and https:// URLs are supported');
        return;
      }
    } catch {
      showToast('Please enter a valid http:// or https:// URL');
      return;
    }

    setSubmitting(true);
    try {
      const sanitizedRawName = (fileBaseName.trim() + fileExtension.trim())
        .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
        .trim();
      const fullFilename = sanitizedRawName || undefined;

      // Persist chosen directory if "Remember this folder" is checked
      if (rememberPath && savePath.trim()) {
        try {
          await setDefaultDownloadDir(savePath.trim());
          setCachedDownloadDir(savePath.trim());
        } catch (e) {
          console.warn('Could not save default download directory:', e);
        }
      }

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
        showToast(`Failed to initiate download: ${err instanceof Error ? err.message : String(err)}`);
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
        if (isBanned) {
          e.preventDefault();
          handleClose();
          return;
        }
        const tag = document.activeElement?.tagName;
        if (tag === 'BUTTON' || tag === 'A') return;
        if (url.trim() && !submitting) {
          e.preventDefault();
          handleStartDownload(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [url, fileBaseName, fileExtension, savePath, incomingHeaders, rememberPath, submitting, isBanned]);

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
    <div className="w-full h-full flex flex-col justify-between bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans select-none overflow-hidden border border-zinc-200 dark:border-zinc-800">
      {/* Title Bar */}
      <div 
        data-tauri-drag-region
        className="h-8 px-3.5 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 select-none cursor-move shrink-0"
      >
        <div data-tauri-drag-region className="flex items-center gap-2">
          <span data-tauri-drag-region className="font-mono-tabular text-[10.5px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400 font-semibold">
            NEW DOWNLOAD
          </span>
          {isProbing && !!url.trim() && (
            <span className="text-[10px] font-mono-tabular text-zinc-400 ml-1 animate-pulse">
              Checking size...
            </span>
          )}
        </div>
        <button
          onClick={handleClose}
          title="Close (Esc)"
          className="p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer focus:outline-none"
        >
          <X className="w-3.5 h-3.5 stroke-[1.8]" />
        </button>
      </div>

      {/* Main Form Body */}
      <div className="p-3.5 space-y-2.5 flex-1 flex flex-col justify-between">
        {/* Row 1: File Name */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-semibold text-zinc-900 dark:text-zinc-100">
              File Name
            </label>
            <span className="text-[10px] font-mono-tabular text-zinc-400">
              RENAME IF NEEDED
            </span>
          </div>
          <div className="flex items-center border border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50 focus-within:border-black dark:focus-within:border-white transition-colors">
            <div className="pl-2.5 pr-1.5 text-zinc-400 dark:text-zinc-500">
              <FileBox className="w-3.5 h-3.5" />
            </div>
            <input
              type="text"
              required={!!url.trim()}
              placeholder={url.trim() ? "Filename" : "Enter or paste download link below..."}
              value={fileBaseName}
              onChange={(e) => setFileBaseName(e.target.value)}
              className="flex-1 py-1.5 text-[12px] font-mono-tabular font-medium text-zinc-900 dark:text-zinc-100 bg-transparent focus:outline-none placeholder:text-zinc-400/80"
            />
            {fileExtension && (!!url.trim() || !!fileBaseName.trim()) && (
              <span className="px-1.5 py-0.5 mr-2 text-[10px] font-mono-tabular font-semibold bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 uppercase shrink-0">
                .{fileExtension.replace(/^\./, '')}
              </span>
            )}
          </div>
        </div>

        {/* Row 2: Streamlined Info Strip */}
        <div className="grid grid-cols-2 gap-2">
          <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-950/40 px-2.5 py-1.5 flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-[9.5px] uppercase font-mono-tabular text-zinc-400 leading-tight">File Size</div>
              <div className="font-mono-tabular text-[12.5px] font-bold text-zinc-900 dark:text-zinc-100 leading-snug truncate">
                {url.trim() ? (isProbing ? 'Checking...' : formatBytes(totalBytes)) : '—'}
              </div>
            </div>
            {url.trim() ? (
              <span className={`text-[9.5px] font-mono-tabular px-1.5 py-0.5 border shrink-0 ${
                supportsRanges
                  ? 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5'
                  : 'border-zinc-300 dark:border-zinc-700 text-zinc-500'
              }`}>
                {supportsRanges ? 'RESUME OK' : 'SINGLE'}
              </span>
            ) : (
              <span className="text-[9.5px] font-mono-tabular px-1.5 py-0.5 border border-zinc-200 dark:border-zinc-800 text-zinc-400 shrink-0">
                WAITING
              </span>
            )}
          </div>

          <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-950/40 px-2.5 py-1.5 flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-[9.5px] uppercase font-mono-tabular text-zinc-400 leading-tight">Connections</div>
              <div className="font-mono-tabular text-[12.5px] font-bold text-zinc-900 dark:text-zinc-100 leading-snug truncate">
                {url.trim() ? (supportsRanges ? '32 Threads' : '1 Stream') : '32 Threads'}
              </div>
            </div>
            <span className="text-[9.5px] font-mono-tabular text-zinc-400 uppercase shrink-0">
              {url.trim() ? 'PARALLEL' : 'DEFAULT'}
            </span>
          </div>
        </div>

        {/* Row 3: Destination Folder + Live Disk Free Space */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-semibold text-zinc-900 dark:text-zinc-100">
              Save To
            </label>
            {freeSpaceBytes !== null && (
              <span className={`text-[10px] font-mono-tabular flex items-center gap-1 ${
                isLowSpace 
                  ? 'text-rose-500 font-bold animate-pulse' 
                  : 'text-zinc-400'
              }`}>
                <HardDrive className="w-3 h-3" />
                <span>{formatBytes(freeSpaceBytes)} free</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <input
                type="text"
                value={savePath}
                onChange={(e) => setSavePath(e.target.value)}
                placeholder="Destination folder path"
                className="w-full px-2.5 py-1.5 pl-8 border border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-950/50 text-[11px] font-mono-tabular text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-black dark:focus:border-white transition-colors"
              />
              <Folder className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            <button
              type="button"
              onClick={handleBrowseFolder}
              className="h-7.5 px-3 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-mono-tabular text-[10px] uppercase tracking-wider shrink-0 cursor-pointer"
            >
              Browse
            </button>
          </div>
        </div>

        {/* Row 4: Source URL (Interactive input with Paste & Copy actions) */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-semibold text-zinc-900 dark:text-zinc-100">
              Source URL
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePasteClipboard}
                className="text-[10px] font-mono-tabular font-semibold text-emerald-600 dark:text-emerald-400 hover:underline transition-colors flex items-center gap-1 cursor-pointer"
              >
                <ClipboardPaste className="w-3 h-3" />
                <span>PASTE</span>
              </button>
              {url && (
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="text-[10px] font-mono-tabular text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors flex items-center gap-1 cursor-pointer"
                >
                  {copiedUrl ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedUrl ? 'COPIED' : 'COPY'}</span>
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center border border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-950/50 focus-within:border-black dark:focus-within:border-white transition-colors px-2.5 py-1">
            <Link2 className="w-3.5 h-3.5 text-zinc-400 mr-2 shrink-0" />
            <input
              type="text"
              required
              autoFocus={!url}
              placeholder="Paste download link (https://...)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex-1 text-[11px] font-mono-tabular text-zinc-900 dark:text-zinc-100 bg-transparent focus:outline-none placeholder:text-zinc-400"
            />
            {url && (
              <button
                type="button"
                onClick={() => setUrl('')}
                className="p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer ml-1"
                title="Clear URL"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Bar: Quick Options & Actions */}
      <div className="px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between shrink-0 mt-auto">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={rememberPath}
            onChange={(e) => setRememberPath(e.target.checked)}
            className="w-3.5 h-3.5 rounded-none border-zinc-300 accent-black dark:accent-white cursor-pointer"
          />
          <span className="text-[11px] text-zinc-600 dark:text-zinc-400 font-mono-tabular">
            Remember folder
          </span>
        </label>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleClose}
            className="h-7.5 px-3 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-mono-tabular text-[11px] uppercase tracking-wider hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={!url.trim()}
            onClick={() => handleStartDownload(false)}
            className="h-7.5 px-3 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-mono-tabular text-[11px] uppercase tracking-wider hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
            title="Add to queue in paused state"
          >
            Later
          </button>

          <button
            type="button"
            disabled={!url.trim() || submitting}
            onClick={() => handleStartDownload(true)}
            className={`h-7.5 px-3.5 font-mono-tabular text-[11px] uppercase tracking-wider font-semibold cursor-pointer border disabled:opacity-50 ${
              submitting
                ? 'bg-zinc-400 text-white border-zinc-400'
                : 'bg-black text-white border-black hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:border-white dark:hover:bg-zinc-200'
            }`}
          >
            {submitting ? 'Starting...' : 'Start Download'}
          </button>
        </div>
      </div>
    </div>
  );

  const BannedDialogContent = (
    <div className="w-full h-full flex flex-col justify-between bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans select-none overflow-hidden border border-zinc-200 dark:border-zinc-800 shadow-2xl">
      {/* Title Bar Strip - Matching OG modal subtlety */}
      <div
        data-tauri-drag-region
        className="h-8 px-3.5 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 select-none cursor-move shrink-0"
      >
        <div data-tauri-drag-region className="flex items-center gap-2">
          <span
            data-tauri-drag-region
            className="font-mono-tabular text-[10.5px] uppercase tracking-wider text-red-500 dark:text-red-400 font-semibold"
          >
            DOWNLOAD RESTRICTED
          </span>
        </div>
        <button
          onClick={handleClose}
          title="Close (Esc)"
          className="p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer focus:outline-none"
        >
          <X className="w-3.5 h-3.5 stroke-[1.8]" />
        </button>
      </div>

      {/* Subtle & Symmetric Banned Body (Evenly spaced, inspired by Download Manager Banned UI) */}
      <div className="px-5 py-1 flex flex-col items-center justify-evenly text-center flex-1 overflow-hidden">
        {/* Top Group: BAN! + Heading + Highlighted Readable Subtitle with Read more */}
        <div className="flex flex-col items-center gap-1.5 max-w-[440px]">
          <span className="inline-flex items-center px-5 py-1 bg-red-500 text-white font-mono-tabular text-[11px] font-black uppercase tracking-widest rounded-xs select-none mb-0.5">
            BAN!
          </span>
          <h2 className="text-[15px] font-bold text-zinc-950 dark:text-zinc-50 tracking-tight font-sans">
            You have been banned from ADMIN
          </h2>
          <p className="text-[12px] text-zinc-800 dark:text-zinc-200 font-medium leading-[1.5] max-w-[385px]">
            {banSubtitle === 'This is hardware patched. Formatting System and reinstalling App will not bypass this.' ? (
              <>
                <span className="font-semibold text-zinc-950 dark:text-white">This is hardware patched.</span>{' '}
                Formatting System and reinstalling App will not bypass this.
              </>
            ) : (
              <span>{banSubtitle}</span>
            )}{' '}
            <a
              href={hardwarePatchUrl}
              onClick={handleOpenHardwarePatch}
              className="text-zinc-950 dark:text-white hover:text-red-600 dark:hover:text-red-400 font-semibold underline underline-offset-2 cursor-pointer font-mono-tabular text-[11px] inline-flex items-center gap-0.5 transition-colors whitespace-nowrap"
              title="Learn why formatting will not bypass this ban"
            >
              <span>Read more</span>
              <ArrowRight className="w-2.5 h-2.5 stroke-[2.2]" />
            </a>
          </p>
        </div>

        {/* Full-Width Intercepted File Preview */}
        {(fileBaseName.trim() || url.trim()) && (
          <div
            className="w-full max-w-[450px] px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-800 text-[11px] font-mono-tabular flex items-center justify-start gap-2.5 rounded-xs text-left overflow-hidden"
            style={{ textAlign: 'left' }}
          >
            <Lock className="w-3.5 h-3.5 text-red-500 dark:text-red-400 shrink-0" />
            <MarqueeFileName name={(fileBaseName.trim() + fileExtension.trim()) || url.trim()} />
            <span className="text-[9.5px] uppercase font-bold text-red-500 dark:text-red-400 px-1.5 py-0.5 bg-red-500/10 rounded-xs shrink-0 font-mono-tabular">
              Blocked
            </span>
          </div>
        )}

        {/* Terms & Policies Pill Buttons */}
        <div className="flex items-center justify-center gap-2">
          <a
            href={termsUrl}
            onClick={handleOpenTerms}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xs bg-zinc-100 hover:bg-zinc-200/80 dark:bg-zinc-800/60 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-zinc-50 transition-colors cursor-pointer border border-zinc-200/80 dark:border-zinc-700/60 text-[10.5px] font-mono-tabular font-medium"
          >
            <FileText className="w-3 h-3" />
            <span>Terms</span>
          </a>
          <span className="text-zinc-300 dark:text-zinc-700 text-xs">&bull;</span>
          <a
            href={policiesUrl}
            onClick={handleOpenPolicies}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xs bg-zinc-100 hover:bg-zinc-200/80 dark:bg-zinc-800/60 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-zinc-50 transition-colors cursor-pointer border border-zinc-200/80 dark:border-zinc-700/60 text-[10.5px] font-mono-tabular font-medium"
          >
            <Shield className="w-3 h-3" />
            <span>Policies</span>
          </a>
        </div>

        {/* Owner Contact (Evenly spaced independently) */}
        <div className="text-[10.5px] font-mono-tabular text-zinc-600 dark:text-zinc-400 flex items-center justify-center gap-1.5">
          <Mail className="w-3 h-3 text-zinc-400 dark:text-zinc-500" />
          <span>Owner Contact:</span>
          <a
            href="mailto:hello@gauravpatil.site"
            className="text-zinc-950 dark:text-zinc-100 hover:text-red-600 dark:hover:text-red-400 hover:underline font-semibold transition-colors"
          >
            hello@gauravpatil.site
          </a>
        </div>

        {/* ID Footer Row (Evenly spaced above bottom bar) */}
        {hwid && (
          <div className="inline-flex items-center gap-1.5 text-[10px] font-mono-tabular text-zinc-500 dark:text-zinc-400 select-text">
            <span className="text-zinc-400 dark:text-zinc-500 text-[9px] uppercase tracking-wider font-semibold">ID:</span>
            <span className="text-zinc-800 dark:text-zinc-200 font-medium">{hwid}</span>
            <button
              type="button"
              onClick={handleCopyId}
              title={copiedId ? 'Copied to clipboard!' : 'Copy ID'}
              className="p-0.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer transition-colors"
            >
              {copiedId ? <Check className="w-2.5 h-2.5 text-emerald-500" /> : <Copy className="w-2.5 h-2.5" />}
            </button>
          </div>
        )}
      </div>

      {/* Bottom Bar Strip - Matching OG modal footer height */}
      <div className="px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5 text-[10.5px] font-mono-tabular text-zinc-500 dark:text-zinc-400">
          <Lock className="w-3 h-3 text-red-500 dark:text-red-400" />
          <span>Download disabled</span>
        </div>
        <button
          type="button"
          onClick={handleOpenManager}
          className="h-7.5 px-3.5 font-mono-tabular text-[10.5px] uppercase tracking-wider font-semibold cursor-pointer bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-200 dark:text-zinc-950 dark:hover:bg-white rounded-xs transition-colors flex items-center gap-1.5"
        >
          <span>Open Download Manager</span>
          <ArrowRight className="w-3 h-3 stroke-[2]" />
        </button>
      </div>
    </div>
  );

  const ActiveDialogContent = isBanned ? BannedDialogContent : DialogContent;

  // If running natively in Tauri desktop, render pure frameless window directly
  if (isTauri) {
    return (
      <div className="w-screen h-screen flex flex-col bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 font-sans select-none overflow-hidden">
        {ActiveDialogContent}
      </div>
    );
  }

  // If running in browser preview mode, wrap inside interactive desktop preview stage
  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-zinc-900 via-zinc-950 to-black text-zinc-100 flex flex-col items-center justify-center p-4 sm:p-6 relative font-sans selection:bg-emerald-500 selection:text-white">
      {/* Floating Dev Sandbox Navigation Bar */}
      <div className="w-[540px] max-w-full mb-3 px-3 py-2 rounded bg-zinc-900/90 border border-zinc-800/90 backdrop-blur-md flex flex-wrap items-center justify-between gap-2 shadow-xl ring-1 ring-white/5">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-semibold tracking-tight text-zinc-200">
            Download Dialog Sandbox
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-xs">
          {/* Toggle Banned Mode */}
          <button
            type="button"
            onClick={() => useHardwareBanStore.getState().setBannedLive(!isBanned)}
            className={`px-2 py-1 rounded text-[11px] font-medium font-mono-tabular transition-colors cursor-pointer ${
              isBanned ? 'bg-red-600 text-white' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
            }`}
            title="Toggle Banned State Preview"
          >
            {isBanned ? 'BAN: ON' : 'BAN: OFF'}
          </button>

          {/* Theme Toggle */}
          <button
            type="button"
            onClick={() => setIsDarkTheme(!isDarkTheme)}
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
            title={isDarkTheme ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
          >
            {isDarkTheme ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>

          {/* Reset / Clear */}
          <button
            type="button"
            onClick={handleClearForm}
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Clear Form / Test Blank State"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* Link to Download Complete Modal */}
          <a
            href="/?window=download_complete"
            className="px-2 py-1 rounded text-[11px] font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors flex items-center gap-1 cursor-pointer"
            title="Inspect Download Complete Window"
          >
            <span>Complete Modal</span>
            <ArrowRight className="w-3 h-3" />
          </a>

          {/* Link to Full Main App */}
          <a
            href="/"
            className="px-2 py-1 rounded text-[11px] font-medium text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/50 border border-emerald-900/60 transition-colors flex items-center gap-1 cursor-pointer"
            title="Go to Main Downex Dashboard"
          >
            <Monitor className="w-3 h-3" />
            <span>App</span>
          </a>
        </div>
      </div>

      {/* Scenario Pills Selector */}
      <div className="w-[540px] max-w-full mb-3 flex items-center gap-1.5 overflow-x-auto pb-1 text-xs select-none scrollbar-none">
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
              className={`px-2 py-0.5 text-[10px] font-mono-tabular transition-all whitespace-nowrap cursor-pointer shrink-0 border ${
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
      <div className="w-[540px] max-w-full shadow-2xl border border-zinc-300/80 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden ring-1 ring-black/5 dark:ring-white/10 transition-all">
        {DialogContent}
      </div>

      {/* Dimension Label */}
      <div className="w-[540px] max-w-full mt-2.5 px-2 flex items-center justify-between text-[11px] text-zinc-500 font-mono-tabular">
        <span>Dialog Size: 540 px</span>
        <span>Enter: Start • Esc: Cancel</span>
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
