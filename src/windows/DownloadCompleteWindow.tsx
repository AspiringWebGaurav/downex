import React, { useEffect, useState } from 'react';
import { Button } from '../components/ui/Button';
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
  onDownloadCompleted, 
  onOpenDownloadCompleteModal,
  restoreManagerWindow,
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

export const DownloadCompleteWindow: React.FC = () => {
  const [payload, setPayload] = useState<DownloadCompletePayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dontShowAgain, setDontShowAgain] = useState(() => {
    try {
      return localStorage.getItem('downex_dont_show_complete_dialog') === 'true';
    } catch {
      return false;
    }
  });
  const [copiedField, setCopiedField] = useState<'url' | 'path' | null>(null);
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(() => {
    try {
      return localStorage.getItem('downex_theme') !== 'light';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (isDarkTheme) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('downex_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('downex_theme', 'light');
    }
  }, [isDarkTheme]);
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

  // Apply dark mode theme from localStorage
  useEffect(() => {
    try {
      const theme = localStorage.getItem('downex_theme');
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    } catch {}
  }, []);

  // Fetch initial dynamic payload on mount or listen for completed downloads
  useEffect(() => {
    // 1. Check if user already disabled this dialog
    if (dontShowAgain && isTauri) {
      closeDownloadCompleteDialog();
      return;
    }

    // 2. Fetch payload from Rust backend (close window if no valid download payload)
    getDownloadCompletePayload().then((p) => {
      if (p && p.url && p.url.trim()) {
        setPayload(p);
        setIsLoading(false);
      } else {
        if (isTauri) {
          closeDownloadCompleteDialog();
        } else {
          setPayload(DEFAULT_BROWSER_COMPLETE_MOCK);
          setIsLoading(false);
        }
      }
    }).catch(() => {
      if (isTauri) {
        closeDownloadCompleteDialog();
      } else {
        setPayload(DEFAULT_BROWSER_COMPLETE_MOCK);
        setIsLoading(false);
      }
    });

    // 3. Listen to live events (both live completions and manual details triggers)
    const handleIncoming = (p: DownloadCompletePayload) => {
      if (dontShowAgain && isTauri) {
        closeDownloadCompleteDialog();
        return;
      }
      if (p && p.url && p.url.trim()) {
        setPayload(p);
        setIsLoading(false);
      }
    };

    const unlistenCompleted = onDownloadCompleted(handleIncoming);
    const unlistenOpen = onOpenDownloadCompleteModal(handleIncoming);

    return () => {
      unlistenCompleted();
      unlistenOpen();
    };
  }, [dontShowAgain]);

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

  const handleDontShowChange = (checked: boolean) => {
    setDontShowAgain(checked);
    try {
      localStorage.setItem('downex_dont_show_complete_dialog', String(checked));
    } catch {}
  };

  const copyToClipboard = (text: string, field: 'url' | 'path') => {
    try {
      navigator.clipboard?.writeText(text).catch(() => {});
    } catch {}
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  const totalBytes = payload?.total_bytes || payload?.downloaded_bytes || 0;
  const formattedSize = formatBytes(totalBytes);
  const exactBytes = totalBytes.toLocaleString();

  const CompleteCard = (
    <div className="w-[580px] max-w-full flex flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans select-none border border-zinc-300/80 dark:border-zinc-800 shadow-2xl rounded-xl overflow-hidden">
      {/* Titlebar (Draggable with standard window buttons) */}
      <div
        data-tauri-drag-region
        className="h-9 px-3 bg-zinc-100 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between cursor-default shrink-0"
      >
        <div data-tauri-drag-region className="flex items-center gap-2">
          <img src="/icon.png" alt="Downex" className="w-4 h-4 rounded-xs shrink-0" />
          <span data-tauri-drag-region className="font-semibold text-xs text-zinc-800 dark:text-zinc-200">
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

      {/* Main Body */}
      <div className="flex-1 p-4 flex flex-col justify-between overflow-y-auto space-y-3.5 text-xs">
        {isLoading && !payload ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 py-8 text-zinc-400">
            <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <span className="font-mono text-xs">Loading download details</span>
          </div>
        ) : !payload ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 py-6 text-center">
            <p className="text-zinc-500 dark:text-zinc-400 text-xs">
              No recent download details available.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  await restoreManagerWindow();
                  handleClose();
                }}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs cursor-pointer shadow-xs transition-all"
              >
                Open Downex
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="px-3 py-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-medium text-xs cursor-pointer hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-all"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Header Tribute: Folder with Files & Size in MB + Bytes */}
            <div className="flex items-start gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shrink-0 shadow-md relative group">
                <FolderCheck className="w-6 h-6 stroke-[2]" />
                <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-400 border-2 border-white dark:border-zinc-950 flex items-center justify-center">
                  <FileCheck className="w-2.5 h-2.5 text-emerald-950 stroke-[3]" />
                </span>
              </div>

              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-bold text-sm tracking-tight text-zinc-900 dark:text-zinc-100 truncate" title={payload?.filename}>
                    {payload?.filename || 'Download Complete'}
                  </h2>
                  <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/20 shrink-0">
                    100% Complete
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs font-mono text-zinc-600 dark:text-zinc-400">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">Downloaded {formattedSize}</span>
                  <span className="text-zinc-300 dark:text-zinc-700">•</span>
                  <span>{exactBytes} Bytes</span>
                </div>
              </div>
            </div>

            {/* Address (URL) Input Field */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                <span>Address</span>
                {payload?.url && (
                  <button
                    type="button"
                    onClick={() => copyToClipboard(payload.url, 'url')}
                    className="text-[10px] text-blue-600 hover:text-blue-700 dark:text-blue-400 flex items-center gap-1 cursor-pointer"
                    title="Copy URL"
                  >
                    {copiedField === 'url' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedField === 'url' ? 'Copied' : 'Copy'}</span>
                  </button>
                )}
              </div>
              <input
                type="text"
                readOnly
                value={payload?.url || ''}
                className="w-full text-xs font-mono bg-zinc-50 dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800 rounded-md px-2.5 py-1.5 text-zinc-800 dark:text-zinc-200 select-all outline-none focus:border-zinc-400 dark:focus:border-zinc-600 transition-colors"
              />
            </div>

            {/* The file saved as (Destination Path) Input Field */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                <span>The file saved as</span>
                {payload?.destination_path && (
                  <button
                    type="button"
                    onClick={() => copyToClipboard(payload.destination_path, 'path')}
                    className="text-[10px] text-blue-600 hover:text-blue-700 dark:text-blue-400 flex items-center gap-1 cursor-pointer"
                    title="Copy Path"
                  >
                    {copiedField === 'path' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedField === 'path' ? 'Copied' : 'Copy'}</span>
                  </button>
                )}
              </div>
              <input
                type="text"
                readOnly
                value={payload?.destination_path || ''}
                className="w-full text-xs font-mono bg-zinc-50 dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800 rounded-md px-2.5 py-1.5 text-zinc-800 dark:text-zinc-200 select-all outline-none focus:border-zinc-400 dark:focus:border-zinc-600 transition-colors"
              />
            </div>

            {/* Action Buttons Row (Open, Open With, Open folder, Close) */}
            <div className="grid grid-cols-4 gap-2 pt-1">
              <Button
                variant="primary-emerald"
                size="md"
                icon={<ExternalLink className="w-3.5 h-3.5 stroke-[2.5]" />}
                onClick={async () => {
                  if (payload?.destination_path) {
                    await openFile(payload.destination_path);
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
                  if (payload?.destination_path) {
                    await openFileWith(payload.destination_path);
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
                  if (payload?.destination_path) {
                    await openFileFolder(payload.destination_path);
                    handleClose();
                  }
                }}
                title="Show in File Explorer"
              >
                Open folder
              </Button>

              <Button
                variant="secondary"
                size="md"
                onClick={handleClose}
                title="Close this dialog"
              >
                Close
              </Button>
            </div>
          </>
        )}

        {/* Footer: Don't show this dialog again checkbox & Downex badge */}
        <div className="flex items-center justify-between pt-1 border-t border-zinc-100 dark:border-zinc-900 text-[11px] text-zinc-500 dark:text-zinc-400">
          <label className="flex items-center gap-2 cursor-pointer select-none group">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => handleDontShowChange(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-zinc-300 dark:border-zinc-700 text-emerald-600 focus:ring-emerald-500 cursor-pointer accent-emerald-600"
            />
            <span className="group-hover:text-zinc-800 dark:group-hover:text-zinc-200 transition-colors">
              Don't show this dialog again
            </span>
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                await restoreManagerWindow();
              }}
              className="text-[10px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 underline cursor-pointer"
              title="Open main Downex window"
            >
              Show Downex
            </button>
            <span className="text-zinc-300 dark:text-zinc-700">•</span>
            <span className="text-[10px] font-mono text-zinc-400">Downex Core</span>
          </div>
        </div>
      </div>
    </div>
  );

  if (isTauri) {
    return (
      <div className="w-screen h-screen flex flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans select-none border border-zinc-300/80 dark:border-zinc-800 shadow-2xl rounded-lg overflow-hidden">
        {CompleteCard}
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-zinc-900 via-zinc-950 to-black text-zinc-100 flex flex-col items-center justify-center p-4 relative font-sans selection:bg-emerald-500 selection:text-white">
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

      {CompleteCard}

      <div className="w-[580px] max-w-full mt-2.5 px-2 flex items-center justify-between text-[11px] text-zinc-500 font-mono">
        <span>Native Dialog Size: 580 × 320 px</span>
        <span>Simulated Desktop Mode</span>
      </div>
    </div>
  );
};
