import React, { useState, useEffect, useRef } from 'react';
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
import { useAppVersionStore } from '../stores/appVersionStore';
import { cleanVersion } from '../utils/version';
import { SidebarTooltip } from './ui/SidebarTooltip';

interface DownexSidebarProps {
  darkMode: boolean;
  setDarkMode: (val: boolean) => void;
}

export const DownexSidebar: React.FC<DownexSidebarProps> = ({ darkMode, setDarkMode }) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('downex_sidebar_collapsed');
      return saved === 'true';
    } catch {
      return false;
    }
  });

  const selectedView = useDownloadStore((state) => state.selectedView);
  const setSelectedView = useDownloadStore((state) => state.setSelectedView);
  const setNewModalOpen = useDownloadStore((state) => state.setNewModalOpen);
  const items = useDownloadStore((state) => state.items);
  const isQueueRunning = useDownloadStore((state) => state.isQueueRunning);

  const status = useAppVersionStore((state) => state.status);
  const currentVersion = useAppVersionStore((state) => state.currentVersion);
  const checkForUpdates = useAppVersionStore((state) => state.checkForUpdates);

  const toggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('downex_sidebar_collapsed', String(next));
      } catch (e) {
        console.warn('Failed to save sidebar state to localStorage:', e);
      }
      return next;
    });
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

  // ScheduleMe 1:1 Stage presentation
  const isChecking = status.state === 'checking';

  const wasManualClickRef = useRef(false);
  const [showResultStage, setShowResultStage] = useState(false);
  const resultTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (isChecking) {
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
    switch (status.state) {
      case 'checking':
        return 'CHECKING';
      case 'up-to-date':
        return showResultStage ? 'UP TO DATE' : '';
      case 'error':
        return showResultStage ? 'FAILED' : '';
      case 'downloading':
        return `${pct}%`;
      case 'verifying':
        return 'VERIFYING';
      case 'ready':
      case 'installing':
      case 'restarting':
        return 'UPDATING';
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
      case 'waiting_timer':
      case 'queued':
        return darkMode ? 'text-amber-400 font-semibold' : 'text-amber-600 font-semibold';
      default:
        return darkMode ? 'text-emerald-400 font-semibold' : 'text-emerald-600 font-semibold';
    }
  })();

  const stagePhaseKey = otaStageText ? status.state : '';

  const activeDlPct =
    status.state === 'downloading'
      ? pct
      : status.state === 'verifying' ||
        status.state === 'ready' ||
        status.state === 'installing' ||
        status.state === 'restarting'
      ? 100
      : 0;

  const [displayedStage, setDisplayedStage] = useState(otaStageText);
  const [displayedTone, setDisplayedTone] = useState(otaStageTone);
  const [displayedPhaseKey, setDisplayedPhaseKey] = useState(stagePhaseKey);
  const [stageVisible, setStageVisible] = useState(Boolean(otaStageText));
  const [dlBarWidth, setDlBarWidth] = useState(activeDlPct);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (activeDlPct > 0) {
      setDlBarWidth(activeDlPct);
    }
  }, [activeDlPct]);

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
    : status.state === 'error'
    ? `opacity-100 ${darkMode ? 'bg-rose-500/[0.07]' : 'bg-rose-500/[0.06]'}`
    : status.state === 'waiting_timer' || status.state === 'queued'
    ? `opacity-100 ${darkMode ? 'bg-amber-500/[0.07]' : 'bg-amber-500/[0.06]'}`
    : status.state === 'checking'
    ? `opacity-100 ${darkMode ? 'bg-zinc-800/35' : 'bg-zinc-200/40'}`
    : `opacity-100 ${darkMode ? 'bg-emerald-500/[0.08]' : 'bg-emerald-500/[0.06]'}`;

  const showShimmer = status.state === 'checking' && stageVisible;
  const showDlBar =
    status.state === 'downloading' ||
    status.state === 'verifying' ||
    status.state === 'ready' ||
    status.state === 'installing' ||
    status.state === 'restarting';

  const activeDownloadingCount = items.filter(
    (i) => i.status === 'downloading' || i.status === 'probing'
  ).length;
  const queuedCount = items.filter((i) => i.status === 'queued').length;
  const trashCount = items.filter(
    (i) => i.status === 'failed' || i.status === 'cancelled' || i.status === 'error'
  ).length;

  const navItems = [
    {
      id: 'all',
      label: 'All Downloads',
      icon: Download,
      count: items.length,
      subLabel:
        activeDownloadingCount > 0
          ? `${activeDownloadingCount} active download${activeDownloadingCount > 1 ? 's' : ''}`
          : `${items.length} total downloads`,
      activeCount: activeDownloadingCount,
    },
    {
      id: 'queues',
      label: 'Queues',
      icon: ListOrdered,
      count: queuedCount,
      highlight: isQueueRunning && queuedCount > 0,
      subLabel:
        isQueueRunning && queuedCount > 0
          ? `Queue active (${queuedCount} pending)`
          : queuedCount > 0
          ? `${queuedCount} pending in queue`
          : 'Queue is empty',
      badgeTone: (isQueueRunning && queuedCount > 0 ? 'emerald' : 'amber') as 'emerald' | 'amber',
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
      className={`relative z-30 h-full flex flex-col justify-between select-none border-r shrink-0 transition-all duration-300 ease-in-out ${
        darkMode
          ? 'bg-zinc-900 border-zinc-800 text-zinc-100'
          : 'bg-[#FAFAFA] border-zinc-200 text-zinc-900'
      } ${isCollapsed ? 'w-[70px]' : 'w-[228px]'}`}
    >
      {/* Collapse/Expand Floating Button - Positioned neatly near top, 100% visible, smoothly animated */}
      <button
        type="button"
        onClick={toggleCollapse}
        title={isCollapsed ? 'Expand Sidebar (Ctrl+B)' : 'Collapse Sidebar (Ctrl+B)'}
        aria-label={isCollapsed ? 'Expand Sidebar (Ctrl+B)' : 'Collapse Sidebar (Ctrl+B)'}
        className="absolute -right-2.5 top-[27px] -translate-y-1/2 z-40 w-5 h-5 rounded-full bg-white dark:bg-zinc-800 border border-zinc-200/90 dark:border-zinc-700/90 shadow-sm hover:shadow-md flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-700 active:scale-90 hover:scale-110 transition-all duration-200 ease-out cursor-pointer pointer-events-auto"
      >
        <ChevronLeft
          className={`w-3.5 h-3.5 transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
            isCollapsed ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Top Header & Navigation Section */}
      <div className="flex flex-col overflow-x-hidden pt-2">
        {/* Navigation Items */}
        <nav className={isCollapsed ? 'px-2.5 space-y-1' : 'px-3 space-y-0.5'}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isSelected = selectedView === item.id;

            const buttonNode = (
              <button
                key={item.id}
                onClick={() => {
                  if (item.isAction) {
                    setNewModalOpen(true);
                  } else {
                    setSelectedView(item.id);
                    if (item.id === 'telemetry') {
                      window.dispatchEvent(new CustomEvent('downex-retrigger-telemetry'));
                    }
                  }
                }}
                className={`w-full flex items-center justify-between px-3 py-2 text-[13px] font-medium transition-colors text-left cursor-pointer rounded-sm ${
                  isCollapsed ? 'w-11 h-11 mx-auto justify-center p-0 relative rounded-md' : ''
                } ${
                  isSelected
                    ? darkMode
                      ? 'bg-white text-zinc-950 font-medium'
                      : 'bg-black text-white font-medium'
                    : darkMode
                    ? 'text-zinc-400 hover:text-white hover:bg-zinc-800/60'
                    : 'text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/50'
                }`}
              >
                <div className={`flex items-center ${isCollapsed ? 'justify-center relative' : 'gap-2.5'}`}>
                  <Icon size={16} strokeWidth={2} className="shrink-0" />
                  {!isCollapsed && <span className="truncate">{item.label}</span>}

                  {/* Active downloading indicator on All Downloads icon when collapsed */}
                  {isCollapsed && item.id === 'all' && (item.activeCount || 0) > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-2 w-2 pointer-events-none">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                  )}

                  {/* Collapsed Badge Pill on Icon for Queues / Trash */}
                  {isCollapsed && item.count !== undefined && item.count > 0 && item.id !== 'all' && (
                    <span
                      className={`absolute -top-1 -right-1 min-w-[16px] h-3.5 px-0.5 rounded-full text-[8.5px] font-mono font-bold flex items-center justify-center leading-none shadow-xs pointer-events-none ${
                        item.highlight
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

                {!isCollapsed ? (
                  item.isAction ? (
                    <span
                      className={`text-[10px] font-mono-tabular ${
                        isSelected ? 'opacity-70' : 'text-zinc-400 dark:text-zinc-500'
                      }`}
                    >
                      Ctrl+N
                    </span>
                  ) : item.count !== undefined && item.count > 0 ? (
                    <span
                      className={`text-[10px] font-mono-tabular px-1.5 py-0.5 rounded-sm ${
                        isSelected
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
                  ) : null
                ) : null}
              </button>
            );

            return isCollapsed ? (
              <SidebarTooltip
                key={item.id}
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
            ) : (
              buttonNode
            );
          })}
        </nav>
      </div>

      {/* Bottom Actions & Version Info - Positioned right at Check updates horizontal line */}
      <div className="shrink-0 select-none">
        {!isCollapsed ? (
          <div
            data-testid="sidebar-version"
            onClick={() => {
              wasManualClickRef.current = true;
              checkForUpdates(false);
            }}
            title={isChecking ? 'Checking for updates...' : 'Click to check for updates'}
            className="group relative overflow-hidden pl-4 pr-4 pt-2 pb-2 flex items-center justify-between gap-2 font-mono-tabular text-[10px] uppercase tracking-wider select-none text-zinc-500 cursor-pointer hover:bg-zinc-100/60 dark:hover:bg-zinc-800/40 transition-colors"
          >
            {/* Dynamic Stage Background Wash */}
            <div
              aria-hidden="true"
              className={`absolute inset-x-3 inset-y-0.5 pointer-events-none transition-opacity duration-500 ease-out ${rowWashClass}`}
            />

            {/* Ambient Shimmer Sweep during Checking */}
            {showShimmer && (
              <div
                aria-hidden="true"
                className="absolute inset-x-3 inset-y-0.5 pointer-events-none overflow-hidden"
              >
                <div
                  className={`h-full w-2/3 animate-shimmer-sweep ${
                    darkMode
                      ? 'bg-gradient-to-r from-transparent via-zinc-300/10 to-transparent'
                      : 'bg-gradient-to-r from-transparent via-zinc-900/[0.06] to-transparent'
                  }`}
                />
              </div>
            )}

            {/* Hairline Bottom Progress Bar with Emerald Fill */}
            <div
              aria-hidden="true"
              className={`absolute inset-x-0 bottom-0 h-[1.5px] pointer-events-none transition-opacity duration-500 ease-out ${
                showDlBar ? 'opacity-100' : 'opacity-0'
              } ${darkMode ? 'bg-zinc-800/70' : 'bg-zinc-200/70'}`}
            >
              <div
                className={`h-full transition-[width] duration-300 ease-out ${
                  darkMode ? 'bg-emerald-400' : 'bg-emerald-600'
                }`}
                style={{ width: `${dlBarWidth}%` }}
              />
            </div>

            <span className="relative z-10 whitespace-nowrap leading-none group-hover:text-zinc-700 dark:group-hover:text-zinc-300 transition-colors">
              APP VERSION
            </span>
            <span className="relative z-10 inline-flex items-center gap-1.5 whitespace-nowrap leading-none font-mono-tabular">
              <span className="text-[10px] uppercase tracking-wider leading-none">
                v{cleanVersion(currentVersion)}
              </span>
              {displayedStage ? (
                <span
                  data-testid="sidebar-version-stage"
                  className={`inline-flex items-center text-[10px] uppercase font-mono-tabular tracking-wider leading-none transition-all duration-300 ${displayedTone} ${
                    stageVisible ? 'opacity-100 max-w-[100px]' : 'opacity-0 max-w-0'
                  }`}
                >
                  <span
                    key={displayedPhaseKey}
                    className="inline-block animate-fade-in font-semibold leading-none"
                  >
                    {displayedStage}
                  </span>
                </span>
              ) : null}
            </span>
          </div>
        ) : (
          <div className="flex justify-center items-center pb-2">
            <SidebarTooltip
              label={`Downex v${cleanVersion(currentVersion)}`}
              subLabel={
                isChecking
                  ? 'Checking for updates...'
                  : otaStageText
                  ? `Update: ${otaStageText}`
                  : 'App is up to date • Click to check'
              }
              side="right"
              darkMode={darkMode}
            >
              <button
                type="button"
                onClick={() => {
                  wasManualClickRef.current = true;
                  checkForUpdates(false);
                }}
                disabled={isChecking}
                aria-label={`Downex v${cleanVersion(currentVersion)}`}
                className="group relative w-[52px] h-[25px] mx-auto flex items-center justify-center rounded-md bg-zinc-100 dark:bg-zinc-800/80 hover:bg-zinc-200/80 dark:hover:bg-zinc-700/80 border border-zinc-200/90 dark:border-zinc-700/70 shadow-2xs hover:shadow-xs transition-all duration-200 cursor-pointer overflow-hidden"
              >
                {/* Hairline Progress in Collapsed Mode */}
                <div
                  aria-hidden="true"
                  className={`absolute inset-x-0 bottom-0 h-[2px] pointer-events-none transition-opacity duration-300 ${
                    showDlBar ? 'opacity-100' : 'opacity-0'
                  } ${darkMode ? 'bg-zinc-800' : 'bg-zinc-200'}`}
                >
                  <div
                    className={`h-full transition-[width] duration-300 ${
                      darkMode ? 'bg-emerald-400' : 'bg-emerald-600'
                    }`}
                    style={{ width: `${dlBarWidth}%` }}
                  />
                </div>

                {/* Shimmer Sweep Effect during Checking in Collapsed Mode */}
                {showShimmer && (
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 pointer-events-none overflow-hidden rounded-md"
                  >
                    <div
                      className={`h-full w-2/3 animate-shimmer-sweep ${
                        darkMode
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
              </button>
            </SidebarTooltip>
          </div>
        )}

        {/* Check update horizontal line */}
        <div
          className={`border-t border-zinc-200 dark:border-zinc-800 ${
            isCollapsed ? 'p-2.5 space-y-1' : 'p-3 space-y-0.5'
          }`}
        >
          {isCollapsed ? (
            <>
              <SidebarTooltip
                label="Check for Updates"
                subLabel={isChecking ? 'Checking for updates...' : `Current: v${cleanVersion(currentVersion)}`}
                side="right"
                darkMode={darkMode}
              >
                <button
                  type="button"
                  onClick={() => {
                    wasManualClickRef.current = true;
                    checkForUpdates(false);
                  }}
                  disabled={isChecking}
                  aria-label="Check for updates"
                  className={`w-11 h-11 mx-auto flex items-center justify-center rounded-md transition-colors cursor-pointer ${
                    darkMode
                      ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60'
                      : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/50'
                  }`}
                >
                  <RefreshCw
                    size={16}
                    strokeWidth={1.75}
                    className={isChecking ? 'animate-spin text-emerald-500' : ''}
                  />
                </button>
              </SidebarTooltip>

              <SidebarTooltip
                label={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                side="right"
                darkMode={darkMode}
              >
                <button
                  type="button"
                  onClick={() => setDarkMode(!darkMode)}
                  aria-label={darkMode ? 'Light mode' : 'Dark mode'}
                  className={`w-11 h-11 mx-auto flex items-center justify-center rounded-md transition-colors cursor-pointer ${
                    darkMode
                      ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60'
                      : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/50'
                  }`}
                >
                  {darkMode ? <Sun size={16} strokeWidth={1.75} /> : <Moon size={16} strokeWidth={1.75} />}
                </button>
              </SidebarTooltip>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  wasManualClickRef.current = true;
                  checkForUpdates(false);
                }}
                disabled={isChecking}
                title={isChecking ? 'Checking for updates...' : 'Check for updates'}
                className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-left cursor-pointer transition-colors rounded-sm ${
                  darkMode ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/40'
                }`}
              >
                <span className="w-4 h-4 inline-flex items-center justify-center shrink-0">
                  <RefreshCw
                    size={15}
                    strokeWidth={1.75}
                    className={isChecking ? 'animate-spin' : ''}
                  />
                </span>
                <span>Check updates</span>
              </button>

              <button
                type="button"
                onClick={() => setDarkMode(!darkMode)}
                className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-left cursor-pointer transition-colors rounded-sm ${
                  darkMode ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/40'
                }`}
              >
                <span className="w-4 h-4 inline-flex items-center justify-center shrink-0">
                  {darkMode ? <Sun size={15} strokeWidth={1.75} /> : <Moon size={15} strokeWidth={1.75} />}
                </span>
                <span>{darkMode ? 'Light mode' : 'Dark mode'}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
};
