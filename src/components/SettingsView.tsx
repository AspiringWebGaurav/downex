import React, { useState, useEffect } from 'react';
import { Button } from './ui/Button';
import { Settings, Eye, HardDrive, Cpu, ShieldCheck, FolderOpen, Check, Link2, Zap, Minimize2, Power, ChevronRight, FileText, Wrench, RotateCcw, Trash2, ShieldAlert, Loader2, Shield, ExternalLink, ArrowUpRight } from 'lucide-react';
import { useDownloadStore } from '../stores/downloadStore';
import { TelemetryWidget } from './TelemetryWidget';
import { getDefaultDownloadDir, getMaxSegments, openFolderPicker, setDefaultDownloadDir, setMaxSegments as apiSetMaxSegments, isAutostartEnabled, setAutostartEnabled, triggerUninstall, repairApplication, resetToBaseVersion, openExternalUrl, quitApp } from '../services/tauriService';
import { useAppVersionStore } from '../stores/appVersionStore';
import { PatchNotesView } from './Views/PatchNotesView';
import { RecoveryActionModal, RecoveryActionType } from './RecoveryActionModal';

interface SettingsViewProps {
  darkMode?: boolean;
  setDarkMode?: (val: boolean) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = () => {
  const showTelemetryOnHome = useDownloadStore((state) => state.showTelemetryOnHome);
  const setShowTelemetryOnHome = useDownloadStore((state) => state.setShowTelemetryOnHome);
  const setSelectedView = useDownloadStore((state) => state.setSelectedView);
  const settingsSubView = useDownloadStore((state) => state.settingsSubView);
  const openSettingsSubView = useDownloadStore((state) => state.openSettingsSubView);
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


  // Maintenance & Lifecycle states
  const [isRepairing, setIsRepairing] = useState(false);
  const [isResettingBase, setIsResettingBase] = useState(false);
  const [isUninstalling, setIsUninstalling] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<RecoveryActionType>(null);

  const executeConfirmedAction = async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);

    if (action === 'repair') {
      setIsRepairing(true);
      setMaintenanceMessage('Sweeping legacy artifacts and restarting supervisor...');
      try {
        await repairApplication();
      } catch (err: any) {
        setIsRepairing(false);
        setMaintenanceMessage(`Repair error: ${err?.message || err}`);
      }
    } else if (action === 'reset-base') {
      setIsResettingBase(true);
      setMaintenanceMessage('Fetching verified Base 0.0.0 installer from GPHost...');
      try {
        const res = await resetToBaseVersion();
        setMaintenanceMessage(res || 'Base reset initiated. Restarting...');
      } catch (err: any) {
        setIsResettingBase(false);
        setMaintenanceMessage(`Reset failed: ${err?.message || err}`);
      }
    } else if (action === 'uninstall') {
      setIsUninstalling(true);
      setMaintenanceMessage('Launching native Windows uninstaller wizard...');
      try {
        await triggerUninstall();
      } catch (err: any) {
        setIsUninstalling(false);
        setMaintenanceMessage(`Could not launch uninstaller: ${err?.message || err}`);
      }
    } else if (action === 'stop-engine') {
      try {
        await quitApp();
      } catch (err: any) {
        setMaintenanceMessage(`Could not stop background engine: ${err?.message || err}`);
      }
    }
  };

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

  if (settingsSubView === 'patch-notes') {
    return <PatchNotesView onBack={() => openSettingsSubView('settings')} />;
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
                Downex Preferences & Settings
              </h1>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Live download speed, storage space, and engine preferences.
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
                Live Download Speed & Storage
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 hidden sm:inline">
                Real-time hardware sensors
              </span>
              <button
                type="button"
                onClick={() => setSelectedView('telemetry')}
                title="Open dedicated speed & stats dashboard"
                className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300/80 dark:border-emerald-800/60 shadow-2xs hover:bg-emerald-100/70 dark:hover:bg-emerald-900/40 transition-all cursor-pointer"
              >
                <span>View All</span>
                <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.5]" />
              </button>
            </div>
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
                  Show Speed & Stats Panel on Homepage
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

            <Button
              type="button"
              id="view-patch-notes-btn"
              variant="outline"
              size="md"
              iconRight={<ChevronRight className="w-3.5 h-3.5" />}
              onClick={() => openSettingsSubView('patch-notes')}
            >
              View Patch Notes
            </Button>
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
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
                >
                  Reset
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  icon={<FolderOpen className="w-3.5 h-3.5" />}
                  onClick={handlePickFolder}
                >
                  Browse Folder...
                </Button>
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

        {/* 3. APP RECOVERY, DIAGNOSTICS & LIFECYCLE MAINTENANCE */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                App Recovery, Diagnostics & Lifecycle
              </h2>
            </div>
            <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500">Autonomous self-repair & rollback guards</span>
          </div>

          {maintenanceMessage && (
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-xs font-mono text-amber-800 dark:text-amber-300 flex items-center gap-2 shadow-xs">
              <Loader2 className="w-4 h-4 animate-spin shrink-0 text-amber-600 dark:text-amber-400" />
              <span>{maintenanceMessage}</span>
            </div>
          )}

          <div className="rounded-xl bg-zinc-50/70 dark:bg-zinc-900/40 border border-zinc-200/80 dark:border-zinc-800/60 shadow-xs divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
            {/* Action 1: Self-Healing Repair */}
            <div className="p-3 sm:p-3.5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-8 h-8 rounded-sm bg-emerald-500/10 dark:bg-emerald-500/20 border border-emerald-500/20 flex items-center justify-center shrink-0">
                  <Wrench className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="flex items-center gap-2 min-w-0 flex-1 truncate">
                  <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                    Process & Lock Repair
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-xs bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 shrink-0">
                    Instant
                  </span>
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate">
                    — Sweep temp binaries, release SQLite locks, and restart
                  </span>
                </div>
              </div>

              <Button
                type="button"
                variant="primary-emerald"
                size="lg"
                className="w-40 shrink-0"
                icon={<Wrench className="w-3.5 h-3.5" />}
                loading={isRepairing}
                loadingText="Repairing..."
                disabled={isResettingBase}
                onClick={() => setPendingAction('repair')}
              >
                Run Repair
              </Button>
            </div>

            {/* Action 2: Reset to Base (0.0.0 Foundation) */}
            <div className="p-3 sm:p-3.5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-8 h-8 rounded-sm bg-amber-500/10 dark:bg-amber-500/20 border border-amber-500/20 flex items-center justify-center shrink-0">
                  <RotateCcw className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex items-center gap-2 min-w-0 flex-1 truncate">
                  <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                    Reset to Base Foundation
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-xs bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 shrink-0">
                    v0.0.0
                  </span>
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate">
                    — Revert executable to permanent Base 0.0.0 installer
                  </span>
                </div>
              </div>

              <Button
                type="button"
                variant="warning"
                size="lg"
                className="w-40 shrink-0"
                icon={<RotateCcw className="w-3.5 h-3.5" />}
                loading={isResettingBase}
                loadingText="Reverting..."
                disabled={isRepairing}
                onClick={() => setPendingAction('reset-base')}
              >
                Reset to Base
              </Button>
            </div>

            {/* Action 3: Native Windows Uninstaller */}
            <div className="p-3 sm:p-3.5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-8 h-8 rounded-sm bg-rose-500/10 dark:bg-rose-500/20 border border-rose-500/20 flex items-center justify-center shrink-0">
                  <Trash2 className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                </div>
                <div className="flex items-center gap-2 min-w-0 flex-1 truncate">
                  <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                    Uninstall Downex
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-xs bg-zinc-200/80 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 shrink-0">
                    NSIS
                  </span>
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate">
                    — Cleanly remove Downex desktop application from Windows
                  </span>
                </div>
              </div>

              <Button
                type="button"
                variant="destructive"
                size="lg"
                className="w-40 shrink-0"
                icon={<Trash2 className="w-3.5 h-3.5" />}
                loading={isUninstalling}
                loadingText="Launching..."
                onClick={() => setPendingAction('uninstall')}
              >
                Uninstall
              </Button>
            </div>

            {/* Action 4: Stop Background Engine & Exit (Guarded) */}
            <div className="p-3 sm:p-3.5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-8 h-8 rounded-sm bg-zinc-200/80 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 flex items-center justify-center shrink-0">
                  <Power className="w-4 h-4 text-zinc-700 dark:text-zinc-300" />
                </div>
                <div className="flex items-center gap-2 min-w-0 flex-1 truncate">
                  <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                    Stop Background Engine
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-xs bg-zinc-200/80 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 shrink-0">
                    Exit
                  </span>
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate">
                    — Shut down browser link grabber, extension bridge, and tray icon
                  </span>
                </div>
              </div>

              <Button
                type="button"
                variant="neutral-dark"
                size="lg"
                className="w-40 shrink-0"
                icon={<Power className="w-3.5 h-3.5" />}
                onClick={() => setPendingAction('stop-engine')}
              >
                Stop Engine
              </Button>
            </div>
          </div>
        </div>

        {/* Minimal Footer & Terms of Service Governance */}
        <div className="space-y-2 pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60">
          <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 dark:text-zinc-500">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>Downex Core Build: {formattedVersion}</span>
            </div>
            <span>Windows x64 Native • SQLite WAL High-Throughput Engine</span>
          </div>

          <div className="p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/80 flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Shield className="w-3.5 h-3.5 text-violet-500 shrink-0" />
              <span>By using Downex, you acknowledge and agree to official software terms & privacy governance.</span>
              <button
                type="button"
                onClick={() => openExternalUrl('https://download.gauravpatil.site#terms')}
                className="text-violet-600 dark:text-violet-400 hover:underline font-semibold cursor-pointer inline-flex items-center gap-0.5"
              >
                <span>Click here for Terms & Privacy info</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>
            <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500 shrink-0 hidden md:inline">GPHost Cloud Engine</span>
          </div>
        </div>
      </div>

      {/* Irreversible & Destructive Action Confirmation Modal */}
      <RecoveryActionModal
        isOpen={pendingAction !== null}
        actionType={pendingAction}
        onClose={() => setPendingAction(null)}
        onConfirm={executeConfirmedAction}
        isLoading={isRepairing || isResettingBase || isUninstalling}
      />
    </div>
  );
};
