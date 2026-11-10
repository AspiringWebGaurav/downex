import React, { useEffect, useState } from 'react';
import { Button } from '../components/ui/Button';
import { AutoScrollText } from '../components/ui/AutoScrollText';
import { 
  Sun,
  Moon,
  ArrowLeft,
  Monitor,
  FolderCheck, 
  ExternalLink, 
  FolderOpen, 
  X, 
  Minus, 
  Copy, 
  Check, 
  AppWindow,
  FileCheck
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
  const [isCloseHovered, setIsCloseHovered] = useState(false);
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(() => {
    try {
      return localStorage.getItem('downex_theme') !== 'light';
    } catch {
      return true;
    }
  });

  // Sync theme
  useEffect(() => {
    if (isDarkTheme) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('downex_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('downex_theme', 'light');
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
      setIsCloseHovered(false);
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

  const handleClose = async () => {
    setIsCloseHovered(false);
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

  const CompleteCard = (
    <div
      data-testid="download-complete-card"
      className={`w-full flex-1 flex flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans select-none overflow-hidden transition-shadow ${
      isTauri 
        ? 'h-full' 
        : 'w-[580px] h-[310px] max-w-full border border-zinc-300/80 dark:border-zinc-800 shadow-2xl rounded-xl'
    }`}>
      {/* Titlebar (Draggable with standard window buttons, dims slightly when blurred) */}
      <div
        data-tauri-drag-region
        className={`h-9 px-3 bg-zinc-100 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between cursor-default shrink-0 transition-opacity ${
          isWindowFocused ? 'opacity-100' : 'opacity-85'
        }`}
      >
        <div data-tauri-drag-region className="flex items-center gap-2">
          <img src="/icon.png" alt="Downex" className="w-4 h-4 rounded-xs shrink-0" />
          <span data-tauri-drag-region className={`font-semibold text-xs transition-colors ${
            isWindowFocused ? 'text-zinc-800 dark:text-zinc-200' : 'text-zinc-500 dark:text-zinc-400'
          }`}>
            Download complete
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleMinimize}
            className="w-6 h-6 rounded flex items-center justify-center text-zinc-500 hover:bg-zinc-200/80 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Minimize"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleClose}
            onMouseEnter={() => setIsCloseHovered(true)}
            onMouseLeave={() => setIsCloseHovered(false)}
            className={`w-6 h-6 rounded flex items-center justify-center transition-colors cursor-pointer focus:outline-none ${
              isCloseHovered
                ? 'bg-rose-500 text-white dark:bg-rose-600'
                : 'text-zinc-500 bg-transparent'
            }`}
            title="Close (Esc)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Body - Balanced Desktop Flow with Natural Vertical Rhythm */}
      <div className="flex-1 p-4 flex flex-col gap-3.5 overflow-hidden text-xs">
        {/* Top Header Tribute: Folder Check Icon + Filename + Complete Badge */}
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shrink-0 shadow-sm relative group">
            <FolderCheck className="w-5 h-5 stroke-[2]" />
            <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-white dark:border-zinc-950 flex items-center justify-center">
              <FileCheck className="w-2 h-2 text-emerald-950 stroke-[3]" />
            </span>
          </div>

          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-bold text-sm tracking-tight text-zinc-900 dark:text-zinc-100 truncate" title={displayFilename}>
                {displayFilename}
              </h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/20 shrink-0">
                100% Complete
              </span>
            </div>
            <div className="text-xs font-mono text-zinc-600 dark:text-zinc-400 font-medium">
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                Downloaded {formattedSize}
              </span>
            </div>
          </div>
        </div>

        {/* Address (URL) Input Field */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
            <span>Address</span>
            {displayUrl ? (
              <button
                type="button"
                onClick={() => copyToClipboard(displayUrl, 'url')}
                className="text-[10px] text-blue-600 hover:text-blue-700 dark:text-blue-400 flex items-center gap-1 cursor-pointer"
                title="Copy URL"
              >
                {copiedField === 'url' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                <span>{copiedField === 'url' ? 'Copied' : 'Copy'}</span>
              </button>
            ) : null}
          </div>
          <div className="w-full text-xs font-mono bg-zinc-50 dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 py-1.5 flex items-center overflow-hidden">
            <AutoScrollText
              text={displayUrl}
              className="text-xs font-mono text-zinc-800 dark:text-zinc-200"
              placeholder="https://..."
            />
          </div>
        </div>

        {/* The file saved as (Destination Path) Input Field */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
            <span>The file saved as</span>
            {displayPath ? (
              <button
                type="button"
                onClick={() => copyToClipboard(displayPath, 'path')}
                className="text-[10px] text-blue-600 hover:text-blue-700 dark:text-blue-400 flex items-center gap-1 cursor-pointer"
                title="Copy Path"
              >
                {copiedField === 'path' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                <span>{copiedField === 'path' ? 'Copied' : 'Copy'}</span>
              </button>
            ) : null}
          </div>
          <div className="w-full text-xs font-mono bg-zinc-50 dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 py-1.5 flex items-center overflow-hidden">
            <AutoScrollText
              text={displayPath}
              className="text-xs font-mono text-zinc-800 dark:text-zinc-200"
              placeholder="C:\Downloads\..."
            />
          </div>
        </div>

        {/* Action Buttons Row (Open, Open with..., Open folder, Close) */}
        <div className="grid grid-cols-4 gap-2 pt-1">
          <Button
            variant="primary-emerald"
            size="md"
            icon={<ExternalLink className="w-3.5 h-3.5 stroke-[2.5]" />}
            onClick={async () => {
              if (displayPath) {
                await openFile(displayPath);
                handleClose();
              }
            }}
            title="Open file with default program"
          >
            Open
          </Button>

          <Button
            variant="secondary"
            size="md"
            icon={<AppWindow className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />}
            onClick={async () => {
              if (displayPath) {
                await openFileWith(displayPath);
                handleClose();
              }
            }}
            title="Choose program to open with"
          >
            Open with...
          </Button>

          <Button
            variant="secondary"
            size="md"
            icon={<FolderOpen className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />}
            onClick={async () => {
              if (displayPath) {
                await openFileFolder(displayPath);
              } else {
                const defaultDir = await getDefaultDownloadDir();
                if (defaultDir) await openFileFolder(defaultDir);
              }
              handleClose();
            }}
            title="Show in File Explorer"
          >
            Open folder
          </Button>

          <Button
            variant="secondary"
            size="md"
            onClick={handleClose}
            title="Close this dialog (Esc)"
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );

  if (isTauri) {
    return (
      <div className="w-screen h-screen flex flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans select-none overflow-hidden">
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
      <div className="w-[580px] max-w-full mb-3 px-3 py-2 rounded-xl bg-zinc-900/90 border border-zinc-800/90 backdrop-blur-md flex items-center justify-between shadow-xl ring-1 ring-white/5">
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

      <div className="w-[580px] max-w-full rounded-xl shadow-2xl border border-zinc-300/80 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden ring-1 ring-black/5 dark:ring-white/10 transition-all flex flex-col">
        {CompleteCard}
      </div>

      <div className="w-[580px] max-w-full mt-2.5 px-2 flex items-center justify-between text-[11px] text-zinc-500 font-mono">
        <span>Native Dialog Size: 580 × 310 px</span>
        <span>One-View Mode (No Vertical Scroll)</span>
      </div>
    </div>
  );
};
