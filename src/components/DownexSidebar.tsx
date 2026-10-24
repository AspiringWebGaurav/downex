import React, { useState, useEffect } from 'react';
import { Download, PlayCircle, ListOrdered, CheckCircle2, Trash2, Settings, Power, Moon, Sun, Plus, ChevronLeft, RefreshCw, Check, Sparkles } from 'lucide-react';
import { useDownloadStore } from '../stores/downloadStore';
import { useAppVersionStore } from '../stores/appVersionStore';
import { quitApp } from '../services/tauriService';

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

  const selectedCategory = useDownloadStore((state) => state.selectedCategory);
  const setSelectedCategory = useDownloadStore((state) => state.setSelectedCategory);
  const setNewModalOpen = useDownloadStore((state) => state.setNewModalOpen);
  const items = useDownloadStore((state) => state.items);
  const status = useAppVersionStore((state) => state.status);
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

  const activeCount = items.filter((i) => i.status === 'downloading' || i.status === 'probing').length;
  const completedCount = items.filter((i) => i.status === 'completed').length;
  const queuedCount = items.filter((i) => i.status === 'queued').length;
  const isQueueRunning = useDownloadStore((state) => state.isQueueRunning);

  const navItems = [
    { id: 'all', label: 'All Downloads', icon: Download, count: items.length },
    { id: 'active', label: 'Active', icon: PlayCircle, count: activeCount, highlight: activeCount > 0 },
    { id: 'queues', label: 'Queues', icon: ListOrdered, count: queuedCount, highlight: isQueueRunning && queuedCount > 0 },
    { id: 'completed', label: 'Completed', icon: CheckCircle2, count: completedCount },
    { id: 'add_url', label: 'Add URL', icon: Plus, isAction: true },
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'trash', label: 'Trash', icon: Trash2 },
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

      {/* Top Header & Navigation Items */}
      <div className="flex flex-col gap-1 overflow-x-hidden">
        {/* Header */}
        {isCollapsed ? (
          <div className="py-1 mb-2 flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={toggleCollapse}
              title="Expand Sidebar (Ctrl+B)"
              className="p-1 rounded-lg hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <img src="/icon.png" alt="Downex" className="w-5 h-5 rounded-xs" />
            </button>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" title="Ready" />
          </div>
        ) : (
          <div className="px-2.5 py-1.5 mb-2 flex items-center gap-2">
            <img src="/icon.png" alt="Downex" className="w-5 h-5 rounded-xs shrink-0" />
            <span className="font-bold text-xs tracking-tight text-zinc-900 dark:text-zinc-100">
              Downex
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title="Core Ready" />
          </div>
        )}

        {/* Navigation Items */}
        {navItems.map((item) => {
          const Icon = item.icon;
          const isSelected = selectedCategory === item.id;
          const tooltip = `${item.label}${item.isAction ? ' (Ctrl+N)' : ''}${item.count !== undefined && item.count > 0 ? ` [${item.count}]` : ''}`;

          return (
            <button
              key={item.id}
              title={tooltip}
              onClick={() => {
                if (item.isAction) {
                  setNewModalOpen(true);
                } else {
                  setSelectedCategory(item.id);
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
        ) : status.state === 'available' && status.manifest ? (
          <button
            type="button"
            onClick={openModal}
            title={`Downex Update Available: ${status.manifest.version} (Click to Review & Install)`}
            className={`relative flex items-center rounded-lg text-xs bg-violet-50 dark:bg-violet-950/60 border border-violet-300 dark:border-violet-800 text-violet-700 dark:text-violet-300 font-semibold cursor-pointer hover:bg-violet-100 dark:hover:bg-violet-900/50 transition-all shadow-xs animate-pulse ${
              isCollapsed ? 'w-10 h-10 justify-center' : 'justify-between px-3 py-2'
            }`}
          >
            <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-2.5 overflow-hidden'}`}>
              <Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0" />
              {!isCollapsed && <span className="truncate">Update</span>}
            </div>
            {!isCollapsed ? (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-violet-600 text-white font-bold shrink-0">
                {status.manifest.version}
              </span>
            ) : (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-violet-600 animate-ping" />
            )}
          </button>
        ) : status.state === 'ready' ? (
          <button
            type="button"
            onClick={openModal}
            title="Update Ready - Click to Restart & Apply"
            className={`relative flex items-center rounded-lg text-xs bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 font-semibold cursor-pointer hover:bg-emerald-100 transition-all shadow-xs ${
              isCollapsed ? 'w-10 h-10 justify-center' : 'justify-between px-3 py-2'
            }`}
          >
            <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-2.5 overflow-hidden'}`}>
              <RefreshCw className="w-4 h-4 text-emerald-600 shrink-0 animate-pulse" />
              {!isCollapsed && <span className="truncate">Apply Update</span>}
            </div>
            {!isCollapsed ? (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-600 text-white font-bold shrink-0">
                READY
              </span>
            ) : (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-500" />
            )}
          </button>
        ) : status.state === 'up-to-date' ? (
          <button
            type="button"
            onClick={() => checkForUpdates(false)}
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
            onClick={() => checkForUpdates(false)}
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
          onClick={quitApp}
          title="Quit Downex"
          className={`flex items-center rounded-lg text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer transition-colors ${
            isCollapsed ? 'w-10 h-10 justify-center' : 'gap-2.5 px-3 py-2'
          }`}
        >
          <Power className="w-4 h-4 shrink-0" />
          {!isCollapsed && <span className="truncate">Quit Downex</span>}
        </button>
      </div>
    </aside>
  );
};

