import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import {
  Download,
  ListOrdered,
  Trash2,
  Settings,
  Moon,
  Sun,
  Plus,
  ChevronLeft,
  RefreshCw,
  Activity,
  Gauge,
} from 'lucide-react';
import { useDownloadStore } from '../stores/downloadStore';
import { isQueueItem } from '../services/tauriService';
import { useAppVersionStore } from '../stores/appVersionStore';
import { useHardwareBanStore } from '../stores/hardwareBanStore';
import { cleanVersion } from '../utils/version';
import { SidebarTooltip } from './ui/SidebarTooltip';

interface DownexSidebarProps {
  darkMode: boolean;
  setDarkMode: (val: boolean) => void;
  isBanned?: boolean;
  isReinstating?: boolean;
}

const SIDEBAR_STORAGE_KEY = 'downex_sidebar_collapsed';

export const DownexSidebar: React.FC<DownexSidebarProps> = ({
  darkMode,
  setDarkMode,
  isBanned = false,
  isReinstating = false,
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      return saved === 'true';
    } catch {
      return false;
    }
  });

  const isSidebarLocked = Boolean(isBanned || isReinstating);
  const effectiveCollapsed = isSidebarLocked ? true : isCollapsed;

  const selectedView = useDownloadStore((state) => state.selectedView);
  const setSelectedView = useDownloadStore((state) => state.setSelectedView);
  const setNewModalOpen = useDownloadStore((state) => state.setNewModalOpen);
  const items = useDownloadStore((state) => state.items);
  const isQueueRunning = useDownloadStore((state) => state.isQueueRunning);

  const status = useAppVersionStore((state) => state.status);
  const currentVersion = useAppVersionStore((state) => state.currentVersion);
  const checkForUpdates = useAppVersionStore((state) => state.checkForUpdates);

  // Sync sidebar state when unban completes or pre-ban snapshot is restored
  useEffect(() => {
    const syncFromStorage = () => {
      try {
        const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
        if (saved !== null) {
          setIsCollapsed(saved === 'true');
        }
      } catch (e) {
        console.warn('Failed to restore sidebar state:', e);
      }
    };

    const handleRestoreEvent = (e: Event) => {
      const custom = e as CustomEvent<{ sidebarCollapsed?: boolean }>;
      if (custom?.detail && typeof custom.detail.sidebarCollapsed === 'boolean') {
        setIsCollapsed(custom.detail.sidebarCollapsed);
      } else {
        syncFromStorage();
      }
    };

    if (!isSidebarLocked) {
      syncFromStorage();
    }

    window.addEventListener('downex-restore-ui-settings', handleRestoreEvent);
    return () => window.removeEventListener('downex-restore-ui-settings', handleRestoreEvent);
  }, [isSidebarLocked]);

  const toggleCollapse = () => {
    const { isBanned: bannedNow, isReinstating: reinstatingNow } = useHardwareBanStore.getState();
    if (bannedNow || reinstatingNow || isSidebarLocked) return;
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch (e) {
        console.warn('Failed to save sidebar state to localStorage:', e);
      }
      return next;
    });
  };

  const handleSidebarMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0 || e.detail < 2) return;
    const target = e.target instanceof Element ? e.target : null;
    if (
      target &&
      !target.closest(
        'button, a, input, select, textarea, [role="button"], [data-sidebar-interactive="true"]'
      )
    ) {
      // Prevent native browser double-click selection/drag artifacts on empty space
      e.preventDefault();
    }
  };

  const handleSidebarDoubleClick = (e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    if (
      target.closest(
        'button, a, input, select, textarea, [role="button"], [data-sidebar-interactive="true"]'
      )
    ) {
      return;
    }
    e.preventDefault();
    toggleCollapse();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleCollapse();
      } else if (e.key === 'F8') {
        e.preventDefault();
        toggleCollapse();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Show stage transitions ONLY when it matters: explicit manual check or a real update lifecycle.
  // Never flash fake/background states (silent syncs, empty checks, or header marquee notice pulses).
  const wasManualClickRef = useRef(false);
  const [showResultStage, setShowResultStage] = useState(false);
  const resultTimerRef = useRef<number | null>(null);
  const isManualAction = Boolean(status.isManualCheck || wasManualClickRef.current);
  const isChecking = status.state === 'checking' && !status.isSilentSync && isManualAction;

  // Theme switch tactile pulse animation (Sun & Moon ambient halo)
  const [themePulse, setThemePulse] = useState<'sun' | 'moon' | null>(null);
  const themePulseTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleToggleTheme = () => {
    const nextIsDark = !darkMode;
    if (themePulseTimerRef.current) clearTimeout(themePulseTimerRef.current);
    setThemePulse(nextIsDark ? 'moon' : 'sun');
    themePulseTimerRef.current = setTimeout(() => {
      setThemePulse(null);
    }, 550);

    setDarkMode(nextIsDark);
  };

  useEffect(() => {
    return () => {
      if (themePulseTimerRef.current) clearTimeout(themePulseTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (isChecking) {
      if (resultTimerRef.current !== null) {
        window.clearTimeout(resultTimerRef.current);
        resultTimerRef.current = null;
      }
      setShowResultStage(false);
      return;
    }

    const isManual = Boolean(status.isManualCheck || wasManualClickRef.current);
    if (status.state === 'up-to-date' && isManual) {
      setShowResultStage(true);
      if (resultTimerRef.current !== null) {
        window.clearTimeout(resultTimerRef.current);
      }
      resultTimerRef.current = window.setTimeout(() => {
        setShowResultStage(false);
        wasManualClickRef.current = false;
        resultTimerRef.current = null;
      }, 4200);
    } else if (status.state === 'error' && isManual) {
      setShowResultStage(true);
      if (resultTimerRef.current !== null) {
        window.clearTimeout(resultTimerRef.current);
      }
      resultTimerRef.current = window.setTimeout(() => {
        setShowResultStage(false);
        wasManualClickRef.current = false;
        resultTimerRef.current = null;
      }, 4800);
    }
  }, [status.state, status.isManualCheck, isChecking]);

  const pct = Math.min(100, Math.max(1, Math.round(status.progress?.percentage || 0)));

  const otaStageText = (() => {
    if (status.isSilentSync) return '';
    switch (status.state) {
      case 'checking':
        return isManualAction ? 'CHECKING' : '';
      case 'available':
        return 'UPDATE AVAILABLE';
      case 'up-to-date':
        return showResultStage ? 'UP TO DATE' : '';
      case 'error':
        return showResultStage ? 'FAILED' : '';
      case 'downloading':
        return `${pct}%`;
      case 'verifying':
        return 'VERIFYING';
      case 'patching':
        return 'PATCHING';
      case 'installing':
      case 'ready':
        return 'WORKING';
      case 'restarting':
        return 'RESTARTING';
      case 'waiting_timer':
      case 'queued':
        return 'QUEUED';
      default:
        return '';
    }
  })();

  const otaStageTone = (() => {
    switch (status.state) {
      case 'checking':
        return darkMode
          ? 'text-zinc-300 font-semibold animate-pulse'
          : 'text-zinc-600 font-semibold animate-pulse';
      case 'error':
        return darkMode ? 'text-rose-400 font-semibold' : 'text-rose-600 font-semibold';
      case 'available':
        return darkMode
          ? 'text-emerald-400 font-semibold animate-pulse'
          : 'text-emerald-600 font-semibold animate-pulse';
      case 'waiting_timer':
      case 'queued':
        return darkMode ? 'text-amber-400 font-semibold' : 'text-amber-600 font-semibold';
      case 'verifying':
        return darkMode ? 'text-indigo-400 font-semibold animate-pulse' : 'text-indigo-600 font-semibold animate-pulse';
      case 'patching':
        return darkMode ? 'text-violet-400 font-semibold animate-pulse' : 'text-violet-600 font-semibold animate-pulse';
      case 'installing':
      case 'ready':
        return darkMode ? 'text-sky-400 font-semibold animate-pulse' : 'text-sky-600 font-semibold animate-pulse';
      case 'restarting':
        return darkMode ? 'text-purple-400 font-semibold animate-pulse' : 'text-purple-600 font-semibold animate-pulse';
      default:
        return darkMode ? 'text-emerald-400 font-semibold' : 'text-emerald-600 font-semibold';
    }
  })();

  const activeDlPct =
    !status.isSilentSync && status.state === 'downloading'
      ? pct
      : !status.isSilentSync && (
          status.state === 'verifying' ||
          status.state === 'patching' ||
          status.state === 'installing' ||
          status.state === 'ready' ||
          status.state === 'restarting'
        )
        ? 100
        : 0;

  const [displayedStage, setDisplayedStage] = useState(otaStageText);
  const [displayedTone, setDisplayedTone] = useState(otaStageTone);
  const [stageVisible, setStageVisible] = useState(Boolean(otaStageText));
  const [dlBarWidth, setDlBarWidth] = useState(activeDlPct);
  const hideTimerRef = useRef<number | null>(null);
  const versionRowRef = useRef<HTMLDivElement>(null);
  const versionBadgeRef = useRef<HTMLSpanElement>(null);
  const [versionSlidePx, setVersionSlidePx] = useState<number>(112);

  useLayoutEffect(() => {
    const measure = () => {
      const rowEl = versionRowRef.current;
      const badgeEl = versionBadgeRef.current;
      if (!rowEl || !badgeEl) return;
      // 10px left padding + 10px right padding = 20px horizontal inset
      const rowInnerWidth = Math.max(0, rowEl.clientWidth - 20);
      const badgeWidth = badgeEl.offsetWidth;
      if (rowInnerWidth > 0 && badgeWidth > 0) {
        setVersionSlidePx(Math.max(0, Math.round(rowInnerWidth - badgeWidth)));
      }
    };

    measure();
    if (typeof ResizeObserver === 'undefined' || !versionRowRef.current) return;
    const ro = new ResizeObserver(measure);
    ro.observe(versionRowRef.current);
    if (versionBadgeRef.current) ro.observe(versionBadgeRef.current);
    return () => ro.disconnect();
  }, [currentVersion, effectiveCollapsed]);

  useEffect(() => {
    setDlBarWidth(activeDlPct);
  }, [activeDlPct]);

  useEffect(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    if (otaStageText) {
      setDisplayedStage(otaStageText);
      setDisplayedTone(otaStageTone);
      setStageVisible(true);
      return;
    }

    setStageVisible(false);
    hideTimerRef.current = window.setTimeout(() => {
      setDisplayedStage('');
      hideTimerRef.current = null;
    }, 120);

    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [otaStageText, otaStageTone]);

  const rowWashClass = !otaStageText
    ? 'opacity-0'
    : status.state === 'error'
      ? `opacity-100 ${darkMode ? 'bg-rose-500/[0.07]' : 'bg-rose-500/[0.06]'}`
      : status.state === 'waiting_timer' || status.state === 'queued'
        ? `opacity-100 ${darkMode ? 'bg-amber-500/[0.07]' : 'bg-amber-500/[0.06]'}`
        : status.state === 'verifying'
          ? `opacity-100 ${darkMode ? 'bg-indigo-500/[0.08]' : 'bg-indigo-500/[0.06]'}`
          : status.state === 'patching'
            ? `opacity-100 ${darkMode ? 'bg-violet-500/[0.08]' : 'bg-violet-500/[0.06]'}`
            : status.state === 'installing' || status.state === 'ready'
              ? `opacity-100 ${darkMode ? 'bg-sky-500/[0.08]' : 'bg-sky-500/[0.06]'}`
              : status.state === 'restarting'
                ? `opacity-100 ${darkMode ? 'bg-purple-500/[0.08]' : 'bg-purple-500/[0.06]'}`
                : status.state === 'checking'
                  ? `opacity-100 ${darkMode ? 'bg-zinc-800/35' : 'bg-zinc-200/40'}`
                  : `opacity-100 ${darkMode ? 'bg-emerald-500/[0.08]' : 'bg-emerald-500/[0.06]'}`;

  const showShimmer = isChecking && stageVisible;
  const showDlBar =
    !status.isSilentSync && (
      status.state === 'downloading' ||
      status.state === 'verifying' ||
      status.state === 'patching' ||
      status.state === 'ready' ||
      status.state === 'installing' ||
      status.state === 'restarting'
    );

  const queueItems = items.filter((i) => isQueueItem(i));
  const pendingInQueueCount = queueItems.filter((i) => i.status === 'queued').length;
  const activeInQueueCount = queueItems.filter(
    (i) => i.status === 'downloading' || i.status === 'probing'
  ).length;
  const completedInQueueCount = queueItems.filter((i) => i.status === 'completed').length;
  const queuedCount = queueItems.length;

  const allDownloadsItems = items.filter((i) => !isQueueItem(i));
  const activeDownloadingCount = allDownloadsItems.filter(
    (i) => i.status === 'downloading' || i.status === 'probing'
  ).length;
  const trashCount = items.filter(
    (i) => i.status === 'failed' || i.status === 'cancelled' || i.status === 'error'
  ).length;
  const allDownloadsCount = allDownloadsItems.length;

  const navItems = [
    {
      id: 'all',
      label: 'All Downloads',
      icon: Download,
      count: allDownloadsCount,
      subLabel:
        activeDownloadingCount > 0
          ? `${activeDownloadingCount} active download${activeDownloadingCount > 1 ? 's' : ''}`
          : `${allDownloadsCount} total downloads`,
      activeCount: activeDownloadingCount,
    },
    {
      id: 'queues',
      label: 'Queues',
      icon: ListOrdered,
      count: queuedCount,
      highlight: (isQueueRunning || activeInQueueCount > 0) && queuedCount > 0,
      subLabel:
        activeInQueueCount > 0 || isQueueRunning
          ? `${activeInQueueCount} active • ${pendingInQueueCount} waiting`
          : pendingInQueueCount > 0
            ? `${pendingInQueueCount} pending in queue`
            : completedInQueueCount > 0
              ? `${completedInQueueCount} completed in queue`
              : 'Queue is empty',
      badgeTone: ((isQueueRunning || activeInQueueCount > 0) && queuedCount > 0 ? 'emerald' : 'amber') as 'emerald' | 'amber',
    },
    {
      id: 'telemetry',
      label: 'Speed & Stats',
      icon: Activity,
      subLabel: 'Real-time bandwidth telemetry & charts',
    },
    {
      id: 'add_url',
      label: 'Add URL',
      icon: Plus,
      isAction: true,
      shortcut: 'Ctrl+N',
      subLabel: 'Capture & probe new download URL',
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      subLabel: 'General preferences, auto-update & startup',
    },
    {
      id: 'speedtest',
      label: 'Speed Test',
      icon: Gauge,
      subLabel: 'Test network speed & latency',
    },
    {
      id: 'trash',
      label: 'Trash',
      icon: Trash2,
      count: trashCount,
      subLabel: trashCount > 0 ? `${trashCount} removed items` : 'Trash is empty',
      badgeTone: 'zinc' as const,
    },
  ];

  return (
    <aside
      onMouseDown={handleSidebarMouseDown}
      onDoubleClick={handleSidebarDoubleClick}
      className={`relative z-30 h-full flex flex-col justify-between select-none border-r shrink-0 transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] ${darkMode
        ? 'bg-zinc-900 border-zinc-800 text-zinc-100'
        : 'bg-[#FAFAFA] border-zinc-200 text-zinc-900'
        } ${effectiveCollapsed ? 'w-[64px]' : 'w-[188px]'}`}
    >
      {/* Collapse/Expand Floating Button - Positioned neatly near top, 100% visible, smoothly animated */}
      <button
        type="button"
        onClick={toggleCollapse}
        onDoubleClick={(e) => e.stopPropagation()}
        disabled={isSidebarLocked}
        title={
          isSidebarLocked
            ? 'Sidebar locked while banned'
            : effectiveCollapsed
              ? 'Expand Sidebar (Ctrl+B)'
              : 'Collapse Sidebar (Ctrl+B)'
        }
        aria-label={
          isSidebarLocked
            ? 'Sidebar locked while banned'
            : effectiveCollapsed
              ? 'Expand Sidebar (Ctrl+B)'
              : 'Collapse Sidebar (Ctrl+B)'
        }
        className={`absolute -right-2.5 top-[25px] -translate-y-1/2 z-40 w-5 h-5 rounded-full bg-white dark:bg-zinc-800 border border-zinc-200/90 dark:border-zinc-700/90 shadow-sm flex items-center justify-center text-zinc-500 dark:text-zinc-400 ${isSidebarLocked
          ? 'opacity-60 cursor-not-allowed'
          : 'hover:shadow-md hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-700 active:scale-90 hover:scale-110 cursor-pointer pointer-events-auto'
          } transition-all duration-200 ease-out`}
      >
        <ChevronLeft
          className={`w-3.5 h-3.5 transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${effectiveCollapsed ? 'rotate-180' : ''
            }`}
        />
      </button>

      {/* Top Header & Navigation Section */}
      <div className="flex flex-col overflow-hidden pt-2">
        {/* Navigation Items */}
        <nav
          className={`transition-[padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${effectiveCollapsed ? 'px-3 space-y-1' : 'px-2.5 space-y-0.5'
            }`}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const isSelected = selectedView === item.id;

            const buttonNode = (
              <button
                disabled={isSidebarLocked}
                onClick={() => {
                  if (isSidebarLocked) return;
                  if (item.isAction) {
                    setNewModalOpen(true);
                  } else {
                    setSelectedView(item.id);
                    if (item.id === 'telemetry') {
                      window.dispatchEvent(new CustomEvent('downex-retrigger-telemetry'));
                    }
                  }
                }}
                className={`flex items-center justify-start text-[11.5px] font-mono-tabular text-left overflow-hidden transition-[width,height,padding,border-radius,background-color,color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${isSidebarLocked ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                  } ${effectiveCollapsed
                    ? 'w-[40px] h-[40px] pl-[12.5px] pr-0 rounded-md relative'
                    : 'w-[168px] h-[30px] pl-2.5 pr-2.5 rounded-sm'
                  } ${isSelected
                    ? darkMode
                      ? 'bg-white text-zinc-950 font-semibold'
                      : 'bg-black text-white font-semibold'
                    : darkMode
                      ? 'text-zinc-400 hover:text-white hover:bg-zinc-800/60 font-medium'
                      : 'text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/50 font-medium'
                  }`}
              >
                <div className="relative flex items-center shrink-0">
                  <Icon size={15} strokeWidth={2} className="shrink-0" />

                  {/* Active downloading indicator on All Downloads icon when collapsed */}
                  {item.id === 'all' && (item.activeCount || 0) > 0 && (
                    <span
                      className={`absolute -top-1 -right-1 flex h-2 w-2 pointer-events-none transition-opacity duration-200 ${effectiveCollapsed ? 'opacity-100' : 'opacity-0'
                        }`}
                    >
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                  )}

                  {/* Collapsed Badge Pill on Icon for Queues / Trash */}
                  {item.count !== undefined && item.count > 0 && item.id !== 'all' && (
                    <span
                      className={`absolute -top-1.5 -right-1.5 min-w-[15px] h-3.5 px-0.5 rounded-full text-[8.5px] font-mono font-bold flex items-center justify-center leading-none shadow-xs pointer-events-none transition-opacity duration-200 ${effectiveCollapsed ? 'opacity-100' : 'opacity-0'
                        } ${item.highlight
                          ? 'bg-emerald-500 text-white animate-pulse'
                          : isSelected
                            ? darkMode
                              ? 'bg-zinc-900 text-zinc-100'
                              : 'bg-zinc-100 text-zinc-900'
                            : item.id === 'queues'
                              ? 'bg-amber-500 text-white'
                              : 'bg-zinc-400 dark:bg-zinc-600 text-white'
                        }`}
                    >
                      {item.count > 99 ? '99+' : item.count}
                    </span>
                  )}
                </div>

                <span
                  className={`truncate whitespace-nowrap overflow-hidden transition-[max-width,opacity,margin] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${effectiveCollapsed ? 'max-w-0 opacity-0 ml-0' : 'max-w-[96px] opacity-100 ml-2.5'
                    }`}
                >
                  {item.label}
                </span>

                {(item.isAction || (item.count !== undefined && item.count > 0)) && (
                  <span
                    className={`shrink-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin] duration-250 ease-out ${effectiveCollapsed ? 'max-w-0 opacity-0 ml-0' : 'max-w-[46px] opacity-100 ml-auto'
                      }`}
                  >
                    {item.isAction ? (
                      <span
                        className={`text-[10px] font-mono-tabular ${isSelected ? 'opacity-70' : 'text-zinc-400 dark:text-zinc-500'
                          }`}
                      >
                        Ctrl+N
                      </span>
                    ) : (
                      <span
                        className={`text-[10px] font-mono-tabular px-1.5 py-0.5 rounded-sm ${isSelected
                          ? darkMode
                            ? 'bg-zinc-200 text-zinc-900 font-bold'
                            : 'bg-zinc-800 text-white font-bold'
                          : item.highlight
                            ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-semibold'
                            : 'text-zinc-400'
                          }`}
                      >
                        {item.count}
                      </span>
                    )}
                  </span>
                )}
              </button>
            );

            return (
              <SidebarTooltip
                key={item.id}
                disabled={!effectiveCollapsed}
                label={item.label}
                subLabel={item.subLabel}
                shortcut={item.shortcut}
                badge={item.count !== undefined && item.count > 0 ? item.count : undefined}
                badgeTone={item.badgeTone}
                side="right"
                darkMode={darkMode}
              >
                {buttonNode}
              </SidebarTooltip>
            );
          })}
        </nav>
      </div>

      {/* Bottom Actions & Version Info - Positioned right at Check updates horizontal line */}
      <div className="shrink-0 select-none overflow-hidden">
        <div className="relative h-[32px] overflow-hidden">
          {/* Expanded Version Row */}
          <div
            ref={versionRowRef}
            data-testid="sidebar-version"
            data-sidebar-interactive="true"
            aria-label={`App version ${cleanVersion(currentVersion)}`}
            className={`group absolute inset-x-0 top-0 h-[28px] overflow-hidden pl-2.5 pr-2.5 pt-1.5 pb-1.5 flex items-center justify-between gap-1.5 font-mono-tabular text-[10px] uppercase tracking-wider select-none text-zinc-500 cursor-default transition-opacity duration-200 ${effectiveCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
              }`}
          >
            {/* Dynamic Stage Background Wash */}
            <div
              aria-hidden="true"
              className={`absolute inset-x-2 inset-y-0.5 rounded pointer-events-none transition-opacity duration-300 ease-out will-change-opacity ${rowWashClass}`}
            />

            {/* Ambient Shimmer Sweep during Checking */}
            {showShimmer && (
              <div
                aria-hidden="true"
                className="absolute inset-x-2 inset-y-0.5 pointer-events-none overflow-hidden rounded"
              >
                <div
                  className={`h-full w-2/3 animate-shimmer-sweep ${darkMode
                    ? 'bg-gradient-to-r from-transparent via-zinc-300/12 to-transparent'
                    : 'bg-gradient-to-r from-transparent via-zinc-900/[0.08] to-transparent'
                    }`}
                />
              </div>
            )}

            {/* Hairline Bottom Progress Bar with GPU Composited Transform */}
            <div
              aria-hidden="true"
              className={`ota-progress-track ${showDlBar ? 'opacity-100' : 'opacity-0'
                } ${darkMode ? 'bg-zinc-800/80' : 'bg-zinc-200/80'}`}
            >
              <div
                className={`ota-progress-fill ${status.state === 'downloading' ? 'ota-progress-active' : ''
                  } bg-gradient-to-r ${darkMode
                    ? 'from-emerald-500 via-emerald-400 to-teal-300'
                    : 'from-emerald-600 via-emerald-500 to-teal-400'
                  }`}
                style={{ transform: `scaleX(${Math.min(100, Math.max(0, dlBarWidth)) / 100})` }}
              />
            </div>

            {(() => {
              const isStageActive = Boolean(stageVisible && displayedStage);
              return (
                <>
                  {/* Left Slot: APP VERSION label glides out quickly before vX.Y.Z arrives */}
                  <span
                    className={`absolute left-2.5 inset-y-0 z-10 flex items-center whitespace-nowrap leading-none pointer-events-none transition-[opacity,transform] ${
                      isStageActive
                        ? 'opacity-0 -translate-x-2 duration-[120ms] ease-in delay-0'
                        : 'opacity-100 translate-x-0 duration-[180ms] ease-out delay-[140ms]'
                    }`}
                  >
                    APP VERSION
                  </span>

                  {/* Single vX.Y.Z badge: enters left immediately on active stage; waits for stage fadeout before returning right */}
                  <span
                    ref={versionBadgeRef}
                    style={{
                      transform: isStageActive
                        ? `translate3d(${-versionSlidePx}px, 0, 0)`
                        : 'translate3d(0, 0, 0)',
                      transition: isStageActive
                        ? 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1) 0ms, color 180ms ease'
                        : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1) 110ms, color 180ms ease',
                    }}
                    className={`absolute right-2.5 inset-y-0 z-10 flex items-center text-[10px] uppercase tracking-wider leading-none font-mono-tabular whitespace-nowrap will-change-transform ${
                      isStageActive
                        ? 'font-medium text-zinc-500 dark:text-zinc-400'
                        : 'text-zinc-500'
                    }`}
                  >
                    v{cleanVersion(currentVersion)}
                  </span>

                  {/* Right Stage Slot: fades in AFTER vX.Y.Z has slid left; fades out completely BEFORE vX.Y.Z returns */}
                  {displayedStage ? (
                    <span
                      data-testid="sidebar-version-stage"
                      className={`absolute right-2.5 inset-y-0 z-10 inline-flex items-center max-w-[116px] truncate text-[9.5px] uppercase font-mono-tabular tracking-wider leading-none whitespace-nowrap transition-[opacity,transform] ${displayedTone} ${
                        isStageActive
                          ? 'opacity-100 translate-x-0 duration-[140ms] ease-out delay-[120ms]'
                          : 'opacity-0 translate-x-1.5 duration-[100ms] ease-in delay-0 pointer-events-none'
                      }`}
                    >
                      <span className="inline-block font-semibold leading-none truncate">
                        {displayedStage}
                      </span>
                    </span>
                  ) : null}
                </>
              );
            })()}
          </div>

          {/* Collapsed Version Pill */}
          <div
            className={`absolute inset-x-0 top-0 pb-2 flex justify-center items-center transition-opacity duration-200 ${effectiveCollapsed ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
          >
            <SidebarTooltip
              disabled={!effectiveCollapsed}
              label={`Downex v${cleanVersion(currentVersion)}`}
              subLabel={
                isChecking
                  ? 'Checking for updates...'
                  : otaStageText
                    ? `Update: ${otaStageText}`
                    : `Version v${cleanVersion(currentVersion)}`
              }
              side="right"
              darkMode={darkMode}
            >
              <div
                data-sidebar-interactive="true"
                aria-label={`Downex v${cleanVersion(currentVersion)}`}
                className="group relative w-[52px] h-[25px] mx-auto flex items-center justify-center rounded-md bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200/90 dark:border-zinc-700/70 shadow-2xs select-none cursor-default overflow-hidden"
              >
                {/* Hairline Progress in Collapsed Mode */}
                <div
                  aria-hidden="true"
                  className={`ota-progress-track ${showDlBar ? 'opacity-100' : 'opacity-0'
                    } ${darkMode ? 'bg-zinc-800/80' : 'bg-zinc-200/80'}`}
                >
                  <div
                    className={`ota-progress-fill ${status.state === 'downloading' ? 'ota-progress-active' : ''
                      } bg-gradient-to-r ${darkMode
                        ? 'from-emerald-500 via-emerald-400 to-teal-300'
                        : 'from-emerald-600 via-emerald-500 to-teal-400'
                      }`}
                    style={{ transform: `scaleX(${Math.min(100, Math.max(0, dlBarWidth)) / 100})` }}
                  />
                </div>

                {/* Shimmer Sweep Effect during Checking in Collapsed Mode */}
                {showShimmer && (
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 pointer-events-none overflow-hidden rounded-md"
                  >
                    <div
                      className={`h-full w-2/3 animate-shimmer-sweep ${darkMode
                        ? 'bg-gradient-to-r from-transparent via-zinc-300/15 to-transparent'
                        : 'bg-gradient-to-r from-transparent via-zinc-900/[0.08] to-transparent'
                        }`}
                    />
                  </div>
                )}

                {isChecking ? (
                  <span className="font-mono text-[10px] font-bold tracking-tight text-zinc-600 dark:text-zinc-300 leading-none select-none animate-pulse">
                    v{cleanVersion(currentVersion)}
                  </span>
                ) : status.state === 'available' ? (
                  <span className="text-[9px] font-mono font-bold text-emerald-600 dark:text-emerald-400 leading-none animate-pulse">
                    NEW
                  </span>
                ) : status.state === 'downloading' ? (
                  <span className="font-mono text-[9.5px] font-bold text-emerald-600 dark:text-emerald-400 animate-pulse leading-none">
                    {pct}%
                  </span>
                ) : status.state === 'ready' || status.state === 'installing' || status.state === 'restarting' ? (
                  <span className="text-[9px] font-mono font-bold text-emerald-600 dark:text-emerald-400 leading-none">
                    UPD
                  </span>
                ) : (
                  <span className="font-mono text-[10px] font-bold tracking-tight text-zinc-700 dark:text-zinc-300 leading-none select-none">
                    v{cleanVersion(currentVersion)}
                  </span>
                )}
              </div>
            </SidebarTooltip>
          </div>
        </div>

        {/* Check update horizontal line */}
        <div
          data-sidebar-interactive="true"
          className={`border-t border-zinc-200 dark:border-zinc-800 transition-[padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${effectiveCollapsed ? 'px-3 py-2 space-y-1' : 'p-2.5 space-y-0.5'
            }`}
        >
          <SidebarTooltip
            disabled={!effectiveCollapsed}
            label={isSidebarLocked ? 'Updates Unavailable' : 'Check for Updates'}
            subLabel={
              isSidebarLocked
                ? 'Device banned from owner updates'
                : isChecking
                  ? 'Checking for updates...'
                  : `Current: v${cleanVersion(currentVersion)}`
            }
            side="right"
            darkMode={darkMode}
            className="w-full"
          >
            <button
              type="button"
              onClick={() => {
                if (isSidebarLocked || isChecking) return;
                wasManualClickRef.current = true;
                void checkForUpdates(false);
              }}
              disabled={isSidebarLocked}
              aria-busy={isChecking}
              title={
                effectiveCollapsed
                  ? undefined
                  : isSidebarLocked
                    ? 'Updates unavailable (Device banned)'
                    : isChecking
                      ? 'Checking for updates...'
                      : 'Check for updates'
              }
              aria-label={isSidebarLocked ? 'Updates unavailable (Device banned)' : 'Check for updates'}
              className={`flex items-center justify-start text-[11px] font-mono-tabular text-left overflow-hidden transition-[width,height,padding,border-radius,background-color,color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${effectiveCollapsed
                ? 'w-[40px] h-[40px] pl-[12.5px] pr-0 rounded-md'
                : 'w-full h-[30px] pl-2.5 pr-2.5 rounded-sm'
                } ${isSidebarLocked
                  ? 'opacity-40 cursor-not-allowed text-zinc-500'
                  : isChecking
                    ? darkMode
                      ? 'bg-emerald-500/12 text-emerald-300 font-medium cursor-pointer'
                      : 'bg-emerald-500/10 text-emerald-700 font-medium cursor-pointer'
                    : darkMode
                      ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 active:scale-[0.98] font-medium cursor-pointer'
                      : 'text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/50 active:scale-[0.98] font-medium cursor-pointer'
                }`}
            >
              <RefreshCw
                size={15}
                strokeWidth={1.8}
                className={`shrink-0 transition-transform duration-300 ${isChecking ? 'animate-spin text-emerald-500' : ''}`}
              />
              <span
                className={`truncate whitespace-nowrap overflow-hidden transition-[max-width,opacity,margin] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${effectiveCollapsed ? 'max-w-0 opacity-0 ml-0' : 'max-w-[110px] opacity-100 ml-2.5'
                  }`}
              >
                Check updates
              </span>
            </button>
          </SidebarTooltip>

          <SidebarTooltip
            disabled={!effectiveCollapsed}
            label={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            side="right"
            darkMode={darkMode}
          >
            <button
              type="button"
              onClick={handleToggleTheme}
              aria-label={darkMode ? 'Light mode' : 'Dark mode'}
              className={`flex items-center justify-start text-[11px] font-mono-tabular text-left cursor-pointer group relative overflow-hidden subpixel-antialiased transition-[width,height,padding,border-radius,background-color,color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${effectiveCollapsed
                ? 'w-[40px] h-[40px] pl-[12.5px] pr-0 rounded-md'
                : 'w-[168px] h-[28px] pl-2.5 pr-2.5 rounded-sm'
                } ${themePulse === 'sun'
                  ? `animate-theme-sun ${effectiveCollapsed ? '' : 'ring-1 ring-amber-500/40'}`
                  : themePulse === 'moon'
                    ? `animate-theme-moon ${effectiveCollapsed ? '' : 'ring-1 ring-indigo-500/40'}`
                    : ''
                } ${darkMode
                  ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 font-medium'
                  : 'text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/50 font-medium'
                }`}
            >
              <div className="relative w-[15px] h-[15px] flex items-center justify-center shrink-0">
                <Sun
                  size={15}
                  strokeWidth={1.8}
                  className={`absolute text-amber-500 dark:text-amber-400 transition-all duration-350 ease-out ${darkMode ? 'rotate-0 scale-100 opacity-100' : '-rotate-180 scale-50 opacity-0 pointer-events-none'
                    }`}
                />
                <Moon
                  size={15}
                  strokeWidth={1.8}
                  className={`absolute text-zinc-600 dark:text-indigo-300 transition-all duration-350 ease-out ${!darkMode ? 'rotate-0 scale-100 opacity-100' : 'rotate-180 scale-50 opacity-0 pointer-events-none'
                    }`}
                />
              </div>
              <span
                key={darkMode ? 'light' : 'dark'}
                className={`truncate whitespace-nowrap overflow-hidden animate-theme-label transition-[max-width,opacity,margin] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${effectiveCollapsed ? 'max-w-0 opacity-0 ml-0' : 'max-w-[110px] opacity-100 ml-2.5'
                  }`}
              >
                {darkMode ? 'Light mode' : 'Dark mode'}
              </span>
            </button>
          </SidebarTooltip>
        </div>
      </div>
    </aside>
  );
};
