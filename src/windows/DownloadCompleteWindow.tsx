import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/Button';
import { 
  Sun,
  Moon,
  ArrowLeft,
  Monitor,
  FolderCheck, 
  ExternalLink, 
  FolderOpen, 
  Folder,
  Link2,
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
import { LogicalSize } from '@tauri-apps/api/dpi';

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatCompactMiddle(value: string, maxLength = 58, tailLength = 15): string {
  if (!value || value.length <= maxLength) return value;
  const headLength = Math.max(12, maxLength - tailLength - 1);
  return `${value.slice(0, headLength)}…${value.slice(-tailLength)}`;
}

function formatCompactUrl(rawUrl: string): string {
  if (!rawUrl || rawUrl.length <= 60) return rawUrl;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.origin && parsed.origin.length <= 48 && rawUrl.startsWith(parsed.origin)) {
      const tailBudget = Math.max(10, 58 - parsed.origin.length);
      return `${parsed.origin}/…${rawUrl.slice(-tailBudget)}`;
    }
  } catch {
    // Fall back to generic middle truncation for non-standard URLs
  }
  return formatCompactMiddle(rawUrl, 58, 15);
}

function formatCompactPath(filePath: string): string {
  if (!filePath || filePath.length <= 58) return filePath;
  const lastSep = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
  if (lastSep > 0 && lastSep <= 38) {
    const dir = filePath.slice(0, lastSep + 1);
    const tailBudget = Math.max(12, 57 - dir.length);
    return `${dir}…${filePath.slice(-tailBudget)}`;
  }
  return formatCompactMiddle(filePath, 58, 16);
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
        .setSize(new LogicalSize(580, height))
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

  const detailRows = [
    {
      key: 'url' as const,
      label: 'Address',
      icon: <Link2 className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 shrink-0" />,
      rawValue: displayUrl,
      displayValue: formatCompactUrl(displayUrl),
      placeholder: 'https://...',
      copyTitle: 'Copy URL',
    },
    {
      key: 'path' as const,
      label: 'Saved to',
      icon: <Folder className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 shrink-0" />,
      rawValue: displayPath,
      displayValue: formatCompactPath(displayPath),
      placeholder: 'C:\\Downloads\\...',
      copyTitle: 'Copy Path',
    },
  ];

  const CompleteCard = (
    <div
      ref={cardRef}
      data-testid="download-complete-card"
      className="w-full flex flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans select-none overflow-hidden transition-shadow"
    >
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

      {/* Main Body - Symmetric 16px Padding on All Sides Without Extra Blank Space */}
      <div className="p-4 flex flex-col gap-3.5 overflow-hidden text-xs">
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
            <div className="text-xs text-zinc-500 dark:text-zinc-400 font-medium flex items-center gap-1.5">
              <span>Downloaded</span>
              <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                {formattedSize}
              </span>
            </div>
          </div>
        </div>

        {/* Unified Details Card - Crisp Middle-Truncated Address & Save Location */}
        <div className="rounded-xl border border-zinc-200/90 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/70 divide-y divide-zinc-200/80 dark:divide-zinc-800/80 overflow-hidden">
          {detailRows.map((row) => (
            <div key={row.key} className="px-3 py-2 flex items-center gap-2.5 min-w-0">
              <div className="w-[78px] shrink-0 flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                {row.icon}
                <span>{row.label}</span>
              </div>
              <span
                title={row.rawValue || row.placeholder}
                className={`min-w-0 flex-1 truncate text-[11.5px] leading-4 ${
                  row.rawValue
                    ? 'text-zinc-800 dark:text-zinc-200 select-all'
                    : 'text-zinc-400 dark:text-zinc-500 italic'
                }`}
              >
                {row.rawValue ? row.displayValue : row.placeholder}
              </span>
              {row.rawValue ? (
                <button
                  type="button"
                  onClick={() => copyToClipboard(row.rawValue, row.key)}
                  className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-medium border transition-colors cursor-pointer ${
                    copiedField === row.key
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/70'
                      : 'bg-white dark:bg-zinc-800/90 text-zinc-600 dark:text-zinc-300 border-zinc-200/90 dark:border-zinc-700/80 hover:border-zinc-300 dark:hover:border-zinc-600 hover:text-zinc-900 dark:hover:text-white shadow-2xs'
                  }`}
                  title={row.copyTitle}
                >
                  {copiedField === row.key ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedField === row.key ? 'Copied' : 'Copy'}</span>
                </button>
              ) : null}
            </div>
          ))}
        </div>

        {/* Action Buttons Row (Open, Open with..., Open folder, Close) */}
        <div className="grid grid-cols-4 gap-2 pt-0.5">
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
        <span>Native Dialog Size: 580 × {measuredHeight} px</span>
        <span>One-View Mode (No Vertical Scroll)</span>
      </div>
    </div>
  );
};
