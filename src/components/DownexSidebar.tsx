import React, { useState, useEffect } from 'react';
import { Download, ListOrdered, Trash2, Settings, Minimize2, Moon, Sun, Plus, ChevronLeft, RefreshCw, Check, Activity } from 'lucide-react';
import { useDownloadStore } from '../stores/downloadStore';
import { useAppVersionStore } from '../stores/appVersionStore';
import { minimizeToBackground } from '../services/tauriService';
import { compareSemver } from '../utils/version';

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
  const status = useAppVersionStore((state) => state.status);
  const currentVersion = useAppVersionStore((state) => state.currentVersion);
  const formattedVersion = useAppVersionStore((state) => state.formattedVersion);
  const checkForUpdates = useAppVersionStore((state) => state.checkForUpdates);
  const openModal = useAppVersionStore((state) => state.openModal);

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

  // Keyboard shortcut lifecycle: Ctrl+B or F8 toggles sidebar pure view
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

  const queuedCount = items.filter((i) => i.status === 'queued').length;
  const trashCount = items.filter((i) => i.status === 'failed' || i.status === 'cancelled' || i.status === 'error').length;
  const isQueueRunning = useDownloadStore((state) => state.isQueueRunning);



  const navItems = [
    { id: 'all', label: 'All Downloads', icon: Download, count: items.length },
    { id: 'queues', label: 'Queues', icon: ListOrdered, count: queuedCount, highlight: isQueueRunning && queuedCount > 0 },
    { id: 'telemetry', label: 'Telemetry', icon: Activity },
    { id: 'add_url', label: 'Add URL', icon: Plus, isAction: true },
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'trash', label: 'Trash', icon: Trash2, count: trashCount },
  ];

  return (
    <aside
      className={`relative h-full flex flex-col justify-between select-none bg-zinc-50/70 dark:bg-zinc-900/40 border-r border-zinc-200/80 dark:border-zinc-800/60 shrink-0 transition-all duration-300 ease-in-out ${
        isCollapsed ? 'w-14 p-2' : 'w-[196px] p-2.5'
      }`}
    >
      {/* Dynamic Edge Arrow Button (Floating Pill on Divider) */}
      <button
        type="button"
        onClick={toggleCollapse}
        title={isCollapsed ? 'Expand Sidebar (Ctrl+B)' : 'Pure View / Collapse Sidebar (Ctrl+B)'}
        className="absolute -right-3 top-3.5 z-30 w-5.5 h-5.5 rounded-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-sm flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-700 active:scale-95 transition-all cursor-pointer group"
      >
        <ChevronLeft
          className={`w-3.5 h-3.5 transition-transform duration-300 ${
            isCollapsed ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Navigation Items */}
      <div className="flex flex-col gap-1 overflow-x-hidden pt-1.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isSelected = selectedView === item.id;
          const tooltip = `${item.label}${item.isAction ? ' (Ctrl+N)' : ''}${item.count !== undefined && item.count > 0 ? ` [${item.count}]` : ''}`;

          return (
            <button
              key={item.id}
              title={tooltip}
              onClick={() => {
                if (item.isAction) {
                  setNewModalOpen(true);
                } else {
                  setSelectedView(item.id);
                }
              }}
              className={`relative flex items-center transition-all cursor-pointer rounded-lg text-xs font-medium ${
                isCollapsed
                  ? 'w-10 h-10 mx-auto justify-center'
                  : 'justify-between px-3 py-2'
              } ${
                isSelected
                  ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-semibold shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/50 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-2.5'}`}>
                <Icon className="w-4 h-4 stroke-[2] shrink-0" />
                {!isCollapsed && <span className="truncate">{item.label}</span>}
              </div>

              {/* Badges / Shortcuts */}
              {!isCollapsed ? (
                item.isAction ? (
                  <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500">Ctrl+N</span>
                ) : item.count !== undefined && item.count > 0 ? (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${
                      isSelected
                        ? 'bg-zinc-800 text-zinc-200 dark:bg-zinc-200 dark:text-zinc-800'
                        : item.highlight
                        ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-semibold'
                        : 'bg-zinc-200/70 dark:bg-zinc-800/80 text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    {item.count}
                  </span>
                ) : null
              ) : (
                /* Collapsed Badge Dot / Number */
                item.count !== undefined && item.count > 0 ? (
                  <span
                    className={`absolute top-1 right-1 min-w-3.5 h-3.5 px-0.5 rounded-full text-[8px] font-mono font-bold flex items-center justify-center ${
                      item.highlight
                        ? 'bg-emerald-500 text-white animate-pulse'
                        : isSelected
                        ? 'bg-zinc-700 text-white dark:bg-zinc-300 dark:text-zinc-900'
                        : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200'
                    }`}
                  >
                    {item.count > 9 ? '9+' : item.count}
                  </span>
                ) : null
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom Actions */}
      <div className={`flex flex-col gap-1 pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60 ${isCollapsed ? 'items-center' : ''}`}>
        {/* Dynamic Check for Updates (GPN OTA Pipeline Optimized for Downex) */}
        {status.state === 'checking' ? (
          <div
            title="Checking GPHost for Downex updates..."
            className={`flex items-center rounded-lg text-xs font-mono text-zinc-500 bg-zinc-100/80 dark:bg-zinc-800/60 border border-zinc-200/50 dark:border-zinc-700/50 ${
              isCollapsed ? 'w-10 h-10 justify-center' : 'gap-2.5 px-3 py-2'
            }`}
          >
            <RefreshCw className="w-4 h-4 animate-spin text-zinc-500 shrink-0" />
            {!isCollapsed && <span className="truncate">Checking...</span>}
          </div>
        ) : status.state === 'available' && status.manifest && status.targetVersion && compareSemver(status.targetVersion, currentVersion) > 0 ? (
          <button
            type="button"
            onClick={openModal}
            title={`Downex Update Available: ${status.manifest.version} (Click to Review & Install)`}
            className={`group relative flex items-center rounded-xl text-xs bg-gradient-to-r from-violet-50 via-purple-50/70 to-indigo-50 dark:from-violet-950/40 dark:via-zinc-900 dark:to-indigo-950/40 border border-violet-200/90 dark:border-violet-800/60 text-violet-950 dark:text-violet-200 font-semibold cursor-pointer hover:border-violet-300 dark:hover:border-violet-700 transition-all shadow-xs overflow-hidden select-none ${
              isCollapsed ? 'w-10 h-10 justify-center' : 'justify-between px-3 py-2'
            }`}
          >
            {/* Ambient Dynamic Shimmer Sweep */}
            <div className="animate-badge-shimmer" />

            <div className={`relative z-10 flex items-center ${isCollapsed ? 'justify-center' : 'gap-2.5 overflow-hidden'}`}>
              <Download className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0 stroke-[2.2]" />
              {!isCollapsed && <span className="truncate font-semibold tracking-tight">Update</span>}
            </div>

            {!isCollapsed ? (
              <span className="relative z-10 text-[10px] font-mono px-2 py-0.5 rounded-full bg-violet-600 text-white font-bold shrink-0 shadow-2xs group-hover:scale-105 transition-transform">
                {status.manifest.version}
              </span>
            ) : (
              <span className="absolute top-1.5 right-1.5 flex h-2 w-2 z-20">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-violet-600" />
              </span>
            )}
          </button>
        ) : status.state === 'downloading' || status.state === 'verifying' ? (
          <button
            type="button"
            onClick={openModal}
            title={status.state === 'verifying' ? 'Verifying update package...' : `Downloading update: ${status.progress?.percentage || 0}%`}
            className={`group relative flex items-center rounded-xl text-xs bg-zinc-100/90 dark:bg-zinc-800/70 border border-zinc-200/80 dark:border-zinc-700/60 text-zinc-800 dark:text-zinc-200 font-semibold cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-600 transition-all shadow-xs overflow-hidden select-none ${
              isCollapsed ? 'w-10 h-10 justify-center' : 'justify-between px-3 py-2.5'
            }`}
          >
            <div className="animate-badge-shimmer" />
            <div className={`relative z-10 flex items-center ${isCollapsed ? 'justify-center' : 'gap-2.5 overflow-hidden'}`}>
              <RefreshCw className="w-4 h-4 animate-spin text-emerald-500 shrink-0" />
              {!isCollapsed && (
                <span className="truncate font-semibold tracking-tight">
                  {status.state === 'verifying' ? 'Verifying...' : 'Downloading...'}
                </span>
              )}
            </div>
            {!isCollapsed && (
              <span className="relative z-10 text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-600 text-white font-bold shrink-0 shadow-2xs">
                {status.state === 'verifying' ? '100%' : `${status.progress?.percentage || 0}%`}
              </span>
            )}
          </button>
        ) : status.state === 'ready' && status.targetVersion && compareSemver(status.targetVersion, currentVersion) > 0 ? (
          <button
            type="button"
            onClick={openModal}
            title="Update Ready - Click to Restart & Apply"
            className={`group relative flex items-center rounded-xl text-xs bg-gradient-to-r from-emerald-50 via-teal-50/70 to-emerald-50 dark:from-emerald-950/40 dark:via-zinc-900 dark:to-teal-950/40 border border-emerald-200/90 dark:border-emerald-800/60 text-emerald-950 dark:text-emerald-200 font-semibold cursor-pointer hover:border-emerald-300 dark:hover:border-emerald-700 transition-all shadow-xs overflow-hidden select-none ${
              isCollapsed ? 'w-10 h-10 justify-center' : 'justify-between px-3 py-2.5'
            }`}
          >
            {/* Ambient Dynamic Shimmer Sweep */}
            <div className="animate-badge-shimmer" />

            <div className={`relative z-10 flex items-center ${isCollapsed ? 'justify-center' : 'gap-2.5 overflow-hidden'}`}>
              <RefreshCw className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 animate-spin" style={{ animationDuration: '4s' }} />
              {!isCollapsed && <span className="truncate font-semibold tracking-tight">Apply Update</span>}
            </div>

            {!isCollapsed ? (
              <span className="relative z-10 text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-600 text-white font-bold shrink-0 shadow-2xs group-hover:scale-105 transition-transform">
                READY
              </span>
            ) : (
              <span className="absolute top-1.5 right-1.5 flex h-2 w-2 z-20">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-600" />
              </span>
            )}
          </button>
        ) : status.state === 'up-to-date' ? (
          <button
            type="button"
            onClick={async () => {
              openModal();
              await checkForUpdates(false);
            }}
            title={`Downex is up to date (${formattedVersion}). Click to check again.`}
            className={`flex items-center rounded-lg text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-800/40 hover:bg-emerald-100/60 dark:hover:bg-emerald-900/30 cursor-pointer transition-colors ${
              isCollapsed ? 'w-10 h-10 justify-center' : 'justify-between px-3 py-2'
            }`}
          >
            <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-2.5 overflow-hidden'}`}>
              <Check className="w-4 h-4 text-emerald-500 shrink-0 stroke-[2.5]" />
              {!isCollapsed && <span className="truncate">Up to date</span>}
            </div>
            {!isCollapsed && (
              <span className="text-[10px] font-mono text-emerald-600/80 dark:text-emerald-400/80 shrink-0">
                {formattedVersion}
              </span>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={async () => {
              openModal();
              await checkForUpdates(false);
            }}
            title={`Check for Updates (${formattedVersion})`}
            className={`flex items-center rounded-lg text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/50 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer transition-colors ${
              isCollapsed ? 'w-10 h-10 justify-center' : 'justify-between px-3 py-2'
            }`}
          >
            <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-2.5 overflow-hidden'}`}>
              <RefreshCw className="w-4 h-4 shrink-0" />
              {!isCollapsed && <span className="truncate">Updates</span>}
            </div>
            {!isCollapsed && (
              <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 shrink-0">
                {formattedVersion}
              </span>
            )}
          </button>
        )}

        <button
          onClick={() => setDarkMode(!darkMode)}
          title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          className={`flex items-center rounded-lg text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors ${
            isCollapsed ? 'w-10 h-10 justify-center' : 'gap-2.5 px-3 py-2'
          }`}
        >
          {darkMode ? <Sun className="w-4 h-4 shrink-0" /> : <Moon className="w-4 h-4 shrink-0" />}
          {!isCollapsed && <span className="truncate">{darkMode ? 'Light Mode' : 'Dark Mode'}</span>}
        </button>

        <button
          onClick={minimizeToBackground}
          title="Hide to System Tray (Keep running in background)"
          className={`flex items-center rounded-lg text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors ${
            isCollapsed ? 'w-10 h-10 justify-center' : 'gap-2.5 px-3 py-2'
          }`}
        >
          <Minimize2 className="w-4 h-4 shrink-0" />
          {!isCollapsed && <span className="truncate">Hide to Tray</span>}
        </button>
      </div>
    </aside>
  );
};

