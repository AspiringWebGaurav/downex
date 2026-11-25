import React, { useEffect, useState, useCallback } from 'react';
import { Button } from './components/ui/Button';
import { Plus, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { DownexWindowHeader } from './components/DownexWindowHeader';
import { DownexSidebar } from './components/DownexSidebar';
import { DownloadTable } from './components/DownloadTable';
import { InAppSearchBar } from './components/InAppSearchBar';
import { TelemetryWidget } from './components/TelemetryWidget';
import { NewDownloadModal } from './components/NewDownloadModal';
import { useDownloadStore } from './stores/downloadStore';
import { useAppVersionStore } from './stores/appVersionStore';
import { useHardwareBanStore } from './stores/hardwareBanStore';
import { DevUpdateSimulator } from './components/DevUpdateSimulator';
import { ShutdownCountdownModal } from './components/Modals/ShutdownCountdownModal';
import { QueueGuideModal } from './components/Modals/QueueGuideModal';
import { SettingsView } from './components/SettingsView';
import { TelemetryView } from './components/TelemetryView';
import { SpeedtestView } from './components/SpeedtestView';
import { HardwareBannedView } from './components/HardwareBannedView';
import { onOpenNewDownloadModal, restoreManagerWindow, onNavigate, onCheckUpdatesFromTray, onOtaRollbackRecovered, notifyDomReady, onUiOpened, onHardwareBanChanged } from './services/tauriService';
import { updateService } from './services/updateService';
import { initHardwareEventService, ensureDirectiveStreamConnected } from './services/hardwareEventService';
import './App.css';

export const App: React.FC = () => {
  const [darkMode, setDarkMode] = useState(() => {
    try {
      const explicit = localStorage.getItem('downex_theme_explicit');
      if (explicit === 'true') {
        return localStorage.getItem('downex_theme') === 'dark';
      }
      return false; // Default: Light theme
    } catch {
      return false;
    }
  });

  const handleSetDarkMode = useCallback((val: boolean) => {
    try {
      localStorage.setItem('downex_theme_explicit', 'true');
    } catch {}

    const doc = typeof document !== 'undefined' ? (document as any) : null;

    const applyTheme = () => {
      setDarkMode(val);
      if (doc && doc.documentElement) {
        const root = doc.documentElement;
        if (val) {
          root.classList.add('dark');
          localStorage.setItem('downex_theme', 'dark');
        } else {
          root.classList.remove('dark');
          localStorage.setItem('downex_theme', 'light');
        }
      }
    };

    if (doc && typeof doc.startViewTransition === 'function') {
      doc.startViewTransition(() => {
        applyTheme();
      });
    } else if (doc && doc.documentElement) {
      const root = doc.documentElement;
      root.classList.add('theme-transitioning');
      applyTheme();
      setTimeout(() => {
        root.classList.remove('theme-transitioning');
      }, 260);
    } else {
      applyTheme();
    }
  }, []);
  const loadItems = useDownloadStore((state) => state.loadItems);
  const initListener = useDownloadStore((state) => state.initListener);
  const initVersion = useAppVersionStore((state) => state.initVersion);


  const setNewModalOpen = useDownloadStore((state) => state.setNewModalOpen);
  const openNewModalWithData = useDownloadStore((state) => state.openNewModalWithData);
  const selectedView = useDownloadStore((state) => state.selectedView);
  const setSelectedView = useDownloadStore((state) => state.setSelectedView);
  const showTelemetryOnHome = useDownloadStore((state) => state.showTelemetryOnHome);
  const status = useAppVersionStore((state) => state.status);
  const [rollbackAlert, setRollbackAlert] = useState<string | null>(null);

  // Centralized Reactive Silicon Hardware Ban State
  const isBanned = useHardwareBanStore((state) => state.isBanned);
  const isReinstating = useHardwareBanStore((state) => state.isReinstating);
  const hwid = useHardwareBanStore((state) => state.hwid);
  const banReason = useHardwareBanStore((state) => state.banReason);

  const triggerUiUpdateCheck = useCallback(() => {
    if (isBanned) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      // App is hidden in system tray: keep 100% idle and unaware!
      return;
    }
    useAppVersionStore.getState().checkForUpdates(true).then(() => {
      useAppVersionStore.getState().evaluateAndApplyUpdate();
    }).catch(() => {});
  }, [isBanned]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__DOWNEX_VERSION_STORE__ = useAppVersionStore;
      (window as any).__DOWNEX_DOWNLOAD_STORE__ = useDownloadStore;
    }
    initVersion();
    loadItems();
    const unlisten = initListener();

    // 1. User Activity Tracking for 5-Second Idle Guard
    const onUserAction = () => {
      updateService.recordUserActivity();
    };
    window.addEventListener('mousemove', onUserAction, { passive: true });
    window.addEventListener('mousedown', onUserAction, { passive: true });
    window.addEventListener('keydown', onUserAction, { passive: true });
    window.addEventListener('touchstart', onUserAction, { passive: true });
    window.addEventListener('wheel', onUserAction, { passive: true });

    // 2. Initial UI Open / Startup: Trigger detection strictly when the UI is visible to the user
    const startupCheckTimer = setTimeout(() => {
      triggerUiUpdateCheck();
    }, 1200);

    // 3. Window Focus & Visibility: Check when unminimized or focused
    let lastFocusCheck = Date.now();
    const handleFocus = () => {
      // Clear any stuck button focus state upon window regaining focus
      if (document.activeElement instanceof HTMLElement && document.activeElement !== document.getElementById('search-input')) {
        document.activeElement.blur();
      }
      const now = Date.now();
      if (now - lastFocusCheck > 3000) {
        lastFocusCheck = now;
        triggerUiUpdateCheck();
        ensureDirectiveStreamConnected();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now();
        if (now - lastFocusCheck > 3000) {
          lastFocusCheck = now;
          triggerUiUpdateCheck();
          ensureDirectiveStreamConnected();
        }
      }
    };
    const handleBlur = () => {
      if (document.activeElement instanceof HTMLElement && document.activeElement !== document.getElementById('search-input')) {
        document.activeElement.blur();
      }
    };
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Notify native Rust backend that DOM is rendered: Rust reveals the window
    // smoothly if interactive boot, or keeps window hidden if --background/--silent boot
    notifyDomReady().catch(() => {});

    return () => {
      clearTimeout(startupCheckTimer);
      window.removeEventListener('mousemove', onUserAction);
      window.removeEventListener('mousedown', onUserAction);
      window.removeEventListener('keydown', onUserAction);
      window.removeEventListener('touchstart', onUserAction);
      window.removeEventListener('wheel', onUserAction);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unlisten();
    };
  }, [initVersion, loadItems, initListener]);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem('downex_theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('downex_theme', 'light');
    }
  }, [darkMode]);

  // Global Ctrl+K / Ctrl+N shortcuts & Tray events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isSearchTrigger = ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') ||
        (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA');
      if (isSearchTrigger) {
        e.preventDefault();
        const searchInput = document.getElementById('search-input');
        const currentView = useDownloadStore.getState().selectedView;
        if (currentView === 'settings' || currentView === 'telemetry' || currentView === 'speedtest') {
          useDownloadStore.getState().setSelectedView('all');
          setTimeout(() => {
            const input = document.getElementById('search-input');
            if (input) input.focus();
          }, 120);
        } else if (searchInput) {
          searchInput.focus();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setNewModalOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // Browser preview fallback listener
    const handleBrowserOpen = (e: any) => {
      if (e.detail) {
        openNewModalWithData(e.detail);
      } else {
        setNewModalOpen(true);
      }
    };
    window.addEventListener('downex-open-new-download', handleBrowserOpen);

    const unlistenTrayModal = onOpenNewDownloadModal(() => {
      setNewModalOpen(true);
      restoreManagerWindow().catch(() => {});
    });


    const unlistenNavigate = onNavigate((view) => {
      if (view) setSelectedView(view);
    });

    const unlistenCheckUpdates = onCheckUpdatesFromTray(async () => {
      restoreManagerWindow().catch(() => {});
      await useAppVersionStore.getState().checkForUpdates(false);
    });

    // 4. System Tray Click / Reveal: Trigger update detection strictly when user opens UI from tray
    const unlistenUiOpened = onUiOpened(() => {
      triggerUiUpdateCheck();
      ensureDirectiveStreamConnected();
    });

    const unlistenRollback = onOtaRollbackRecovered((payload) => {
      setRollbackAlert(payload.version || 'Previous Stable');
    });

    // 5. Initialize Silicon Hardware Ban Status
    useHardwareBanStore.getState().initBanStatus();

    // 6. Real-time Silicon Hardware Directive Streaming & Fast Attestation
    const cleanupHardwareEvents = initHardwareEventService();

    // 7. Secondary Native Event Listener & Window Event Dispatcher
    const handleLocalBan = (e: any) => {
      if (e.detail) {
        useHardwareBanStore.getState().setBannedLive(Boolean(e.detail.is_banned), e.detail.reason);
      }
    };
    window.addEventListener('downex-ban-state-changed', handleLocalBan);

    const unlistenBan = onHardwareBanChanged((payload) => {
      useHardwareBanStore.getState().setBannedLive(payload.is_banned, payload.reason);
    });

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('downex-open-new-download', handleBrowserOpen);
      window.removeEventListener('downex-ban-state-changed', handleLocalBan);
      unlistenTrayModal();
      unlistenNavigate();
      unlistenCheckUpdates();
      unlistenUiOpened();
      unlistenRollback();
      unlistenBan();
      cleanupHardwareEvents();
    };
  }, [setNewModalOpen, openNewModalWithData, setSelectedView]);

  const isRestarting = status?.state === 'restarting';

  return (
    <>
      <div
        className={`w-screen h-screen flex flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden font-sans app-fade-container app-fade-in ${
          isRestarting ? 'fade-out' : ''
        }`}
      >
        {/* ONE Continuous Top Header Line across full window width */}
        <DownexWindowHeader />

        {/* Main App Body below Top Line */}
        <div className="flex-1 flex relative min-h-0 z-20">
          {/* Left Navigation Sidebar */}
          <DownexSidebar darkMode={darkMode} setDarkMode={handleSetDarkMode} isBanned={isBanned} isReinstating={isReinstating} />

          {/* Center Workspace */}
          <main className="flex-1 flex flex-col min-h-0 h-full overflow-hidden bg-white dark:bg-zinc-950">
            {rollbackAlert && (
              <div className="mx-4 mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 flex items-center justify-between text-xs animate-in slide-in-from-top-2 shrink-0">
                <div className="flex items-center gap-2.5">
                  <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />
                  <span>
                    <strong>Autonomous Rollback Safeguard:</strong> The latest update could not boot stably. Downex safely reverted your executable to verified operational version <strong>v{rollbackAlert}</strong>.
                  </span>
                </div>
                <button
                  onClick={() => setRollbackAlert(null)}
                  className="p-1 hover:bg-amber-500/20 rounded-md transition-colors cursor-pointer text-amber-600 dark:text-amber-400"
                  title="Dismiss"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {isReinstating ? (
              <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 bg-white dark:bg-zinc-950 select-none animate-in fade-in duration-200">
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="w-10 h-10 rounded-full border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center">
                    <RefreshCw className="w-4 h-4 text-emerald-600 dark:text-emerald-400 animate-spin" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[14px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                      Access restored
                    </p>
                    <p className="text-[12px] text-zinc-500 dark:text-zinc-400">
                      Restoring your settings...
                    </p>
                  </div>
                </div>
              </div>
            ) : isBanned ? (
              <div className="flex-1 flex flex-col min-h-0 h-full overflow-hidden animate-in fade-in duration-200">
                <HardwareBannedView hwid={hwid} reason={banReason} />
              </div>
            ) : selectedView === 'settings' ? (
              <SettingsView darkMode={darkMode} setDarkMode={handleSetDarkMode} />
            ) : selectedView === 'telemetry' ? (
              <TelemetryView onBack={() => setSelectedView('settings')} />
            ) : selectedView === 'speedtest' ? (
              <SpeedtestView onBack={() => setSelectedView('all')} />
            ) : (
              <div className="flex-1 flex flex-col min-h-0 h-full overflow-hidden animate-in fade-in duration-200">
                {/* Top Control Bar */}
                <div className="h-11 px-3.5 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800/60 shrink-0 gap-2.5">
                  {/* In-App Search Bar */}
                  <InAppSearchBar darkMode={darkMode} setDarkMode={handleSetDarkMode} />

                  {/* New Download Action Button */}
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Plus className="w-3.5 h-3.5 stroke-[2.5]" />}
                    onClick={() => setNewModalOpen(true)}
                    className="h-8 px-3 text-xs shrink-0"
                  >
                    New Download
                  </Button>
                </div>

                {/* Active Downloads List */}
                <DownloadTable />
              </div>
            )}
          </main>

          {/* Right Telemetry & Speed Sparkline Panel (Only when enabled in settings and not on settings page) */}
          {!isBanned && !isReinstating && showTelemetryOnHome && selectedView !== 'settings' && selectedView !== 'telemetry' && selectedView !== 'speedtest' && (
            <TelemetryWidget layout="sidebar" />
          )}
        </div>

        {/* Modals & Floating Notifications */}
        <NewDownloadModal />
        <ShutdownCountdownModal />
        <QueueGuideModal />
        <DevUpdateSimulator />
      </div>
    </>
  );
};

export default App;
