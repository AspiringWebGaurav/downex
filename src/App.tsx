import React, { useEffect, useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { DownexWindowHeader } from './components/DownexWindowHeader';
import { DownexSidebar } from './components/DownexSidebar';
import { DownloadTable } from './components/DownloadTable';
import { TelemetryWidget } from './components/TelemetryWidget';
import { NewDownloadModal } from './components/NewDownloadModal';
import { useDownloadStore } from './stores/downloadStore';
import { useAppVersionStore } from './stores/appVersionStore';
import { UpdateModal } from './components/UpdateModal';
import { SettingsView } from './components/SettingsView';
import { onOpenNewDownloadModal, onOpenDownloadInfoModal } from './services/tauriService';
import './App.css';

export const App: React.FC = () => {
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('downex_theme');
    return saved === 'dark'; // Default is light theme
  });
  const loadItems = useDownloadStore((state) => state.loadItems);
  const initListener = useDownloadStore((state) => state.initListener);
  const initVersion = useAppVersionStore((state) => state.initVersion);
  const searchQuery = useDownloadStore((state) => state.searchQuery);
  const setSearchQuery = useDownloadStore((state) => state.setSearchQuery);
  const isNewModalOpen = useDownloadStore((state) => state.isNewModalOpen);
  const setNewModalOpen = useDownloadStore((state) => state.setNewModalOpen);
  const isStandaloneModal = useDownloadStore((state) => state.isStandaloneModal);
  const openNewModalWithData = useDownloadStore((state) => state.openNewModalWithData);
  const selectedCategory = useDownloadStore((state) => state.selectedCategory);
  const showTelemetryOnHome = useDownloadStore((state) => state.showTelemetryOnHome);

  useEffect(() => {
    initVersion();
    loadItems();
    const unlisten = initListener();
    return () => unlisten();
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

  // Global Ctrl+K / Ctrl+N shortcuts & Tray / Browser Extension Download Intercept Events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setNewModalOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    const unlistenTrayModal = onOpenNewDownloadModal(() => {
      setNewModalOpen(true);
    });

    // IDM-style: When extension intercepts a link, pop up the Download File Info modal with probed data!
    const unlistenInterceptModal = onOpenDownloadInfoModal((payload) => {
      openNewModalWithData(payload);
    });

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      unlistenTrayModal();
      unlistenInterceptModal();
    };
  }, [setNewModalOpen, openNewModalWithData]);

  // Requirement 2: If intercepted from browser while manager is in background, show ONLY the modal dialog
  if (isStandaloneModal && isNewModalOpen) {
    return (
      <div className="w-screen h-screen bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 overflow-hidden font-sans select-none flex flex-col">
        <NewDownloadModal isStandalone={true} />
      </div>
    );
  }

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
          {selectedCategory === 'settings' ? (
            <SettingsView darkMode={darkMode} setDarkMode={setDarkMode} />
          ) : (
            <>
              {/* Top Control Bar */}
              <div className="h-14 px-4 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800/60 shrink-0 gap-3">
                {/* Search Input */}
                <div className="relative flex-1 max-w-md">
                  <input
                    id="search-input"
                    type="text"
                    placeholder="Search downloads... (Ctrl+K)"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-3 py-1.5 pl-8 text-xs font-mono rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-transparent focus:border-zinc-300 dark:focus:border-zinc-700 focus:outline-none transition-all placeholder:text-zinc-400"
                  />
                  <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                </div>

                {/* New Download Action Button */}
                <button
                  onClick={() => setNewModalOpen(true)}
                  className="px-3.5 py-1.5 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-semibold text-xs flex items-center gap-1.5 shadow-xs hover:opacity-90 active:scale-[0.98] transition-all cursor-pointer"
                >
                  <Plus className="w-4 h-4 stroke-[2.5]" />
                  <span>New Download</span>
                </button>
              </div>

              {/* Active Downloads List */}
              <DownloadTable />
            </>
          )}
        </main>

        {/* Right Telemetry & Speed Sparkline Panel (Only when enabled in settings and not on settings page) */}
        {showTelemetryOnHome && selectedCategory !== 'settings' && (
          <TelemetryWidget layout="sidebar" />
        )}
      </div>

      {/* Modals */}
      <NewDownloadModal />
      <UpdateModal />
    </div>
  );
};

export default App;
