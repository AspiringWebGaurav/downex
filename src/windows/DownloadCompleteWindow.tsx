import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Sun,
  Moon,
  ArrowLeft,
  Monitor,
} from 'lucide-react';
import {
  DownloadCompletePayload,
  getDownloadCompletePayload,
  closeDownloadCompleteDialog,
  onDownloadCompleted,
  onOpenDownloadCompleteModal,
  isTauri,
} from '../services/tauriService';
import { DownloadCompleteModal } from '../components/DownloadCompleteModal';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { LogicalSize } from '@tauri-apps/api/dpi';

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
    const handleBlur = () => {
      if (isTauri) {
        try {
          getCurrentWebviewWindow().setAlwaysOnTop(false).catch(() => {});
        } catch {}
      }
    };
    const handleVisibilityChange = () => {
      if (document.hidden) handleBlur();
    };

    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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

  const CompleteCard = (
    <DownloadCompleteModal
      isStandalone
      standalonePayload={payload}
      onStandaloneClose={handleClose}
      cardRef={cardRef}
    />
  );

  if (isTauri) {
    return (
      <div className="w-screen flex flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans select-none overflow-hidden">
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
