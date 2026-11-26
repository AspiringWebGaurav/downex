import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { X, Minus } from 'lucide-react';
import { getCloseToTray, isTauri, minimizeToBackground, onUiOpened, quitApp } from '../services/tauriService';
import { useDownloadStore } from '../stores/downloadStore';
import { useHardwareBanStore } from '../stores/hardwareBanStore';
import {
  useMarqueeNoticeStore,
  MarqueeNotice,
  resolveDesktopNoticeAppearance,
  computeMarqueeDurationSec,
  stripDuplicateNoticePrefix,
} from '../stores/marqueeNoticeStore';

function formatCountdown(expiresAt: number | null, now: number): string {
  if (expiresAt === null) return '';
  const diff = expiresAt - now;
  if (diff <= 0) return 'expired';
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return `${Math.max(1, secs)}s`;
}

export const DownexWindowHeader: React.FC = () => {
  const [isCloseHovered, setIsCloseHovered] = useState(false);
  const [isMinimizeHovered, setIsMinimizeHovered] = useState(false);
  const [closeToTray, setCloseToTray] = useState<boolean>(true);
  const closeToTrayRef = useRef<boolean>(true);
  const suppressHoverUntilRef = useRef<number>(Date.now() + 350);
  const hasRealPointerMoveRef = useRef<boolean>(false);
  const [isMarqueeHovered, setIsMarqueeHovered] = useState(false);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [playback, setPlayback] = useState<{
    currentId: string | null;
    lastIndex: number;
    cycleKey: number;
  }>({ currentId: null, lastIndex: 0, cycleKey: 0 });

  const hasActiveDownloads = useDownloadStore((state) =>
    state.items.some((i) => i.status === 'downloading' || i.status === 'probing')
  );
  const isBanned = useHardwareBanStore((state) => state.isBanned);
  const isReinstating = useHardwareBanStore((state) => state.isReinstating);
  const notices = useMarqueeNoticeStore((state) => state.notices);
  const noticePulse = useMarqueeNoticeStore((state) => state.noticePulse);
  const pruneExpired = useMarqueeNoticeStore((state) => state.pruneExpired);

  const activeNotices = useMemo(
    () =>
      notices
        .filter((n) => n.active && (n.expiresAt === null || n.expiresAt > nowTick))
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id))),
    [notices, nowTick]
  );

  const activePoolKey = activeNotices
    .map(
      (n) =>
        `${n.id}:${n.updatedAt || n.createdAt}:${n.text}:${n.tone}:${n.modeLabel || ''}:${n.modeColor || ''}:${n.direction}:${n.speed ?? 1}:${n.showCountdown}`
    )
    .join('|');

  const activeNoticesRef = useRef<MarqueeNotice[]>(activeNotices);
  activeNoticesRef.current = activeNotices;
  const lastCompletedCycleRef = useRef<number>(-1);

  // Preserve current scrolling notice when stack changes; only advance if current item expired/removed
  useEffect(() => {
    const currentPool = activeNoticesRef.current;
    if (currentPool.length === 0) {
      lastCompletedCycleRef.current = -1;
      setPlayback({ currentId: null, lastIndex: 0, cycleKey: 0 });
      return;
    }

    setPlayback((prev) => {
      const stillIdx = prev.currentId
        ? currentPool.findIndex((n) => n.id === prev.currentId)
        : -1;

      if (stillIdx !== -1) {
        if (stillIdx === prev.lastIndex) return prev;
        return {
          ...prev,
          lastIndex: stillIdx,
        };
      }

      const nextIdx =
        prev.lastIndex >= 0 && prev.lastIndex < currentPool.length ? prev.lastIndex : 0;
      return {
        currentId: currentPool[nextIdx].id,
        lastIndex: nextIdx,
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

  const handleMarqueeCycleEnd = useCallback((expectedCycleKey?: number) => {
    const currentPool = activeNoticesRef.current;
    if (currentPool.length === 0) return;

    if (typeof expectedCycleKey === 'number') {
      if (lastCompletedCycleRef.current === expectedCycleKey) {
        return;
      }
      lastCompletedCycleRef.current = expectedCycleKey;
    }

    setPlayback((prev) => {
      if (typeof expectedCycleKey === 'number' && prev.cycleKey !== expectedCycleKey) {
        return prev;
      }

      const prevIdx = prev.currentId
        ? currentPool.findIndex((n) => n.id === prev.currentId)
        : prev.lastIndex;
      const baseIdx = prevIdx >= 0 && prevIdx < currentPool.length ? prevIdx : 0;
      const nextIdx = (baseIdx + 1) % currentPool.length;
      const nextNotice = currentPool[nextIdx];

      return {
        currentId: nextNotice.id,
        lastIndex: nextIdx,
        cycleKey: prev.cycleKey + 1,
      };
    });
  }, []);

  const currentNotice = useMemo(() => {
    if (activeNotices.length === 0) return null;
    if (playback.currentId) {
      const found = activeNotices.find((n) => n.id === playback.currentId);
      if (found) return found;
    }
    const fallbackIdx =
      playback.lastIndex >= 0 && playback.lastIndex < activeNotices.length ? playback.lastIndex : 0;
    return activeNotices[fallbackIdx] || activeNotices[0];
  }, [activeNotices, playback.currentId, playback.lastIndex]);

  const cycleKey = playback.cycleKey;
  const showTitlebarMarquee = !isBanned && !isReinstating && currentNotice !== null;

  // Watchdog failsafe: advance cleanly if WebView2 suspends CSS animation frames across hide/show transitions
  useEffect(() => {
    if (!showTitlebarMarquee || !currentNotice || isMarqueeHovered) return;
    const displayText =
      stripDuplicateNoticePrefix(
        currentNotice.text,
        resolveDesktopNoticeAppearance(currentNotice).label,
        currentNotice.tone
      ) || currentNotice.text;
    const durationMs = computeMarqueeDurationSec(displayText, currentNotice.speed) * 1000;
    const activeCycle = cycleKey;
    const watchdog = window.setTimeout(() => {
      handleMarqueeCycleEnd(activeCycle);
    }, durationMs + 1200);
    return () => window.clearTimeout(watchdog);
  }, [showTitlebarMarquee, currentNotice, cycleKey, isMarqueeHovered, handleMarqueeCycleEnd]);

  useEffect(() => {
    suppressHoverUntilRef.current = Date.now() + 350;
    hasRealPointerMoveRef.current = false;

    const resetAndSuppressHover = () => {
      suppressHoverUntilRef.current = Date.now() + 350;
      hasRealPointerMoveRef.current = false;
      setIsCloseHovered(false);
      setIsMinimizeHovered(false);
    };

    const clearHoverOnly = () => {
      hasRealPointerMoveRef.current = false;
      setIsCloseHovered(false);
      setIsMinimizeHovered(false);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        resetAndSuppressHover();
      } else {
        clearHoverOnly();
      }
    };

    const handlePointerMove = () => {
      if (Date.now() >= suppressHoverUntilRef.current) {
        hasRealPointerMoveRef.current = true;
      }
    };

    const unlistenUiOpened = onUiOpened(() => {
      resetAndSuppressHover();
      getCloseToTray()
        .then((val) => {
          closeToTrayRef.current = val;
          setCloseToTray(val);
        })
        .catch(() => {});
    });

    getCloseToTray()
      .then((val) => {
        closeToTrayRef.current = val;
        setCloseToTray(val);
      })
      .catch(() => {});

    let unlistenClosePref: (() => void) | null = null;
    let isCancelled = false;
    if (isTauri) {
      import('@tauri-apps/api/event')
        .then(({ listen }) =>
          listen<{ enabled?: boolean }>('close-to-tray-changed', (ev) => {
            if (typeof ev.payload?.enabled === 'boolean') {
              closeToTrayRef.current = ev.payload.enabled;
              setCloseToTray(ev.payload.enabled);
            }
          })
        )
        .then((unsub) => {
          if (isCancelled) {
            unsub();
          } else {
            unlistenClosePref = unsub;
          }
        })
        .catch(() => {});
    }

    window.addEventListener('blur', clearHoverOnly);
    window.addEventListener('focus', resetAndSuppressHover);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('mouseleave', clearHoverOnly);
    window.addEventListener('pointermove', handlePointerMove, { passive: true, capture: true });

    return () => {
      isCancelled = true;
      unlistenUiOpened();
      if (unlistenClosePref) unlistenClosePref();
      window.removeEventListener('blur', clearHoverOnly);
      window.removeEventListener('focus', resetAndSuppressHover);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('mouseleave', clearHoverOnly);
      window.removeEventListener('pointermove', handlePointerMove, { capture: true });
    };
  }, []);

  const canActivateWindowControlHover = () =>
    hasRealPointerMoveRef.current && Date.now() >= suppressHoverUntilRef.current;

  const handleMinimizeToTray = async () => {
    hasRealPointerMoveRef.current = false;
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
    hasRealPointerMoveRef.current = false;
    setIsCloseHovered(false);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    try {
      const shouldHideToTray = await getCloseToTray().catch(() => closeToTrayRef.current);
      if (!shouldHideToTray && isTauri) {
        await quitApp();
        return;
      }
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
          const displayText =
            stripDuplicateNoticePrefix(currentNotice.text, appearance.label, currentNotice.tone) ||
            currentNotice.text;
          const countdownText =
            currentNotice.showCountdown && currentNotice.expiresAt !== null
              ? formatCountdown(currentNotice.expiresAt, nowTick)
              : '';
          const durationSec = computeMarqueeDurationSec(displayText, currentNotice.speed).toFixed(1);

          return (
            <div
              title={displayText}
              onMouseEnter={() => setIsMarqueeHovered(true)}
              onMouseLeave={() => setIsMarqueeHovered(false)}
              className={`downex-marquee-group relative h-[20px] w-full max-w-[430px] px-1 rounded-full border backdrop-blur-md overflow-hidden flex items-center transition-all duration-300 ${
                noticePulse
                  ? 'ring-2 ring-emerald-500/45 dark:ring-emerald-400/45'
                  : ''
              } ${appearance.glassClass}`}
            >
              <div className="downex-marquee-track relative w-full h-full flex items-center overflow-hidden">
                <div
                  key={`${currentNotice.id}-${cycleKey}`}
                  onAnimationEnd={() => handleMarqueeCycleEnd(cycleKey)}
                  style={{
                    animationDuration: `${durationSec}s`,
                    animationIterationCount: 1,
                  }}
                  className={`absolute inset-y-0 flex items-center whitespace-nowrap gap-1.5 font-mono-tabular text-[10px] leading-none font-medium tracking-[-0.01em] ${
                    currentNotice.direction === 'rtl'
                      ? 'downex-marquee-item-rtl'
                      : 'downex-marquee-item-ltr'
                  }`}
                >
                  <span
                    className={`inline-flex items-center justify-center h-[13px] px-1.5 rounded-full border text-[8.5px] font-bold uppercase tracking-[0.06em] leading-none shrink-0 ${appearance.badgeClass}`}
                  >
                    {appearance.label}
                  </span>
                  <span className="inline-flex items-center h-[13px] leading-none">{displayText}</span>
                  {countdownText && countdownText !== 'expired' && (
                    <span className="inline-flex items-center h-[13px] font-mono-tabular text-[9.5px] font-semibold leading-none opacity-80">
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
            onMouseEnter={() => {
              if (canActivateWindowControlHover()) setIsMinimizeHovered(true);
            }}
            onMouseMove={() => {
              if (canActivateWindowControlHover() && !isMinimizeHovered) setIsMinimizeHovered(true);
            }}
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
          onMouseEnter={() => {
            if (canActivateWindowControlHover()) setIsCloseHovered(true);
          }}
          onMouseMove={() => {
            if (canActivateWindowControlHover() && !isCloseHovered) setIsCloseHovered(true);
          }}
          onMouseLeave={() => setIsCloseHovered(false)}
          title={closeToTray ? 'Close to System Tray' : 'Exit Downex'}
          aria-label={closeToTray ? 'Close to System Tray' : 'Exit Downex'}
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
