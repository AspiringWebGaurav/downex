import React, { useEffect, useState } from 'react';
import { Button } from './components/ui/Button';
import { Plus, ShieldAlert, X } from 'lucide-react';
import { DownexWindowHeader } from './components/DownexWindowHeader';
import { DownexSidebar } from './components/DownexSidebar';
import { DownloadTable } from './components/DownloadTable';
import { InAppSearchBar } from './components/InAppSearchBar';
import { TelemetryWidget } from './components/TelemetryWidget';
import { NewDownloadModal } from './components/NewDownloadModal';
import { useDownloadStore } from './stores/downloadStore';
import { useAppVersionStore } from './stores/appVersionStore';
import { UpdateModal } from './components/UpdateModal';
import { UpdateNotification } from './components/UpdateNotification';
import { DevUpdateSimulator } from './components/DevUpdateSimulator';
import { PatchNotesModal } from './components/PatchNotesModal';
import { QueueGuideModal } from './components/Modals/QueueGuideModal';
import { SettingsView } from './components/SettingsView';
import { TelemetryView } from './components/TelemetryView';
import { onOpenNewDownloadModal, restoreManagerWindow, onNavigate, onCheckUpdatesFromTray, onOtaRollbackRecovered, notifyDomReady } from './services/tauriService';
import './App.css';

export const App: React.FC = () => {
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('downex_theme');
    return saved === 'dark'; // Default is light theme
  });
  const loadItems = useDownloadStore((state) => state.loadItems);
  const initListener = useDownloadStore((state) => state.initListener);
  const initVersion = useAppVersionStore((state) => state.initVersion);


  const setNewModalOpen = useDownloadStore((state) => state.setNewModalOpen);
  const openNewModalWithData = useDownloadStore((state) => state.openNewModalWithData);
  const selectedView = useDownloadStore((state) => state.selectedView);
  const setSelectedView = useDownloadStore((state) => state.setSelectedView);
  const showTelemetryOnHome = useDownloadStore((state) => state.showTelemetryOnHome);
  const [rollbackAlert, setRollbackAlert] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__DOWNEX_VERSION_STORE__ = useAppVersionStore;
      (window as any).__DOWNEX_DOWNLOAD_STORE__ = useDownloadStore;
    }
    initVersion();
    loadItems();
    const unlisten = initListener();

    // Re-check updates when window regains focus if > 30s elapsed (GPN pattern)
    let lastFocusCheck = Date.now();
    const handleFocus = () => {
      // Clear any stuck button focus state upon window regaining focus
      if (document.activeElement instanceof HTMLElement && document.activeElement !== document.getElementById('search-input')) {
        document.activeElement.blur();
      }
      const now = Date.now();
      if (now - lastFocusCheck > 30000) {
        lastFocusCheck = now;
        useAppVersionStore.getState().checkForUpdates(true);
      }
    };
    const handleBlur = () => {
      if (document.activeElement instanceof HTMLElement && document.activeElement !== document.getElementById('search-input')) {
        document.activeElement.blur();
      }
    };
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    // Notify native Rust backend that DOM is rendered: Rust reveals the window
    // smoothly if interactive boot, or keeps window hidden if --background/--silent boot
    notifyDomReady().catch(() => {});

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
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
        if (currentView === 'settings' || currentView === 'telemetry') {
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
      useAppVersionStore.getState().openModal();
      await useAppVersionStore.getState().checkForUpdates(false);
    });

    const unlistenRollback = onOtaRollbackRecovered((payload) => {
      setRollbackAlert(payload.version || 'Previous Stable');
    });

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('downex-open-new-download', handleBrowserOpen);
      unlistenTrayModal();
      unlistenNavigate();
      unlistenCheckUpdates();
      unlistenRollback();
    };
  }, [setNewModalOpen, openNewModalWithData, setSelectedView]);

  return (
    <div className="w-screen h-screen flex flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden font-sans">
      {/* GPN-Style Frameless Window Header with Close X Button */}
      <DownexWindowHeader />

      {/* Main App Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Navigation Sidebar */}
        <DownexSidebar darkMode={darkMode} setDarkMode={setDarkMode} />

        {/* Center Workspace */}
        <main className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-zinc-950">
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
          {selectedView === 'settings' ? (
            <SettingsView darkMode={darkMode} setDarkMode={setDarkMode} />
          ) : selectedView === 'telemetry' ? (
            <TelemetryView onBack={() => setSelectedView('settings')} />
          ) : (
            <>
              {/* Top Control Bar */}
              <div className="h-14 px-4 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800/60 shrink-0 gap-3">
                {/* In-App Search Bar */}
                <InAppSearchBar darkMode={darkMode} setDarkMode={setDarkMode} />












                {/* New Download Action Button */}
                <Button
                  variant="primary"
                  size="md"
                  icon={<Plus className="w-4 h-4 stroke-[2.5]" />}
                  onClick={() => setNewModalOpen(true)}
                >
                  New Download
                </Button>
              </div>

              {/* Active Downloads List */}
              <DownloadTable />
            </>
          )}
        </main>

        {/* Right Telemetry & Speed Sparkline Panel (Only when enabled in settings and not on settings page) */}
        {showTelemetryOnHome && selectedView !== 'settings' && selectedView !== 'telemetry' && (
          <TelemetryWidget layout="sidebar" />
        )}
      </div>

      {/* Modals & Floating Notifications */}
      <NewDownloadModal />
      <UpdateModal />
      <UpdateNotification />
      <PatchNotesModal />
      <QueueGuideModal />
      <DevUpdateSimulator />
    </div>
  );
};

export default App;
