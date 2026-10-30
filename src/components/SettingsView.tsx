import React, { useState, useEffect } from 'react';
import { Button } from './ui/Button';
import { 
  Settings, 
  Eye, 
  HardDrive, 
  FolderOpen, 
  Check, 
  Link2, 
  Zap, 
  Minimize2, 
  Power, 
  ChevronRight, 
  FileText, 
  Wrench, 
  RotateCcw, 
  Trash2, 
  Loader2, 
  Shield, 
  ExternalLink, 
  ArrowUpRight,
  Activity,
  Sliders
} from 'lucide-react';
import { useDownloadStore } from '../stores/downloadStore';
import { 
  getDefaultDownloadDir, 
  getMaxSegments, 
  openFolderPicker, 
  setDefaultDownloadDir, 
  setMaxSegments as apiSetMaxSegments, 
  isAutostartEnabled, 
  setAutostartEnabled, 
  triggerUninstall, 
  repairApplication, 
  resetToBaseVersion, 
  openExternalUrl, 
  quitApp 
} from '../services/tauriService';
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
  const [resetFeedback, setResetFeedback] = useState(false);

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

  // Enterprise Reset to Defaults:
  // - System Tray: ON
  // - Launch on Startup: ON
  // - Clipboard Auto-Detection: ON
  // - Homepage Speed Panel: OFF (Clean mode)
  // - Max Connections per File: 16 (Recommended)
  // - Download Directory: Default user Downloads\Downex
  const handleResetToDefaults = async () => {
    setCloseToTray(true);
    localStorage.setItem('downex_close_to_tray', 'true');

    setAutostart(true);
    try {
      await setAutostartEnabled(true);
    } catch {}

    setClipboardWatch(true);
    localStorage.setItem('downex_clipboard_watch', 'true');

    setShowTelemetryOnHome(false);

    setMaxSegments(16);
    localStorage.setItem('downex_max_segments', '16');
    await apiSetMaxSegments(16).catch(() => {});

    try {
      const res = await setDefaultDownloadDir('');
      setDefaultDir(res);
      setFolderFeedback(`Folder reset to default: ${res}`);
      setTimeout(() => setFolderFeedback(null), 4000);
    } catch {}

    setResetFeedback(true);
    setTimeout(() => setResetFeedback(false), 3500);
  };

  if (settingsSubView === 'patch-notes') {
    return <PatchNotesView onBack={() => openSettingsSubView('settings')} />;
  }

  return (
    <div className="flex-1 h-full overflow-y-auto px-6 py-5 select-none bg-white dark:bg-zinc-950">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Top Header with Reset to Defaults and Status Feedback */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-200/80 dark:border-zinc-800/80">
          <div>
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-zinc-900 dark:text-zinc-100" />
              <h1 className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                Settings
              </h1>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Manage your download preferences, startup behavior, and storage.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {resetFeedback && (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-[11px] font-mono text-emerald-600 dark:text-emerald-400 animate-in fade-in duration-200">
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Defaults Restored (Tray & Startup ON)</span>
              </div>
            )}

            {savedFeedback && !resetFeedback && (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-[11px] font-mono text-emerald-600 dark:text-emerald-400 animate-in fade-in duration-200">
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Saved</span>
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              icon={<RotateCcw className="w-3.5 h-3.5" />}
              onClick={handleResetToDefaults}
              title="Reset all settings to recommended defaults (System Tray & Startup ON)"
            >
              Reset to Defaults
            </Button>
          </div>
        </div>

        {/* SECTION 1: GENERAL & SYSTEM BEHAVIOR (Clubbed Card) */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <Sliders className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
              General & Startup
            </h2>
          </div>

          <div className="rounded-xl bg-zinc-50/70 dark:bg-zinc-900/40 border border-zinc-200/80 dark:border-zinc-800/60 shadow-xs divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
            {/* Toggle 1: Start Downex with Windows */}
            <div className="p-4 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Power className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    Start Downex with Windows
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                    Recommended: ON
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 max-w-xl">
                  Automatically start Downex in the background tray when your computer boots up so browser downloads are captured seamlessly.
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

            {/* Toggle 2: Minimize to System Tray on Close */}
            <div className="p-4 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Minimize2 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    Keep running in system tray on close
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                    Recommended: ON
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 max-w-xl">
                  Closing the main window minimizes Downex to the taskbar notification tray so active downloads continue uninterrupted.
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

            {/* Toggle 3: Clipboard URL Auto-Detection */}
            <div className="p-4 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    Clipboard link auto-detection
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 max-w-xl">
                  Automatically detect copied download links from your clipboard and pre-fill them when opening New Download.
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

            {/* Toggle 4: Homepage Speed Panel */}
            <div className="p-4 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-zinc-600 dark:text-zinc-400 shrink-0" />
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    Show speed panel on home page
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-200/80 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                    Default: OFF
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 max-w-xl">
                  Display the live speed sparkline panel directly on your downloads homepage. Keep off for maximum download space.
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
          </div>
        </div>

        {/* SECTION 2: DOWNLOADS & SPEED (Clubbed Card) */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <HardDrive className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
              Downloads & Speed
            </h2>
          </div>

          <div className="rounded-xl bg-zinc-50/70 dark:bg-zinc-900/40 border border-zinc-200/80 dark:border-zinc-800/60 shadow-xs divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
            {/* Option 1: Default Download Folder */}
            <div className="p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-zinc-700 dark:text-zinc-300 shrink-0" />
                    <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      Default download folder
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Where newly added downloads will be saved. Completed files remain safely in their original folders.
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
                    Change Folder...
                  </Button>
                </div>
              </div>

              {/* Current Path Badge */}
              <div className="p-2.5 rounded-lg bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200/60 dark:border-zinc-700/60 flex items-center justify-between">
                <span className="text-xs font-mono font-medium text-zinc-800 dark:text-zinc-200 truncate select-text" title={defaultDir}>
                  📁 {defaultDir}
                </span>
                <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-semibold shrink-0 ml-2">
                  ACTIVE
                </span>
              </div>

              {/* Folder Feedback Alert */}
              {folderFeedback && (
                <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-xs font-mono text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 stroke-[2.5]" />
                  <span>{folderFeedback}</span>
                </div>
              )}
            </div>

            {/* Option 2: Download Speed Acceleration (Parts per download) */}
            <div className="p-4 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    Download acceleration (Connections per file)
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Splits downloads into multi-part streams to maximize transfer speed.
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
          </div>
        </div>

        {/* SECTION 3: LIVE SPEED & STATS SHORTCUT (Compact Enterprise Banner) */}
        <div className="p-3.5 rounded-xl bg-zinc-50/70 dark:bg-zinc-900/40 border border-zinc-200/80 dark:border-zinc-800/60 shadow-xs flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center shrink-0">
              <Activity className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  Download Speed & Statistics
                </span>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" title="Engine Active" />
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                View real-time transfer graphs, active connection threads, and lifetime data history.
              </p>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            iconRight={<ArrowUpRight className="w-3.5 h-3.5" />}
            onClick={() => setSelectedView('telemetry')}
          >
            Open Speed & Stats
          </Button>
        </div>

        {/* SECTION 4: ABOUT & PATCH NOTES (Clubbed Card) */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <FileText className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
              About & Updates
            </h2>
          </div>

          <div className="rounded-xl bg-zinc-50/70 dark:bg-zinc-900/40 border border-zinc-200/80 dark:border-zinc-800/60 shadow-xs divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
            {/* Version & Release Changelogs */}
            <div className="p-4 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    Downex Version
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200/80 dark:border-zinc-700/80 shadow-2xs">
                    {formattedVersion}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Explore what is new in this release, view changelogs, or manage update versions.
                </p>
              </div>

              <Button
                type="button"
                variant="outline"
                size="md"
                iconRight={<ChevronRight className="w-3.5 h-3.5" />}
                onClick={() => openSettingsSubView('patch-notes')}
              >
                View Release Notes
              </Button>
            </div>
          </div>
        </div>

        {/* SECTION 5: TROUBLESHOOTING & APP MANAGEMENT (Subtle, Non-Intimidating Clubbed Card) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <Wrench className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                Troubleshooting & Maintenance
              </h2>
            </div>
            <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500">
              Quick tools to fix locks, clear cache, or reinstall
            </span>
          </div>

          {maintenanceMessage && (
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-xs font-mono text-amber-800 dark:text-amber-300 flex items-center gap-2 shadow-xs">
              <Loader2 className="w-4 h-4 animate-spin shrink-0 text-amber-600 dark:text-amber-400" />
              <span>{maintenanceMessage}</span>
            </div>
          )}

          <div className="rounded-xl bg-zinc-50/70 dark:bg-zinc-900/40 border border-zinc-200/80 dark:border-zinc-800/60 shadow-xs divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
            {/* Tool 1: Clean App Repair */}
            <div className="p-3 sm:p-3.5 flex items-center justify-between gap-4">
              <div className="space-y-0.5 min-w-0 flex-1">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  Repair App & Clear Cache
                </span>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Clears temporary cached files, refreshes database connections, and restarts Downex cleanly.
                </p>
              </div>

              <Button
                type="button"
                variant="outline"
                size="md"
                className="w-36 shrink-0"
                icon={<Wrench className="w-3.5 h-3.5" />}
                loading={isRepairing}
                loadingText="Repairing..."
                disabled={isResettingBase}
                onClick={() => setPendingAction('repair')}
              >
                Run Repair
              </Button>
            </div>

            {/* Tool 2: Reset to Original Foundation (v0.0.0) */}
            <div className="p-3 sm:p-3.5 flex items-center justify-between gap-4">
              <div className="space-y-0.5 min-w-0 flex-1">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  Revert to Base Version (v0.0.0)
                </span>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Reverts the application back to the clean original installer if an update ever causes an issue.
                </p>
              </div>

              <Button
                type="button"
                variant="outline"
                size="md"
                className="w-36 shrink-0"
                icon={<RotateCcw className="w-3.5 h-3.5" />}
                loading={isResettingBase}
                loadingText="Reverting..."
                disabled={isRepairing}
                onClick={() => setPendingAction('reset-base')}
              >
                Reset to v0.0.0
              </Button>
            </div>

            {/* Tool 3: Stop Background Engine & Exit */}
            <div className="p-3 sm:p-3.5 flex items-center justify-between gap-4">
              <div className="space-y-0.5 min-w-0 flex-1">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  Exit Downex completely
                </span>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Completely closes all Downex windows and stops the background system tray engine.
                </p>
              </div>

              <Button
                type="button"
                variant="outline"
                size="md"
                className="w-36 shrink-0"
                icon={<Power className="w-3.5 h-3.5" />}
                onClick={() => setPendingAction('stop-engine')}
              >
                Exit App
              </Button>
            </div>

            {/* Tool 4: Uninstall Downex */}
            <div className="p-3 sm:p-3.5 flex items-center justify-between gap-4">
              <div className="space-y-0.5 min-w-0 flex-1">
                <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                  Uninstall Downex
                </span>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Cleanly remove the Downex desktop application from your Windows computer.
                </p>
              </div>

              <Button
                type="button"
                variant="destructive"
                size="md"
                className="w-36 shrink-0"
                icon={<Trash2 className="w-3.5 h-3.5" />}
                loading={isUninstalling}
                loadingText="Launching..."
                onClick={() => setPendingAction('uninstall')}
              >
                Uninstall
              </Button>
            </div>
          </div>
        </div>

        {/* Minimal Footer & Terms */}
        <div className="pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60 flex items-center justify-between text-[11px] text-zinc-400 dark:text-zinc-500">
          <div className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-zinc-400" />
            <span>Downex Desktop Manager</span>
          </div>

          <button
            type="button"
            onClick={() => openExternalUrl('https://download.gauravpatil.site#terms')}
            className="hover:text-zinc-600 dark:hover:text-zinc-300 hover:underline cursor-pointer inline-flex items-center gap-1"
          >
            <span>Terms & Privacy Policy</span>
            <ExternalLink className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Confirmation Modal */}
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
