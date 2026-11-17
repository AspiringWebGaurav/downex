import React, { useState, useEffect, useRef } from 'react';
import { X, Minus } from 'lucide-react';
import { minimizeToBackground } from '../services/tauriService';
import { useAppVersionStore } from '../stores/appVersionStore';
import { useDownloadStore } from '../stores/downloadStore';
import { compareSemver } from '../utils/version';

export const DownexWindowHeader: React.FC = () => {
  const currentVersion = useAppVersionStore((state) => state.currentVersion);
  const status = useAppVersionStore((state) => state.status);
  const checkForUpdates = useAppVersionStore((state) => state.checkForUpdates);
  const [isCloseHovered, setIsCloseHovered] = useState(false);
  const [isMinimizeHovered, setIsMinimizeHovered] = useState(false);

  // Dynamically monitor active downloads (downloading or probing)
  const hasActiveDownloads = useDownloadStore((state) =>
    state.items.some((i) => i.status === 'downloading' || i.status === 'probing')
  );

  // Cleanly reset hover state on window blur, focus, or visibility changes
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

  // CP 1:1 Parity Dynamic Version UI State Machine
  const isUpdating =
    status.state === 'downloading' ||
    status.state === 'verifying' ||
    status.state === 'ready' ||
    status.state === 'restarting';

  const hasUpdate =
    Boolean(status.targetVersion) &&
    (status.state === 'available' || isUpdating) &&
    compareSemver(status.targetVersion!, currentVersion) > 0;

  const isChecking = status.state === 'checking';
  const targetVersion = status.targetVersion;
  const updateProgressPct = status.progress?.percentage || 0;
  const isVerifying = status.state === 'verifying';
  const isInstalling = status.state === 'ready' || status.state === 'restarting';
  const pct = Math.min(100, Math.max(8, Math.round(updateProgressPct || 0)));

  const wasManualClickRef = useRef(false);
  const [showResultStage, setShowResultStage] = useState(false);
  const resultTimerRef = useRef<number | null>(null);

  const handleButtonClick = () => {
    wasManualClickRef.current = true;
    checkForUpdates(false);
  };

  const prevCheckingRef = useRef(isChecking);
  useEffect(() => {
    if (prevCheckingRef.current && !isChecking && !isUpdating && !hasUpdate) {
      if (wasManualClickRef.current) {
        setShowResultStage(true);
        if (resultTimerRef.current !== null) {
          window.clearTimeout(resultTimerRef.current);
        }
        resultTimerRef.current = window.setTimeout(() => {
          setShowResultStage(false);
          wasManualClickRef.current = false;
          resultTimerRef.current = null;
        }, 1800);
      }
    }
    prevCheckingRef.current = isChecking;
  }, [isChecking, isUpdating, hasUpdate]);

  const otaStageText = (() => {
    if (isChecking) {
      return 'CHECKING';
    }
    if (showResultStage) {
      return 'UP TO DATE';
    }
    return '';
  })();

  const otaStageTone = (() => {
    if (isChecking) {
      return 'text-zinc-600 dark:text-zinc-300 font-semibold animate-pulse';
    }
    return 'text-zinc-700 dark:text-zinc-200 font-semibold';
  })();

  const stagePhaseKey = otaStageText ? (isChecking ? 'checking' : 'up_to_date') : '';

  const [displayedStage, setDisplayedStage] = useState(otaStageText);
  const [displayedTone, setDisplayedTone] = useState(otaStageTone);
  const [displayedPhaseKey, setDisplayedPhaseKey] = useState(stagePhaseKey);
  const [stageVisible, setStageVisible] = useState(Boolean(otaStageText));
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    if (otaStageText) {
      setDisplayedStage(otaStageText);
      setDisplayedTone(otaStageTone);
      setDisplayedPhaseKey(stagePhaseKey);
      let raf2 = 0;
      const raf1 = window.requestAnimationFrame(() => {
        raf2 = window.requestAnimationFrame(() => {
          setStageVisible(true);
        });
      });
      return () => {
        window.cancelAnimationFrame(raf1);
        window.cancelAnimationFrame(raf2);
      };
    }

    setStageVisible(false);
    hideTimerRef.current = window.setTimeout(() => {
      setDisplayedStage('');
      setDisplayedPhaseKey('');
      hideTimerRef.current = null;
    }, 520);

    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [otaStageText, otaStageTone, stagePhaseKey]);

  const rowWashClass = !otaStageText
    ? 'opacity-0'
    : isChecking
    ? 'opacity-100 bg-zinc-200/40 dark:bg-zinc-800/40'
    : 'opacity-100 bg-zinc-100/60 dark:bg-zinc-800/60';

  const showShimmer = isChecking && stageVisible;

  return (
    <div
      className="relative h-[48px] w-full flex items-center justify-between px-3 select-none bg-white dark:bg-zinc-950 z-20 shrink-0 border-b border-zinc-200/80 dark:border-zinc-800/60"
    >
      {/* Draggable Titlebar Area: Underlying region handles native window movement */}
      <div data-tauri-drag-region className="absolute inset-0 z-0 pointer-events-auto" />

      {/* Left Branding: Clean Pure Logo & Wordmark */}
      <div className="relative z-10 flex items-center gap-2 select-none">
        <img src="/icon-arrow.png" alt="Downex" className="w-5 h-5 object-contain shrink-0" />
        <span className="font-brand text-[21px] text-zinc-900 dark:text-zinc-100 tracking-wide leading-none">
          downex
        </span>
      </div>

      {/* Right Controls Lockup: 1:1 CP Borderless Blended Dynamic Version UI & Window Controls */}
      <div className="relative z-10 flex items-center gap-3 pointer-events-auto">
        <div className="flex items-center" data-testid="header-version-lockup">
          {isUpdating || hasUpdate ? (
            <div
              title={`Automated background update to v${targetVersion?.replace(/^v/, '') || ''} • ${Math.round(updateProgressPct || 0)}%`}
              className="group relative overflow-hidden inline-flex items-center gap-1.5 px-1.5 py-1 rounded-md text-zinc-600 dark:text-zinc-300 text-[11px] font-mono font-medium leading-none select-none transition-colors duration-200"
            >
              {/* Hairline Bottom Progress Bar (Neutral Zinc Track & Fill, Zero Green) */}
              <div
                aria-hidden="true"
                className="absolute inset-x-1 bottom-0 h-[1.5px] pointer-events-none overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
              >
                <div
                  className="h-full bg-zinc-600 dark:bg-zinc-300 transition-[width] duration-300 ease-out"
                  style={{ width: `${isInstalling || isVerifying ? 100 : pct}%` }}
                />
              </div>

              {/* Symmetrically Aligned Single-Line Lockup (Pure Monospace Symmetry, Zero Spinner, Zero Ellipsis) */}
              <span className="relative z-10 inline-flex items-center leading-none whitespace-nowrap">
                <span className="font-semibold text-zinc-700 dark:text-zinc-200 tracking-wide uppercase">
                  {status.state === 'restarting'
                    ? 'RESTARTING'
                    : status.state === 'verifying'
                    ? `VERIFYING V${targetVersion?.replace(/^v/i, '') || ''}`
                    : isInstalling
                    ? `INSTALLING V${targetVersion?.replace(/^v/i, '') || ''}`
                    : targetVersion
                    ? `UPDATING TO V${targetVersion.replace(/^v/i, '')}${updateProgressPct > 0 ? ` ${Math.round(updateProgressPct)}%` : ''}`
                    : 'UPDATING'}
                </span>
              </span>
            </div>
          ) : (
            <button
              data-testid="header-version-btn"
              type="button"
              onClick={handleButtonClick}
              disabled={isChecking}
              title={
                isChecking
                  ? 'Checking GPHost Cloudflare R2 for latest release...'
                  : 'GPHost release verified • Click to re-check'
              }
              className="group relative overflow-hidden inline-flex items-center px-1.5 py-1 rounded-md text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/70 transition-colors duration-200 cursor-pointer select-none font-mono text-[11px] font-medium leading-none"
            >
              {/* Ambient Dynamic Background Wash */}
              <div
                aria-hidden="true"
                className={`absolute inset-0 pointer-events-none rounded-md transition-opacity duration-500 ease-out ${rowWashClass}`}
              />

              {/* Shimmer Sweep Effect (Active during checking) */}
              {showShimmer && (
                <div
                  aria-hidden="true"
                  className="absolute inset-0 pointer-events-none overflow-hidden rounded-md"
                >
                  <div className="h-full w-2/3 animate-shimmer-sweep bg-gradient-to-r from-transparent via-zinc-900/[0.08] dark:via-zinc-100/[0.08] to-transparent" />
                </div>
              )}

              {/* Symmetrically Aligned Single-Line Lockup */}
              <span className="relative z-10 inline-flex items-center leading-none whitespace-nowrap gap-1.5">
                <span className="tracking-wide uppercase">
                  V{currentVersion?.replace(/^v/i, '')}
                </span>

                {/* Dynamic Stage Text (ScheduleMe in-place slide, fade, and expand on exact same line) */}
                {displayedStage ? (
                  <span
                    data-testid="header-version-stage"
                    className={`inline-flex items-center leading-none overflow-hidden whitespace-nowrap text-[11px] tracking-wide transition-[opacity,max-width,color] duration-500 ease-out ${displayedTone} ${
                      stageVisible
                        ? 'opacity-100 max-w-[120px]'
                        : 'opacity-0 max-w-0'
                    }`}
                  >
                    <span key={displayedPhaseKey} className="inline-block animate-fade-in font-semibold">
                      {displayedStage}
                    </span>
                  </span>
                ) : null}
              </span>
            </button>
          )}
        </div>

        {/* Window Controls */}
        <div className="flex items-center">
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
    </div>
  );
};
