import React, { useState, useEffect } from 'react';
import { Settings, Eye, HardDrive, Cpu, ShieldCheck, FolderOpen, Check, Link2, Zap, Minimize2, Power, ChevronRight, FileText } from 'lucide-react';
import { useDownloadStore } from '../stores/downloadStore';
import { TelemetryWidget } from './TelemetryWidget';
import { getDefaultDownloadDir, getMaxSegments, openFolderPicker, setDefaultDownloadDir, setMaxSegments as apiSetMaxSegments, isAutostartEnabled, setAutostartEnabled } from '../services/tauriService';
import { useAppVersionStore } from '../stores/appVersionStore';
import { PatchNotesView } from './Views/PatchNotesView';

interface SettingsViewProps {
  darkMode?: boolean;
  setDarkMode?: (val: boolean) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = () => {
  const showTelemetryOnHome = useDownloadStore((state) => state.showTelemetryOnHome);
  const setShowTelemetryOnHome = useDownloadStore((state) => state.setShowTelemetryOnHome);
  const formattedVersion = useAppVersionStore((state) => state.formattedVersion);

  const [defaultDir, setDefaultDir] = useState<string>('Downloads\\Downex');
  const [folderFeedback, setFolderFeedback] = useState<string | null>(null);
  const [maxSegments, setMaxSegments] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('downex_max_segments');
      return saved ? parseInt(saved, 10) : 32;
    } catch {
      return 32;
    }
  });
  const [clipboardWatch, setClipboardWatch] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('downex_clipboard_watch');
      return saved === 'true';
    } catch {
      return true;
    }
  });
  const [closeToTray, setCloseToTray] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('downex_close_to_tray');
      return saved !== 'false'; // Default: true (minimize to tray)
    } catch {
      return true;
    }
  });
  const [autostart, setAutostart] = useState<boolean>(true);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [activeSubView, setActiveSubView] = useState<'settings' | 'patch-notes'>('settings');

  useEffect(() => {
    getDefaultDownloadDir()
      .then((dir) => {
        if (dir) setDefaultDir(dir);
      })
      .catch(() => {});

    getMaxSegments()
      .then((count) => {
        if (count) setMaxSegments(count);
      })
      .catch(() => {});

    isAutostartEnabled()
      .then((enabled) => {
        setAutostart(enabled);
      })
      .catch(() => {});
  }, []);

  const handlePickFolder = async () => {
    try {
      const picked = await openFolderPicker();
      if (picked && picked.trim()) {
        const saved = await setDefaultDownloadDir(picked.trim());
        setDefaultDir(saved);
        setFolderFeedback(`New downloads will save to: ${saved}`);
        triggerSaved();
        setTimeout(() => setFolderFeedback(null), 5000);
      }
    } catch (e) {
      console.warn('Failed to pick folder:', e);
      alert('Could not update download directory: ' + e);
    }
  };

  const handleSegmentChange = async (count: number) => {
    setMaxSegments(count);
    localStorage.setItem('downex_max_segments', String(count));
    await apiSetMaxSegments(count).catch(() => {});
    triggerSaved();
  };

  const handleClipboardToggle = (val: boolean) => {
    setClipboardWatch(val);
    localStorage.setItem('downex_clipboard_watch', String(val));
    triggerSaved();
  };

  const handleCloseToTrayToggle = (val: boolean) => {
    setCloseToTray(val);
    localStorage.setItem('downex_close_to_tray', String(val));
    triggerSaved();
  };

  const handleAutostartToggle = async (val: boolean) => {
    setAutostart(val);
    try {
      await setAutostartEnabled(val);
    } catch (e) {
      console.warn('Failed to toggle autostart:', e);
    }
    triggerSaved();
  };

  const triggerSaved = () => {
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 2000);
  };

  if (activeSubView === 'patch-notes') {
    return <PatchNotesView onBack={() => setActiveSubView('settings')} />;
  }

  return (
    <div className="flex-1 h-full overflow-y-auto px-6 py-5 select-none bg-white dark:bg-zinc-950">
      <div className="max-w-4xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-zinc-200/80 dark:border-zinc-800/80">
          <div>
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-zinc-900 dark:text-zinc-100" />
              <h1 className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                Downex Preferences & System Telemetry
              </h1>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Live hardware performance sensors and unified engine controls.
            </p>
          </div>

          {savedFeedback && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
              <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Saved</span>
            </div>
          )}
        </div>

        {/* 1. TOP POSITION: Live Engine Performance & Storage Telemetry (User Priority) */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                Live Engine Performance & Storage Telemetry
              </h2>
            </div>
            <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500">Real-time hardware sensors</span>
          </div>

          <TelemetryWidget layout="embedded" />
        </div>

        {/* 2. CLUBBED PRODUCTIVE TOGGLES & PREFERENCES (Less clicks, high output!) */}
        <div className="rounded-xl bg-zinc-50/70 dark:bg-zinc-900/40 border border-zinc-200/80 dark:border-zinc-800/60 shadow-xs divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
          {/* Toggle 1: Homepage Telemetry Sidebar */}
          <div className="p-4 flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  Show Telemetry Sidebar on Homepage
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-200/80 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                  Default: Off (Clean Mode)
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 max-w-xl">
                When turned off, your homepage stays completely clean, minimal, and gives 100% width to downloads.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowTelemetryOnHome(!showTelemetryOnHome);
                triggerSaved();
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                showTelemetryOnHome ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                  showTelemetryOnHome ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Toggle 2: Clipboard URL Auto-Detection */}
          <div className="p-4 flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Link2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  Clipboard URL Auto-Detection
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 max-w-xl">
                Automatically detect copied HTTP/HTTPS links and pre-fill them when opening "+ New Download".
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleClipboardToggle(!clipboardWatch)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                clipboardWatch ? 'bg-emerald-600' : 'bg-zinc-300 dark:bg-zinc-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                  clipboardWatch ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Toggle 3: Minimize to Tray on Close */}
          <div className="p-4 flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Minimize2 className="w-4 h-4 text-zinc-600 dark:text-zinc-400 shrink-0" />
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  Minimize to System Tray on Close
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 max-w-xl">
                Keep Downex active in the Windows background taskbar tray so downloads continue uninterrupted.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleCloseToTrayToggle(!closeToTray)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                closeToTray ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                  closeToTray ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Toggle 4: Launch Downex on Windows Startup (Run silently in background tray) */}
          <div className="p-4 flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Power className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  Launch on Windows Startup
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  Silent Background Tray
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 max-w-xl">
                Automatically start Downex in the background when Windows boots up so browser downloads are captured immediately without opening a window.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleAutostartToggle(!autostart)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                autostart ? 'bg-emerald-600' : 'bg-zinc-300 dark:bg-zinc-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                  autostart ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Option 4: Max Parallel TCP Connections per Download */}
          <div className="p-4 flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  Max Parallel Sockets per File
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Parallel TCP chunk connections for maximum network throughput (IDM-style acceleration).
              </p>
            </div>
            <div className="flex items-center gap-1.5 font-mono text-xs">
              {[4, 8, 16, 32].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handleSegmentChange(num)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                    maxSegments === num
                      ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 shadow-xs'
                      : 'bg-zinc-200/70 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-300/60 dark:hover:bg-zinc-700'
                  }`}
                >
                  {num} {num === 16 ? '★' : ''}
                </button>
              ))}
            </div>
          </div>

          
          {/* Option: Release Changelogs & Patch Notes */}
          <div className="p-4 flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  Release Changelogs & Patch Notes
                </span>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-medium bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                  All Versions
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Inspect detailed version changelogs across all releases, or author and manage release notes in-app.
              </p>
            </div>

            <button
              type="button"
              id="view-patch-notes-btn"
              onClick={() => setActiveSubView('patch-notes')}
              className="px-3.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs transition-all shrink-0"
            >
              <span>View Patch Notes</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Option 5: Default Download Directory (IDM Lifecycle Pattern) */}
          <div className="p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-zinc-700 dark:text-zinc-300 shrink-0" />
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    Default Download Directory
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Folder where all new downloads save. Old downloads remain safely in their original folders.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await setDefaultDownloadDir('');
                      setDefaultDir(res);
                      setFolderFeedback(`Reset to default Downex folder: ${res}`);
                      triggerSaved();
                      setTimeout(() => setFolderFeedback(null), 5000);
                    } catch (e) {
                      console.warn(e);
                    }
                  }}
                  className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-[11px] font-mono text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={handlePickFolder}
                  className="px-3.5 py-1.5 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-xs font-medium hover:opacity-90 flex items-center gap-1.5 cursor-pointer shadow-xs transition-all"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Browse Folder...</span>
                </button>
              </div>
            </div>

            {/* Current Path Badge */}
            <div className="p-2.5 rounded-lg bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200/60 dark:border-zinc-700/60 flex items-center justify-between">
              <span className="text-xs font-mono font-medium text-zinc-800 dark:text-zinc-200 truncate select-text" title={defaultDir}>
                📁 {defaultDir}
              </span>
              <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-semibold shrink-0 ml-2">
                ACTIVE TARGET
              </span>
            </div>

            {/* Folder Feedback Alert */}
            {folderFeedback && (
              <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-xs font-mono text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0 stroke-[2.5]" />
                <span>{folderFeedback} (Existing downloads remain preserved in their original folders).</span>
              </div>
            )}
          </div>
        </div>

        {/* Minimal Footer */}
        <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 dark:text-zinc-500 pt-1">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>Downex Core Build: {formattedVersion}</span>
          </div>
          <span>Windows x64 Native • SQLite WAL High-Throughput Engine</span>
        </div>
      </div>
    </div>
  );
};
