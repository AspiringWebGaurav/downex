import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  SearchX,
  Loader2,
  X,
  File,
  ListOrdered,
  Activity,
  Settings,
  Trash2,
  Plus,
  Moon,
  Sun,
  RotateCcw,
  FileText,
  HelpCircle,

  Sparkles,
  Command,
  Download,
  FolderOpen,
} from 'lucide-react';
import { useDownloadStore } from '../stores/downloadStore';

import { formatBytes } from '../utils/format';

export type SearchLifecycle = 'idle' | 'searching' | 'success' | 'empty';

export interface InAppSearchResult {
  id: string;
  layer: 'downloads' | 'navigation' | 'actions';
  layerLabel: string;
  title: string;
  subtitle: string;
  badge?: string;
  badgeColor?: string;
  icon: React.ReactNode;
  action: () => void;
}

interface InAppSearchBarProps {
  darkMode: boolean;
  setDarkMode: (val: boolean) => void;
}

export const InAppSearchBar: React.FC<InAppSearchBarProps> = ({ darkMode, setDarkMode }) => {
  const searchQuery = useDownloadStore((state) => state.searchQuery);
  const setSearchQuery = useDownloadStore((state) => state.setSearchQuery);
  const items = useDownloadStore((state) => state.items);

  const setSelectedView = useDownloadStore((state) => state.setSelectedView);
  const setNewModalOpen = useDownloadStore((state) => state.setNewModalOpen);
  const setQueueGuideOpen = useDownloadStore((state) => state.setQueueGuideOpen);
  const openSettingsSubView = useDownloadStore((state) => state.openSettingsSubView);
  const isQueueRunning = useDownloadStore((state) => state.isQueueRunning);
  const startQueue = useDownloadStore((state) => state.startQueue);
  const pauseQueue = useDownloadStore((state) => state.pauseQueue);

  const [isFocused, setIsFocused] = useState(false);
  const [isDebouncing, setIsDebouncing] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced search typing lifecycle simulation (120ms)
  useEffect(() => {
    if (!searchQuery.trim()) {
      setIsDebouncing(false);
      return;
    }
    setIsDebouncing(true);
    const timer = setTimeout(() => {
      setIsDebouncing(false);
    }, 120);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const cleanQuery = searchQuery.trim().toLowerCase();

  // Multi-Layer Search Index Engine
  const { downloadMatches, navMatches, actionMatches, flatResults } = useMemo(() => {
    if (!cleanQuery) {
      return { downloadMatches: [], navMatches: [], actionMatches: [], flatResults: [] };
    }

    // 1. Layer: Downloads (Match filename, URL, path, extension, status)
    const downloadMatches: InAppSearchResult[] = items
      .filter((item) => {
        if (item.filename?.toLowerCase().includes(cleanQuery)) return true;
        if (item.url?.toLowerCase().includes(cleanQuery)) return true;
        if (item.destination_path?.toLowerCase().includes(cleanQuery)) return true;
        const ext = item.filename?.split('.').pop()?.toLowerCase();
        if (ext && (ext.includes(cleanQuery) || `.${ext}`.includes(cleanQuery))) return true;
        if (item.status?.toLowerCase().includes(cleanQuery)) return true;
        return false;
      })
      .slice(0, 5) // Top 5 downloads in popover
      .map((item) => ({
        id: `download-${item.id}`,
        layer: 'downloads',
        layerLabel: 'Downloads',
        title: item.filename,
        subtitle: `${formatBytes(item.total_bytes || item.downloaded_bytes)} • ${item.status} • ${item.destination_path || 'Default Folder'}`,
        badge: item.status.toUpperCase(),
        badgeColor:
          item.status === 'completed'
            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300/80 dark:border-emerald-800/80'
            : item.status === 'downloading'
            ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-300/80 dark:border-blue-800/80'
            : item.status === 'queued'
            ? 'bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border-purple-300/80 dark:border-purple-800/80'
            : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700',
        icon: <File className="w-4 h-4 text-zinc-500 shrink-0" />,
        action: () => {
          setSelectedView('all');
          setIsFocused(false);
        },
      }));

    // 2. Layer: App Navigation Sections
    const navigationCatalog = [
      {
        id: 'all',
        title: 'All Downloads',
        subtitle: 'View all active, completed, and queued downloads',
        keywords: ['all', 'downloads', 'home', 'files', 'everything', 'main'],
        icon: <File className="w-4 h-4 text-emerald-500" />,
      },
      {
        id: 'active',
        title: 'Active Downloads',
        subtitle: 'View running, connecting, and accelerating downloads',
        keywords: ['active', 'running', 'downloading', 'current', 'live', 'speed'],
        icon: <Download className="w-4 h-4 text-blue-500" />,
      },
      {
        id: 'completed',
        title: 'Completed Downloads',
        subtitle: 'View finished downloads and open destination folders',
        keywords: ['completed', 'finished', 'done', 'saved', 'success'],
        icon: <FolderOpen className="w-4 h-4 text-emerald-600" />,
      },
      {
        id: 'queues',
        title: 'Queues (Simple 1-by-1 Queue)',
        subtitle: 'Sequential bandwidth prioritization for queued items',
        keywords: ['queue', 'queues', '1-by-1', 'sequential', 'order', 'priority', 'list'],
        icon: <ListOrdered className="w-4 h-4 text-violet-500" />,
      },
      {
        id: 'telemetry',
        title: 'Speed & Stats',
        subtitle: 'Real-time throughput sensors, historical sparklines & disk space',
        keywords: ['speed', 'stats', 'telemetry', 'chart', 'bandwidth', 'sensors', 'network', 'mbps'],
        icon: <Activity className="w-4 h-4 text-emerald-500" />,
      },
      {
        id: 'settings',
        title: 'Settings & Preferences',
        subtitle: 'Configure download folder, startup behavior, and system tray',
        keywords: ['settings', 'preferences', 'config', 'options', 'tray', 'startup', 'folder', 'defaults', 'repair'],
        icon: <Settings className="w-4 h-4 text-zinc-500" />,
      },
      {
        id: 'trash',
        title: 'Trash',
        subtitle: 'Inspect failed, cancelled, and purged downloads',
        keywords: ['trash', 'recycle', 'bin', 'failed', 'cancelled', 'errors', 'deleted'],
        icon: <Trash2 className="w-4 h-4 text-rose-500" />,
      },
    ];

    const navMatches: InAppSearchResult[] = navigationCatalog
      .filter(
        (nav) =>
          nav.title.toLowerCase().includes(cleanQuery) ||
          nav.subtitle.toLowerCase().includes(cleanQuery) ||
          nav.keywords.some((k) => k.includes(cleanQuery))
      )
      .map((nav) => ({
        id: `nav-${nav.id}`,
        layer: 'navigation',
        layerLabel: 'App Sections',
        title: nav.title,
        subtitle: nav.subtitle,
        badge: 'SECTION',
        badgeColor: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700',
        icon: nav.icon,
        action: () => {
          setSelectedView(nav.id);
          setIsFocused(false);
        },
      }));

    // 3. Layer: Quick Commands & Actions
    const actionsCatalog = [
      {
        id: 'action-new-download',
        title: 'New Download',
        subtitle: 'Open dialog to add a new URL or direct download link (Ctrl+N)',
        keywords: ['new', 'add', 'download', 'url', 'link', 'http', 'https', 'create'],
        icon: <Plus className="w-4 h-4 text-emerald-500" />,
        action: () => setNewModalOpen(true),
      },
      {
        id: 'action-toggle-theme',
        title: darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode',
        subtitle: darkMode ? 'Set bright, clean daytime theme' : 'Set high-contrast dark theme',
        keywords: ['theme', 'dark', 'light', 'mode', 'night', 'day', 'appearance', 'color'],
        icon: darkMode ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-indigo-500" />,
        action: () => setDarkMode(!darkMode),
      },
      {
        id: 'action-queue-guide',
        title: 'How 1-by-1 Queue Works?',
        subtitle: 'Interactive tutorial on sequential download acceleration',
        keywords: ['how it works', 'queue guide', 'help', 'tutorial', 'learn', 'guide'],
        icon: <HelpCircle className="w-4 h-4 text-purple-500" />,
        action: () => setQueueGuideOpen(true),
      },
      {
        id: 'action-patch-notes',
        title: 'Release Changelogs & Patch Notes',
        subtitle: 'Inspect version changes, release history, and updates',
        keywords: ['changelog', 'patch', 'notes', 'release', 'version', 'updates', 'history'],
        icon: <FileText className="w-4 h-4 text-blue-500" />,
        action: () => openSettingsSubView('patch-notes'),
      },
      {
        id: 'action-reset-settings',
        title: 'Reset Settings to Defaults',
        subtitle: 'Enable system tray and Windows startup by default',
        keywords: ['reset', 'defaults', 'restore', 'factory', 'settings'],
        icon: <RotateCcw className="w-4 h-4 text-amber-500" />,
        action: () => {
          setSelectedView('settings');
        },
      },
      {
        id: 'action-toggle-queue',
        title: isQueueRunning ? 'Pause 1-by-1 Queue' : 'Start 1-by-1 Queue',
        subtitle: isQueueRunning ? 'Pause sequential download processing' : 'Process queued downloads one by one',
        keywords: ['start queue', 'pause queue', 'run queue', 'queue'],
        icon: <ListOrdered className="w-4 h-4 text-emerald-500" />,
        action: () => (isQueueRunning ? pauseQueue() : startQueue()),
      },
    ];

    const actionMatches: InAppSearchResult[] = actionsCatalog
      .filter(
        (act) =>
          act.title.toLowerCase().includes(cleanQuery) ||
          act.subtitle.toLowerCase().includes(cleanQuery) ||
          act.keywords.some((k) => k.includes(cleanQuery))
      )
      .map((act) => ({
        id: act.id,
        layer: 'actions',
        layerLabel: 'Quick Actions',
        title: act.title,
        subtitle: act.subtitle,
        badge: 'ACTION',
        badgeColor: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300/80 dark:border-emerald-800/80',
        icon: act.icon,
        action: () => {
          act.action();
          setIsFocused(false);
        },
      }));

    const flatResults = [...downloadMatches, ...navMatches, ...actionMatches];
    return { downloadMatches, navMatches, actionMatches, flatResults };
  }, [
    cleanQuery,
    items,
    darkMode,
    isQueueRunning,
    setSelectedView,
    setNewModalOpen,
    setQueueGuideOpen,
    openSettingsSubView,
    setDarkMode,
    startQueue,
    pauseQueue,
  ]);

  // Determine current search lifecycle
  const lifecycle: SearchLifecycle = useMemo(() => {
    if (!cleanQuery) return 'idle';
    if (isDebouncing) return 'searching';
    if (flatResults.length > 0) return 'success';
    return 'empty';
  }, [cleanQuery, isDebouncing, flatResults.length]);

  // Keep selected index within bounds
  useEffect(() => {
    setSelectedIndex(0);
  }, [flatResults.length, cleanQuery]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flatResults.length > 0) {
        setSelectedIndex((prev) => (prev + 1) % flatResults.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flatResults.length > 0) {
        setSelectedIndex((prev) => (prev - 1 + flatResults.length) % flatResults.length);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flatResults.length > 0 && flatResults[selectedIndex]) {
        flatResults[selectedIndex].action();
      } else {
        // If query entered, keep search filter in table and blur popover
        setIsFocused(false);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setSearchQuery('');
      setIsFocused(false);
      inputRef.current?.blur();
    }
  };

  const handleClear = () => {
    setSearchQuery('');
    setSelectedIndex(0);
    inputRef.current?.focus();
  };

  const totalMatchesCount = flatResults.length;
  const activeLayersCount = [
    downloadMatches.length > 0,
    navMatches.length > 0,
    actionMatches.length > 0,
  ].filter(Boolean).length;

  return (
    <div ref={containerRef} className="relative flex-1 max-w-md select-none">
      {/* Search Input Bar */}
      <div className="relative flex items-center">
        {/* Left Status Icon depending on lifecycle */}
        <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center">
          {lifecycle === 'searching' ? (
            <Loader2 className="w-3.5 h-3.5 text-emerald-500 animate-spin" />
          ) : lifecycle === 'empty' ? (
            <SearchX className="w-3.5 h-3.5 text-amber-500" />
          ) : lifecycle === 'success' ? (
            <Search className="w-3.5 h-3.5 text-emerald-500 stroke-[2.2]" />
          ) : (
            <Search className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" />
          )}
        </div>

        <input
          ref={inputRef}
          id="search-input"
          type="text"
          placeholder="Search in app... (Ctrl+K)"
          aria-label="Search in app"
          value={searchQuery}
          onFocus={() => setIsFocused(true)}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className={`w-full px-3 py-1.5 pl-8 pr-20 text-xs font-mono rounded-lg bg-zinc-100 dark:bg-zinc-900 border transition-all placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none ${
            lifecycle === 'empty'
              ? 'border-amber-300 dark:border-amber-800/80 focus:border-amber-500'
              : lifecycle === 'success'
              ? 'border-emerald-300/80 dark:border-emerald-800/80 focus:border-emerald-500'
              : 'border-transparent focus:border-zinc-300 dark:focus:border-zinc-700'
          }`}
        />

        {/* Right Status Badges & Controls */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
          {cleanQuery ? (
            <>
              {/* Match Count Badge */}
              {lifecycle === 'searching' ? (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-200/60 dark:bg-zinc-800 text-zinc-500">
                  Scanning...
                </span>
              ) : lifecycle === 'empty' ? (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-amber-100/80 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-300/70 dark:border-amber-800/70">
                  0 matches
                </span>
              ) : (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-100/80 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-300/70 dark:border-emerald-800/70">
                  {totalMatchesCount} found
                </span>
              )}

              {/* 1-Click Clear Button */}
              <button
                type="button"
                onClick={handleClear}
                className="p-1 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                title="Clear search (Esc)"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <kbd className="hidden sm:inline-block text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-200/70 dark:bg-zinc-800 text-zinc-500 border border-zinc-300/60 dark:border-zinc-700/60 select-none">
              Ctrl+K
            </kbd>
          )}
        </div>
      </div>

      {/* In-App Search Popover Dropdown (Lifecycles & All Layers) */}
      {isFocused && cleanQuery && (
        <div className="absolute top-full left-0 right-0 mt-1.5 p-1.5 bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800/90 rounded-xl shadow-2xl z-50 max-h-96 overflow-y-auto animate-in fade-in-50 zoom-in-95 duration-150">
          {/* Header Lifecycle Indicator */}
          <div className="px-2.5 py-1.5 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800/80 mb-1">
            <span className="text-[10px] font-semibold tracking-wider uppercase text-zinc-400 dark:text-zinc-500">
              {lifecycle === 'searching'
                ? 'Searching all app layers...'
                : lifecycle === 'empty'
                ? 'Search Fail • No Matches'
                : `Search in App • ${totalMatchesCount} Results across ${activeLayersCount} Layers`}
            </span>
            <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500">
              ↑↓ Navigate • ↵ Select • Esc Clear
            </span>
          </div>

          {/* SUCCESS STATE: Results grouped by layer */}
          {lifecycle === 'success' && (
            <div className="space-y-2">
              {/* Layer 1: Downloads */}
              {downloadMatches.length > 0 && (
                <div>
                  <div className="px-2.5 py-1 text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                    <File className="w-3 h-3 text-zinc-400" />
                    <span>Downloads ({downloadMatches.length})</span>
                  </div>
                  <div className="space-y-0.5">
                    {downloadMatches.map((item) => {
                      const itemIndex = flatResults.findIndex((r) => r.id === item.id);
                      const isSelected = itemIndex === selectedIndex;
                      return (
                        <div
                          key={item.id}
                          onClick={item.action}
                          onMouseEnter={() => setSelectedIndex(itemIndex)}
                          className={`px-2.5 py-2 rounded-lg flex items-center justify-between gap-2.5 cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100'
                              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/60 text-zinc-800 dark:text-zinc-200'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="p-1 rounded-md bg-zinc-100 dark:bg-zinc-800 shrink-0">
                              {item.icon}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold truncate leading-tight">
                                {item.title}
                              </p>
                              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate mt-0.5 font-mono">
                                {item.subtitle}
                              </p>
                            </div>
                          </div>
                          {item.badge && (
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold border shrink-0 ${item.badgeColor}`}
                            >
                              {item.badge}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Layer 2: App Navigation */}
              {navMatches.length > 0 && (
                <div>
                  <div className="px-2.5 py-1 text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Command className="w-3 h-3 text-zinc-400" />
                    <span>App Sections ({navMatches.length})</span>
                  </div>
                  <div className="space-y-0.5">
                    {navMatches.map((item) => {
                      const itemIndex = flatResults.findIndex((r) => r.id === item.id);
                      const isSelected = itemIndex === selectedIndex;
                      return (
                        <div
                          key={item.id}
                          onClick={item.action}
                          onMouseEnter={() => setSelectedIndex(itemIndex)}
                          className={`px-2.5 py-2 rounded-lg flex items-center justify-between gap-2.5 cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100'
                              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/60 text-zinc-800 dark:text-zinc-200'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="p-1 rounded-md bg-zinc-100 dark:bg-zinc-800 shrink-0">
                              {item.icon}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold truncate leading-tight">
                                {item.title}
                              </p>
                              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate mt-0.5">
                                {item.subtitle}
                              </p>
                            </div>
                          </div>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold border shrink-0 ${item.badgeColor}`}
                          >
                            GO TO
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Layer 3: Quick Actions */}
              {actionMatches.length > 0 && (
                <div>
                  <div className="px-2.5 py-1 text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3 text-zinc-400" />
                    <span>Quick Actions ({actionMatches.length})</span>
                  </div>
                  <div className="space-y-0.5">
                    {actionMatches.map((item) => {
                      const itemIndex = flatResults.findIndex((r) => r.id === item.id);
                      const isSelected = itemIndex === selectedIndex;
                      return (
                        <div
                          key={item.id}
                          onClick={item.action}
                          onMouseEnter={() => setSelectedIndex(itemIndex)}
                          className={`px-2.5 py-2 rounded-lg flex items-center justify-between gap-2.5 cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100'
                              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/60 text-zinc-800 dark:text-zinc-200'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="p-1 rounded-md bg-zinc-100 dark:bg-zinc-800 shrink-0">
                              {item.icon}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold truncate leading-tight">
                                {item.title}
                              </p>
                              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate mt-0.5">
                                {item.subtitle}
                              </p>
                            </div>
                          </div>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold border shrink-0 ${item.badgeColor}`}
                          >
                            RUN
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* FAIL / EMPTY STATE: Robust feedback with suggestions */}
          {lifecycle === 'empty' && (
            <div className="p-4 text-center select-none">
              <div className="w-10 h-10 mx-auto rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 flex items-center justify-center text-amber-600 dark:text-amber-400 mb-2.5">
                <SearchX className="w-5 h-5 stroke-[1.75]" />
              </div>
              <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                No app matches for "{searchQuery}"
              </h4>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1 max-w-xs mx-auto">
                No downloads, sections, or commands matched across all search layers.
              </p>

              {/* Layers Searched Pill Matrix */}
              <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-[10px] font-mono text-zinc-500">
                <span className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-200/80 dark:border-zinc-700/80">
                  ✓ Filenames & URLs
                </span>
                <span className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-200/80 dark:border-zinc-700/80">
                  ✓ Extensions (.iso, .zip)
                </span>
                <span className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-200/80 dark:border-zinc-700/80">
                  ✓ App Sections
                </span>
                <span className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-200/80 dark:border-zinc-700/80">
                  ✓ Quick Actions
                </span>
              </div>

              {/* Fast Recovery Action */}
              <div className="mt-4 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={handleClear}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer"
                >
                  Clear Search (Esc)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsFocused(false);
                    setNewModalOpen(true);
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors cursor-pointer"
                >
                  + New Download
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
