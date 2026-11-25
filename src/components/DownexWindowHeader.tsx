import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { X, Minus } from 'lucide-react';
import { minimizeToBackground } from '../services/tauriService';
import { useDownloadStore } from '../stores/downloadStore';
import { useHardwareBanStore } from '../stores/hardwareBanStore';
import { useMarqueeNoticeStore, MarqueeNotice, resolveDesktopNoticeAppearance } from '../stores/marqueeNoticeStore';

function buildShuffledQueue(list: MarqueeNotice[], avoidFirstId?: string): MarqueeNotice[] {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  if (arr.length > 1 && avoidFirstId && arr[0].id === avoidFirstId) {
    const swapIdx = 1 + Math.floor(Math.random() * (arr.length - 1));
    [arr[0], arr[swapIdx]] = [arr[swapIdx], arr[0]];
  }
  return arr;
}

function formatCountdown(expiresAt: number | null, now: number): string {
  if (expiresAt === null) return '';
  const diff = expiresAt - now;
  if (diff <= 0) return 'expired';
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${Math.max(1, mins)}m`;
}

export const DownexWindowHeader: React.FC = () => {
  const [isCloseHovered, setIsCloseHovered] = useState(false);
  const [isMinimizeHovered, setIsMinimizeHovered] = useState(false);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [playback, setPlayback] = useState<{
    items: MarqueeNotice[];
    index: number;
    cycleKey: number;
  }>({ items: [], index: 0, cycleKey: 0 });

  const hasActiveDownloads = useDownloadStore((state) =>
    state.items.some((i) => i.status === 'downloading' || i.status === 'probing')
  );
  const isBanned = useHardwareBanStore((state) => state.isBanned);
  const isReinstating = useHardwareBanStore((state) => state.isReinstating);
  const notices = useMarqueeNoticeStore((state) => state.notices);
  const noticePulse = useMarqueeNoticeStore((state) => state.noticePulse);
  const pruneExpired = useMarqueeNoticeStore((state) => state.pruneExpired);

  const activeNotices = useMemo(
    () => notices.filter((n) => n.active && (n.expiresAt === null || n.expiresAt > nowTick)),
    [notices, nowTick]
  );

  const activePoolKey = activeNotices
    .map((n) => `${n.id}:${n.updatedAt || n.createdAt}:${n.text}:${n.tone}:${n.direction}:${n.showCountdown}`)
    .join('|');

  const activeNoticesRef = useRef<MarqueeNotice[]>(activeNotices);
  activeNoticesRef.current = activeNotices;

  // Reshuffle playback queue ONLY when the active notice set actually changes (never on 1s countdown ticks)
  useEffect(() => {
    const currentPool = activeNoticesRef.current;
    if (currentPool.length === 0) {
      setPlayback((prev) => ({ items: [], index: 0, cycleKey: prev.cycleKey + 1 }));
      return;
    }
    setPlayback((prev) => {
      const lastId = prev.items[prev.index]?.id;
      return {
        items: buildShuffledQueue(currentPool, lastId),
        index: 0,
        cycleKey: prev.cycleKey + 1,
      };
    });
  }, [activePoolKey]);

  // Run lightweight 1s tick ONLY when at least one notice has an expiry timer or live countdown
  useEffect(() => {
    const needsTick = notices.some((n) => n.expiresAt !== null || n.showCountdown);
    if (!needsTick) return;
    const id = window.setInterval(() => {
      setNowTick(Date.now());
      pruneExpired();
    }, 1000);
    return () => window.clearInterval(id);
  }, [notices, pruneExpired]);

  const handleMarqueeCycleEnd = useCallback(() => {
    const currentPool = activeNoticesRef.current;
    if (currentPool.length === 0) return;
    setPlayback((prev) => {
      const nextIdx = prev.index + 1;
      if (nextIdx < prev.items.length) {
        return {
          items: prev.items,
          index: nextIdx,
          cycleKey: prev.cycleKey + 1,
        };
      }
      const lastShown = prev.items[prev.index]?.id;
      return {
        items: buildShuffledQueue(currentPool, lastShown),
        index: 0,
        cycleKey: prev.cycleKey + 1,
      };
    });
  }, []);

  const currentNotice = playback.items[playback.index] || activeNotices[0] || null;
  const cycleKey = playback.cycleKey;
  const showTitlebarMarquee = !isBanned && !isReinstating && currentNotice !== null;

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

      {/* Draggable Title Area + Frosted Glass Live Notice Marquee */}
      <div className="flex-1 h-full flex items-center justify-center px-3 min-w-0" data-tauri-drag-region>
        {showTitlebarMarquee && currentNotice && (() => {
          const appearance = resolveDesktopNoticeAppearance(currentNotice);
          const countdownText =
            currentNotice.showCountdown && currentNotice.expiresAt !== null
              ? formatCountdown(currentNotice.expiresAt, nowTick)
              : '';
          const durationSec = Math.min(
            18,
            Math.max(8, 7 + currentNotice.text.length * 0.085)
          ).toFixed(1);

          return (
            <div
              title={currentNotice.text}
              className={`downex-marquee-group relative h-[24px] w-full max-w-[420px] rounded-full border backdrop-blur-md overflow-hidden flex items-center transition-all duration-300 ${
                noticePulse
                  ? 'ring-1 ring-emerald-500/50 dark:ring-emerald-400/50'
                  : ''
              } ${appearance.glassClass}`}
            >
              <div className="downex-marquee-track relative w-full h-full overflow-hidden">
                <div
                  key={`${currentNotice.id}-${cycleKey}`}
                  onAnimationEnd={handleMarqueeCycleEnd}
                  style={{
                    animationDuration: `${durationSec}s`,
                    animationIterationCount: 1,
                  }}
                  className={`absolute inset-y-0 flex items-center whitespace-nowrap gap-1.5 text-[11px] leading-none font-medium ${
                    currentNotice.direction === 'rtl'
                      ? 'downex-marquee-item-rtl'
                      : 'downex-marquee-item-ltr'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${appearance.dotClass}`} />
                  <span className="font-semibold uppercase tracking-wide opacity-80 leading-none">
                    {appearance.label}:
                  </span>
                  <span className="leading-none">{currentNotice.text}</span>
                  {countdownText && countdownText !== 'expired' && (
                    <span className="font-mono-tabular text-[10.5px] leading-none opacity-75">
                      ({countdownText})
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </div>

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
