import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { 
  Sun,
  Moon,
  ArrowLeft,
  Monitor,
  ExternalLink, 
  FolderOpen, 
  Folder,
  Link2,
  X, 
  Minus, 
  Copy, 
  Check, 
  AppWindow,
  FileBox
} from 'lucide-react';
import { 
  DownloadCompletePayload, 
  getDownloadCompletePayload, 
  closeDownloadCompleteDialog, 
  openFile, 
  openFileWith, 
  openFileFolder, 
  getDefaultDownloadDir,
  onDownloadCompleted, 
  onOpenDownloadCompleteModal,
  isTauri 
} from '../services/tauriService';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { LogicalSize } from '@tauri-apps/api/dpi';

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

const DEFAULT_BROWSER_COMPLETE_MOCK: DownloadCompletePayload = {
  id: 'mock-complete-1',
  url: 'https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso',
  filename: 'ubuntu-24.04-desktop-amd64.iso',
  destination_path: 'C:\\Users\\User\\Downloads\\ubuntu-24.04-desktop-amd64.iso',
  total_bytes: 6144000000,
  downloaded_bytes: 6144000000,
};

function getInitialCompletePayload(): DownloadCompletePayload | null {
  if (typeof window !== 'undefined') {
    if ((window as any).__DOWNEX_COMPLETE_PAYLOAD__) {
      return (window as any).__DOWNEX_COMPLETE_PAYLOAD__;
    }
    if ((window as any).__DOWNEX_MOCK_COMPLETE_PAYLOAD__) {
      return (window as any).__DOWNEX_MOCK_COMPLETE_PAYLOAD__;
    }
    try {
      const stored = localStorage.getItem('downex_last_complete_payload') || sessionStorage.getItem('downex_last_complete_payload');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && (parsed.url || parsed.filename)) return parsed;
      }
    } catch {}
  }
  if (!isTauri) {
    return DEFAULT_BROWSER_COMPLETE_MOCK;
  }
  return null;
}

export const DownloadCompleteWindow: React.FC = () => {
  const [payload, setPayload] = useState<DownloadCompletePayload | null>(getInitialCompletePayload);
  const [isWindowFocused, setIsWindowFocused] = useState<boolean>(true);
  const [copiedField, setCopiedField] = useState<'url' | 'path' | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const lastRequestedHeightRef = useRef<number>(0);
  const [measuredHeight, setMeasuredHeight] = useState<number>(249);
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(() => {
    try {
      const explicit = localStorage.getItem('downex_theme_explicit');
      return explicit === 'true' && localStorage.getItem('downex_theme') === 'dark';
    } catch {
      return false;
    }
  });

  // Sync theme
  useEffect(() => {
    if (isDarkTheme) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkTheme]);

  // Synchronous payload bridge from Rust window.eval
  useEffect(() => {
    (window as any).__onDownexCompletePayload = (p: DownloadCompletePayload) => {
      if (p && (p.url || p.filename)) {
        setPayload(p);
        try {
          const json = JSON.stringify(p);
          localStorage.setItem('downex_last_complete_payload', json);
          sessionStorage.setItem('downex_last_complete_payload', json);
        } catch {}
      }
    };
    return () => {
      delete (window as any).__onDownexCompletePayload;
    };
  }, []);

  // Out of focus handler: Cleanly yield focus and disable always-on-top when clicking elsewhere
  useEffect(() => {
    const handleFocus = () => {
      setIsWindowFocused(true);
    };

    const handleBlur = () => {
      setIsWindowFocused(false);
      if (isTauri) {
        try {
          getCurrentWebviewWindow().setAlwaysOnTop(false).catch(() => {});
        } catch {}
      }
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) handleBlur();
      else handleFocus();
    });

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // Fetch initial dynamic payload on mount and listen to live events
  useEffect(() => {
    // 1. Fetch from Rust backend
    getDownloadCompletePayload().then((p) => {
      if (p && (p.url || p.filename)) {
        setPayload(p);
        try {
          const json = JSON.stringify(p);
          localStorage.setItem('downex_last_complete_payload', json);
          sessionStorage.setItem('downex_last_complete_payload', json);
        } catch {}
      } else if (!isTauri && !payload) {
        setPayload(DEFAULT_BROWSER_COMPLETE_MOCK);
      }
    }).catch(() => {
      if (!isTauri && !payload) {
        setPayload(DEFAULT_BROWSER_COMPLETE_MOCK);
      }
    });

    // 2. Listen to live events (both live completions and manual details triggers)
    const handleIncoming = (p: DownloadCompletePayload) => {
      if (p && (p.url || p.filename)) {
        setPayload(p);
        try {
          const json = JSON.stringify(p);
          localStorage.setItem('downex_last_complete_payload', json);
          sessionStorage.setItem('downex_last_complete_payload', json);
        } catch {}
      }
    };

    const unlistenCompleted = onDownloadCompleted(handleIncoming);
    const unlistenOpen = onOpenDownloadCompleteModal(handleIncoming);

    return () => {
      unlistenCompleted();
      unlistenOpen();
    };
  }, []);

  // Handle Esc key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Dynamically size native Tauri window to fit symmetric card height with zero extra blank space
  const syncWindowHeight = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    const height = Math.ceil(el.getBoundingClientRect().height);
    if (height <= 0) return;
    setMeasuredHeight((prev) => (prev === height ? prev : height));
    if (!isTauri) return;
    if (Math.abs(window.innerHeight - height) >= 1 && lastRequestedHeightRef.current !== height) {
      lastRequestedHeightRef.current = height;
      getCurrentWebviewWindow()
        .setSize(new LogicalSize(540, height))
        .catch(() => {});
    }
  }, []);

  useLayoutEffect(() => {
    lastRequestedHeightRef.current = 0;
    syncWindowHeight();
    const raf = requestAnimationFrame(syncWindowHeight);
    return () => cancelAnimationFrame(raf);
  }, [payload, syncWindowHeight]);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      syncWindowHeight();
    });
    observer.observe(el);
    window.addEventListener('resize', syncWindowHeight);
    document.fonts?.ready?.then(syncWindowHeight).catch(() => {});
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncWindowHeight);
    };
  }, [syncWindowHeight]);

  const handleClose = async () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    if (isTauri) {
      await closeDownloadCompleteDialog();
    } else {
      window.close();
    }
  };

  const handleMinimize = async () => {
    if (isTauri) {
      try {
        const win = getCurrentWebviewWindow();
        await win.minimize();
      } catch {}
    }
  };

  const copyToClipboard = (text: string, field: 'url' | 'path') => {
    try {
      navigator.clipboard?.writeText(text).catch(() => {});
    } catch {}
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  const totalBytes = payload?.total_bytes || payload?.downloaded_bytes || 0;
  const formattedSize = totalBytes > 0 ? formatBytes(totalBytes) : 'Complete';
  const displayFilename = payload?.filename || 'Download Complete';
  const displayUrl = payload?.url || '';
  const displayPath = payload?.destination_path || '';

  const lastDot = displayFilename.lastIndexOf('.');
  const fileBaseName = lastDot > 0 ? displayFilename.slice(0, lastDot) : displayFilename;
  const fileExtension = lastDot > 0 ? displayFilename.slice(lastDot + 1).toUpperCase() : '';

  const handleOpenFile = async () => {
    if (displayPath) {
      await openFile(displayPath);
      handleClose();
    }
  };

  const handleOpenWith = async () => {
    if (displayPath) {
      await openFileWith(displayPath);
      handleClose();
    }
  };

  const handleOpenFolder = async () => {
    if (displayPath) {
      await openFileFolder(displayPath);
    } else {
      const defaultDir = await getDefaultDownloadDir();
      if (defaultDir) await openFileFolder(defaultDir);
    }
    handleClose();
  };

  const CompleteCard = (
    <div
      ref={cardRef}
      data-testid="download-complete-card"
      className="w-full flex flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans select-none overflow-hidden transition-shadow"
    >
      {/* Titlebar (Industrial Design Language 1:1 Matching New Download Modal) */}
      <div
        data-tauri-drag-region
        className={`h-8 px-3.5 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between select-none cursor-move shrink-0 transition-opacity ${
          isWindowFocused ? 'opacity-100' : 'opacity-85'
        }`}
      >
        <div data-tauri-drag-region className="flex items-center gap-2">
          <span
            data-tauri-drag-region
            className="font-mono-tabular text-[10.5px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400 font-semibold"
          >
            DOWNLOAD COMPLETE
          </span>
          <span data-tauri-drag-region className="text-[10px] font-mono-tabular text-zinc-400">
            TASK SAVED 100%
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleMinimize}
            className="w-5 h-5 flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer focus:outline-none"
            title="Minimize"
          >
            <Minus className="w-3.5 h-3.5 stroke-[1.8]" />
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="w-5 h-5 flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer focus:outline-none"
            title="Close (Esc)"
          >
            <X className="w-3.5 h-3.5 stroke-[1.8]" />
          </button>
        </div>
      </div>

      {/* Main Form Body - Industrial 1:1 Matching New Download Modal */}
      <div className="p-3.5 space-y-2.5 flex-1 flex flex-col justify-between overflow-hidden text-xs">
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
          <div className="flex items-center border border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50 px-2.5 py-1.5 gap-2">
            <div className="text-zinc-400 dark:text-zinc-500 shrink-0">
              <FileBox className="w-3.5 h-3.5" />
            </div>
            <span
              className="flex-1 font-mono-tabular text-[12px] font-semibold text-zinc-900 dark:text-zinc-100 truncate select-all"
              title={displayFilename}
            >
              {fileBaseName}
            </span>
            {fileExtension && (
              <span className="px-1.5 py-0.5 text-[10px] font-mono-tabular font-semibold bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 uppercase shrink-0">
                .{fileExtension}
              </span>
            )}
          </div>
        </div>

        {/* Row 2: Streamlined Info Strip (2 Columns) */}
        <div className="grid grid-cols-2 gap-2">
          {/* File Size */}
          <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-950/40 px-2.5 py-1.5 flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-[9.5px] uppercase font-mono-tabular text-zinc-400 leading-tight">File Size</div>
              <div className="font-mono-tabular text-[12.5px] font-bold text-zinc-900 dark:text-zinc-100 leading-snug truncate">
                {formattedSize}
              </div>
            </div>
            <span className="text-[9.5px] font-mono-tabular px-1.5 py-0.5 border border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 shrink-0">
              100% COMPLETE
            </span>
          </div>

          {/* Storage / Integrity */}
          <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-950/40 px-2.5 py-1.5 flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-[9.5px] uppercase font-mono-tabular text-zinc-400 leading-tight">Storage</div>
              <div className="font-mono-tabular text-[12.5px] font-bold text-zinc-900 dark:text-zinc-100 leading-snug truncate">
                Verified on Disk
              </div>
            </div>
            <span className="text-[9.5px] font-mono-tabular text-zinc-400 uppercase shrink-0">
              LOCAL DISK
            </span>
          </div>
        </div>

        {/* Row 3: Destination Folder (Save To) */}
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
            <div className="relative flex-1 flex items-center border border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-950/50 px-2.5 py-1 min-w-0">
              <Folder className="w-3.5 h-3.5 text-zinc-400 mr-2 shrink-0" />
              <span
                className="flex-1 text-[11px] font-mono-tabular text-zinc-900 dark:text-zinc-100 truncate select-all"
                title={displayPath}
              >
                {displayPath}
              </span>
            </div>
            <button
              type="button"
              onClick={() => copyToClipboard(displayPath, 'path')}
              className="h-7.5 px-2.5 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-mono-tabular text-[10px] uppercase tracking-wider shrink-0 cursor-pointer flex items-center gap-1"
              title="Copy folder/file path"
            >
              {copiedField === 'path' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3 text-zinc-400" />}
              <span>{copiedField === 'path' ? 'COPIED' : 'COPY'}</span>
            </button>
            <button
              type="button"
              onClick={handleOpenFolder}
              className="h-7.5 px-3 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-mono-tabular text-[10px] uppercase tracking-wider shrink-0 cursor-pointer flex items-center gap-1"
              title="Show in File Explorer"
            >
              <FolderOpen className="w-3.5 h-3.5 text-zinc-400" />
              <span>OPEN FOLDER</span>
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
              {copiedField === 'url' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
              <span>{copiedField === 'url' ? 'COPIED' : 'COPY'}</span>
            </button>
          </div>
          <div className="flex items-center border border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-950/50 px-2.5 py-1">
            <Link2 className="w-3.5 h-3.5 text-zinc-400 mr-2 shrink-0" />
            <span
              className="flex-1 text-[11px] font-mono-tabular text-zinc-900 dark:text-zinc-100 truncate select-all"
              title={displayUrl}
            >
              {displayUrl}
            </span>
          </div>
        </div>

        {/* Bottom Actions Strip */}
        <div className="pt-2 flex items-center justify-between border-t border-zinc-200 dark:border-zinc-800 mt-1 shrink-0">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleOpenWith}
              className="h-7.5 px-2.5 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-mono-tabular text-[10px] uppercase tracking-wider text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Choose application to open this file"
            >
              <AppWindow className="w-3 h-3 text-zinc-400" />
              <span>Open With...</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="h-7.5 px-3.5 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-mono-tabular text-[10px] uppercase tracking-wider text-zinc-700 dark:text-zinc-300 cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleOpenFile}
              className="h-7.5 px-4 bg-zinc-900 hover:bg-black dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 font-mono-tabular text-[10.5px] uppercase tracking-wider font-bold shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Open File</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (isTauri) {
    return (
      <div className="w-screen min-h-screen flex flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans select-none overflow-hidden">
        {CompleteCard}
      </div>
    );
  }

  return (
    <div 
      className="min-h-screen w-full bg-gradient-to-br from-zinc-900 via-zinc-950 to-black text-zinc-100 flex flex-col items-center justify-center p-4 relative font-sans selection:bg-emerald-500 selection:text-white"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
    >
      {/* Dev Control Bar */}
      <div className="w-[540px] max-w-full mb-3 px-3 py-2 rounded-xl bg-zinc-900/90 border border-zinc-800/90 backdrop-blur-md flex items-center justify-between shadow-xl ring-1 ring-white/5">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-semibold text-zinc-200">
            Download Complete Sandbox
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setIsDarkTheme(!isDarkTheme)}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
            title={isDarkTheme ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
          >
            {isDarkTheme ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>

          <a
            href="/?window=download_dialog"
            className="px-2 py-1 rounded-lg text-[11px] font-medium text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/50 border border-emerald-900/60 transition-colors flex items-center gap-1 cursor-pointer"
            title="Go to Download Dialog Window"
          >
            <ArrowLeft className="w-3 h-3" />
            <span>Dialog Modal</span>
          </a>

          <a
            href="/"
            className="px-2 py-1 rounded-lg text-[11px] font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors flex items-center gap-1 cursor-pointer"
            title="Go to Main App"
          >
            <Monitor className="w-3 h-3" />
            <span>App</span>
          </a>
        </div>
      </div>

      <div className="w-[540px] max-w-full rounded-xl shadow-2xl border border-zinc-300/80 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden ring-1 ring-black/5 dark:ring-white/10 transition-all flex flex-col">
        {CompleteCard}
      </div>

      <div className="w-[540px] max-w-full mt-2.5 px-2 flex items-center justify-between text-[11px] text-zinc-500 font-mono">
        <span>Native Dialog Size: 540 × {measuredHeight} px</span>
        <span>One-View Mode (No Vertical Scroll)</span>
      </div>
    </div>
  );
};
