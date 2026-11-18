import React, { useState, useEffect } from 'react';
import { X, Minus } from 'lucide-react';
import { minimizeToBackground } from '../services/tauriService';
import { useDownloadStore } from '../stores/downloadStore';

export const DownexWindowHeader: React.FC = () => {
  const [isCloseHovered, setIsCloseHovered] = useState(false);
  const [isMinimizeHovered, setIsMinimizeHovered] = useState(false);

  const hasActiveDownloads = useDownloadStore((state) =>
    state.items.some((i) => i.status === 'downloading' || i.status === 'probing')
  );

  useEffect(() => {
    const clearHover = () => {
      setIsCloseHovered(false);
      setIsMinimizeHovered(false);
    };

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

  const handleMinimizeToTray = async () => {
    setIsMinimizeHovered(false);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    try {
      await minimizeToBackground();
    } catch (err) {
      console.error('Failed to minimize to tray:', err);
      try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const win = getCurrentWebviewWindow();
        await win.hide();
      } catch (fallbackErr) {
        console.error('Fallback minimize error:', fallbackErr);
      }
    }
  };

  const handleClose = async () => {
    setIsCloseHovered(false);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    try {
      await minimizeToBackground();
    } catch (err) {
      console.error('Failed to minimize to background:', err);
      try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const win = getCurrentWebviewWindow();
        await win.hide();
      } catch (fallbackErr) {
        console.error('Fallback close error:', fallbackErr);
      }
    }
  };

  return (
    <div
      data-tauri-drag-region
      className="relative z-40 flex items-center justify-between h-9 px-3 bg-white/95 dark:bg-zinc-950/95 border-b border-zinc-200/80 dark:border-zinc-800/80 select-none backdrop-blur-md shrink-0 w-full"
    >
      {/* Brand: downex download manager (green like before) */}
      <div className="flex items-center gap-2 select-none" data-tauri-drag-region>
        <img src="/icon.png" alt="Downex" className="w-4.5 h-4.5 shrink-0 object-contain pointer-events-none" />
        <span className="font-extrabold text-[13.5px] tracking-tight text-zinc-900 dark:text-zinc-100 pointer-events-none leading-none">
          downex
        </span>
        <span className="text-[9.5px] font-bold text-emerald-600 dark:text-emerald-400 tracking-[0.14em] uppercase font-mono pointer-events-none leading-none">
          download manager
        </span>
      </div>

      {/* Draggable Title Area */}
      <div className="flex-1 h-full" data-tauri-drag-region />

      {/* Window Controls */}
      <div className="flex items-center gap-0.5">
        {hasActiveDownloads && (
          <button
            type="button"
            onClick={handleMinimizeToTray}
            onMouseEnter={() => setIsMinimizeHovered(true)}
            onMouseLeave={() => setIsMinimizeHovered(false)}
            title="Minimise to System Tray (Active downloads running in background)"
            aria-label="Minimise to System Tray"
            className={`group relative w-8 h-6 flex items-center justify-center rounded-[2px] transition-colors duration-100 cursor-pointer focus:outline-none ${
              isMinimizeHovered
                ? 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                : 'text-zinc-400 dark:text-zinc-500 bg-transparent'
            }`}
          >
            <Minus className="w-3.5 h-3.5 stroke-[2.2]" />
          </button>
        )}
        <button
          type="button"
          onClick={handleClose}
          onMouseEnter={() => setIsCloseHovered(true)}
          onMouseLeave={() => setIsCloseHovered(false)}
          title="Close to System Tray"
          aria-label="Close to System Tray"
          className={`group relative w-8 h-6 flex items-center justify-center rounded-[2px] transition-colors duration-100 cursor-pointer focus:outline-none ${
            isCloseHovered
              ? 'bg-[#e81123] text-white'
              : 'text-zinc-400 dark:text-zinc-500 bg-transparent'
          }`}
        >
          <X className="w-3.5 h-3.5 stroke-[2.2]" />
        </button>
      </div>
    </div>
  );
};
