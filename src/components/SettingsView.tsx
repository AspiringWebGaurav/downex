import React, { useState, useEffect } from 'react';
import { useDownloadStore } from '../stores/downloadStore';
import { 
  getExtensionInfo,
  openExtensionFolder,
  ExtensionInfo,
  getDefaultDownloadDir, 
  setDefaultDownloadDir, 
  setMaxSegments as apiSetMaxSegments, 
  isAutostartEnabled, 
  setAutostartEnabled, 
  getCloseToTray,
  setCloseToTray as apiSetCloseToTray,
  triggerUninstall, 
  repairApplication, 
  resetToBaseVersion, 
  openExternalUrl,
  getSiliconHardwareId
} from '../services/tauriService';
import { RecoveryActionModal, RecoveryActionType } from './RecoveryActionModal';
import { FolderChangeModal } from './FolderChangeModal';

interface SettingsViewProps {
  darkMode?: boolean;
  setDarkMode?: (val: boolean) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ darkMode = false }) => {
  const showTelemetryOnHome = useDownloadStore((state) => state.showTelemetryOnHome);
  const setShowTelemetryOnHome = useDownloadStore((state) => state.setShowTelemetryOnHome);

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
      return saved !== 'false';
    } catch {
      return true;
    }
  });
  const [autostart, setAutostart] = useState<boolean>(true);
  const [confirmReset, setConfirmReset] = useState<boolean>(false);

  const [extInfo, setExtInfo] = useState<ExtensionInfo | null>(null);
  const [copiedExtPath, setCopiedExtPath] = useState(false);
  const [hardwareId, setHardwareId] = useState<string>('');
  const [copiedHwid, setCopiedHwid] = useState(false);

  // Maintenance states
  const [isRepairing, setIsRepairing] = useState(false);
  const [isResettingBase, setIsResettingBase] = useState(false);
  const [isUninstalling, setIsUninstalling] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<RecoveryActionType>(null);
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);

  useEffect(() => {
    getExtensionInfo().then(setExtInfo).catch(console.warn);
    getSiliconHardwareId().then(setHardwareId).catch(console.warn);
    getDefaultDownloadDir().then((d) => {
      if (d) setDefaultDir(d);
    }).catch(console.warn);
    isAutostartEnabled().then(setAutostart).catch(console.warn);
    getCloseToTray().then(setCloseToTray).catch(console.warn);
  }, []);

  useEffect(() => {
    if (!confirmReset) return;
    const t = window.setTimeout(() => setConfirmReset(false), 3500);
    return () => window.clearTimeout(t);
  }, [confirmReset]);

  const handleOpenExtensionFolder = async () => {
    try {
      await openExtensionFolder();
      const info = await getExtensionInfo();
      setExtInfo(info);
    } catch (e) {
      console.warn('Failed to open extension folder:', e);
    }
  };

  const handleCopyExtPath = () => {
    if (extInfo?.canonical_dir) {
      navigator.clipboard.writeText(extInfo.canonical_dir);
      setCopiedExtPath(true);
      setTimeout(() => setCopiedExtPath(false), 2000);
    }
  };

  const handleChooseFolder = () => {
    setIsFolderModalOpen(true);
  };

  const handleFolderSelected = async (chosenPath: string) => {
    setIsFolderModalOpen(false);
    try {
      const updated = await setDefaultDownloadDir(chosenPath);
      setDefaultDir(updated);
      setFolderFeedback(`Saved: ${updated}`);
      setTimeout(() => setFolderFeedback(null), 4000);
    } catch (e) {
      console.warn('Failed to update download folder:', e);
    }
  };

  const handleToggleAutostart = async () => {
    const next = !autostart;
    setAutostart(next);
    try {
      await setAutostartEnabled(next);
    } catch (e) {
      console.warn(e);
      setAutostart(!next);
    }
  };

  const handleToggleCloseToTray = async () => {
    const next = !closeToTray;
    setCloseToTray(next);
    try {
      localStorage.setItem('downex_close_to_tray', String(next));
      await apiSetCloseToTray(next);
    } catch (e) {
      console.warn(e);
      setCloseToTray(!next);
    }
  };

  const handleToggleClipboardWatch = () => {
    const next = !clipboardWatch;
    setClipboardWatch(next);
    try {
      localStorage.setItem('downex_clipboard_watch', String(next));
    } catch (e) {
      console.warn(e);
    }
  };

  const handleToggleTelemetryOnHome = () => {
    setShowTelemetryOnHome(!showTelemetryOnHome);
  };

  const handleUpdateMaxSegments = async (val: number) => {
    setMaxSegments(val);
    try {
      localStorage.setItem('downex_max_segments', String(val));
      await apiSetMaxSegments(val);
    } catch (e) {
      console.warn(e);
    }
  };

  const handleResetToDefaults = async () => {
    try {
      setMaxSegments(32);
      localStorage.setItem('downex_max_segments', '32');
      await apiSetMaxSegments(32);

      setClipboardWatch(true);
      localStorage.setItem('downex_clipboard_watch', 'true');

      setCloseToTray(true);
      localStorage.setItem('downex_close_to_tray', 'true');
      await apiSetCloseToTray(true);

      setAutostart(true);
      await setAutostartEnabled(true);

      setShowTelemetryOnHome(false);

      setMaintenanceMessage('All preferences reset to recommended defaults.');
      setTimeout(() => setMaintenanceMessage(null), 4000);
    } catch (e: any) {
      setMaintenanceMessage(`Reset error: ${e?.message || e}`);
    }
  };

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
      setMaintenanceMessage('Reverting to verified base installer binary v0.0.1...');
      try {
        await resetToBaseVersion();
      } catch (err: any) {
        setIsResettingBase(false);
        setMaintenanceMessage(`Revert error: ${err?.message || err}`);
      }
    } else if (action === 'uninstall') {
      setIsUninstalling(true);
      setMaintenanceMessage('Launching Windows uninstaller...');
      try {
        await triggerUninstall();
      } catch (err: any) {
        setIsUninstalling(false);
        setMaintenanceMessage(`Uninstall launch error: ${err?.message || err}`);
      }
    }
  };

  const cardBorder = darkMode ? 'border-zinc-800' : 'border-zinc-200';
  const mutedText = darkMode ? 'text-zinc-400' : 'text-zinc-500';
  const actionSize =
    'w-[148px] h-8 inline-flex items-center justify-center font-mono-tabular text-[11px] uppercase tracking-wider border whitespace-nowrap shrink-0 cursor-pointer';

  return (
    <div className="flex-1 overflow-y-auto px-7 pt-4 pb-0 select-none flex flex-col">
      <div className="flex-1">
        {/* Header (1:1 ScheduleMe) */}
        <div className="mb-4">
          <div className={`font-mono-tabular text-[11px] uppercase tracking-[0.08em] ${mutedText}`}>
            PREFERENCES
          </div>
          <h1 className="text-[26px] font-bold tracking-tight leading-tight mt-0.5">Settings.</h1>
        </div>

      {/* Info Banner (1:1 ScheduleMe) */}
      <div
        className={`border p-3 mb-4 text-[12px] leading-relaxed ${
          darkMode
            ? 'bg-violet-950/30 border-violet-900/60 text-violet-200'
            : 'bg-[#F8F7FF] border-[#E9D5FF] text-zinc-700'
        }`}
      >
        <div className="font-semibold text-[13px] mb-0.5">Download preferences stay safe across restarts</div>
        Downex manages multi-connection downloads, startup behavior, and browser links quietly in the background.
      </div>

      {/* Main Settings Card (1:1 ScheduleMe) */}
      <div className={`border divide-y ${cardBorder} ${darkMode ? 'divide-zinc-800' : 'divide-zinc-200'}`}>
        {/* Row 1: Start with Windows */}
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">Start with Windows</div>
            <div className={`text-[12px] ${mutedText}`}>
              Opens quietly in tray when Windows starts ({autostart ? 'Ready' : 'Off'}).
            </div>
          </div>
          <button
            type="button"
            onClick={handleToggleAutostart}
            className={`${actionSize} ${
              autostart
                ? darkMode
                  ? 'bg-white text-zinc-950 border-white font-semibold'
                  : 'bg-black text-white border-black font-semibold'
                : darkMode
                  ? 'border-zinc-700 text-zinc-300'
                  : 'border-zinc-300 text-zinc-700'
            }`}
          >
            {autostart ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Row 2: Keep running in system tray on close */}
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">Keep running in system tray on close</div>
            <div className={`text-[12px] ${mutedText}`}>
              Closing the main window minimizes to the system notification tray.
            </div>
          </div>
          <button
            type="button"
            onClick={handleToggleCloseToTray}
            className={`${actionSize} ${
              closeToTray
                ? darkMode
                  ? 'bg-white text-zinc-950 border-white font-semibold'
                  : 'bg-black text-white border-black font-semibold'
                : darkMode
                  ? 'border-zinc-700 text-zinc-300'
                  : 'border-zinc-300 text-zinc-700'
            }`}
          >
            {closeToTray ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Row 3: Clipboard link auto-detection */}
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">Clipboard link auto-detection</div>
            <div className={`text-[12px] ${mutedText}`}>
              Automatically detects copied download URLs and pre-fills New Download.
            </div>
          </div>
          <button
            type="button"
            onClick={handleToggleClipboardWatch}
            className={`${actionSize} ${
              clipboardWatch
                ? darkMode
                  ? 'bg-white text-zinc-950 border-white font-semibold'
                  : 'bg-black text-white border-black font-semibold'
                : darkMode
                  ? 'border-zinc-700 text-zinc-300'
                  : 'border-zinc-300 text-zinc-700'
            }`}
          >
            {clipboardWatch ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Row 4: Show speed panel on home page */}
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">Show speed panel on home page</div>
            <div className={`text-[12px] ${mutedText}`}>
              Display the live speed sparkline panel directly on your downloads home.
            </div>
          </div>
          <button
            type="button"
            onClick={handleToggleTelemetryOnHome}
            className={`${actionSize} ${
              showTelemetryOnHome
                ? darkMode
                  ? 'bg-white text-zinc-950 border-white font-semibold'
                  : 'bg-black text-white border-black font-semibold'
                : darkMode
                  ? 'border-zinc-700 text-zinc-300'
                  : 'border-zinc-300 text-zinc-700'
            }`}
          >
            {showTelemetryOnHome ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Row 5: Download acceleration (Multi-segment selector) */}
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">Download acceleration</div>
            <div className={`text-[12px] ${mutedText}`}>
              Maximum simultaneous parallel connections per download.
            </div>
          </div>
          <div
            className={`w-[148px] h-8 grid grid-cols-4 shrink-0 border ${
              darkMode ? 'border-zinc-700' : 'border-zinc-300'
            }`}
          >
            {[4, 8, 16, 32].map((threads) => {
              const active = maxSegments === threads;
              return (
                <button
                  key={threads}
                  type="button"
                  onClick={() => handleUpdateMaxSegments(threads)}
                  className={`w-full h-full flex items-center justify-center font-mono-tabular text-[11px] cursor-pointer ${
                    active
                      ? darkMode
                        ? 'bg-white text-zinc-950 font-semibold'
                        : 'bg-black text-white font-semibold'
                      : mutedText
                  }`}
                >
                  {threads}
                </button>
              );
            })}
          </div>
        </div>

        {/* Row 6: Default download folder */}
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">Default download folder</div>
            <div className={`text-[12px] ${mutedText}`}>
              Where newly captured and downloaded files are saved.
            </div>
            <div className="font-mono-tabular text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 truncate max-w-sm sm:max-w-md">
              {defaultDir}
            </div>
          </div>
          <button
            type="button"
            onClick={handleChooseFolder}
            className={`${actionSize} ${
              darkMode
                ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'
                : 'border-zinc-300 text-zinc-700 hover:bg-zinc-100'
            }`}
          >
            CHANGE FOLDER
          </button>
        </div>

        {/* Row 7: Browser companion extension */}
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">Browser companion extension</div>
            <div className={`text-[12px] ${mutedText}`}>
              Direct download capture for Chrome, Edge, Brave, and Opera.
            </div>
            <div
              onClick={handleCopyExtPath}
              title="Click to copy path"
              className="font-mono-tabular text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 truncate max-w-sm sm:max-w-md cursor-pointer hover:underline"
            >
              {copiedExtPath ? 'Copied to clipboard!' : extInfo?.canonical_dir || 'Extension directory'}
            </div>
          </div>
          <button
            type="button"
            onClick={handleOpenExtensionFolder}
            className={`${actionSize} ${
              darkMode
                ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'
                : 'border-zinc-300 text-zinc-700 hover:bg-zinc-100'
            }`}
          >
            OPEN FOLDER
          </button>
        </div>

        {/* Row 8: Repair app & clean cache */}
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">Repair app & clean cache</div>
            <div className={`text-[12px] ${mutedText}`}>
              Sweeps superseded files, repairs Windows locks, and refreshes supervisor.
            </div>
          </div>
          <button
            type="button"
            disabled={isRepairing || isResettingBase}
            onClick={() => setPendingAction('repair')}
            className={`${actionSize} ${
              darkMode
                ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'
                : 'border-zinc-300 text-zinc-700 hover:bg-zinc-100'
            }`}
          >
            {isRepairing ? 'REPAIRING...' : 'RUN REPAIR'}
          </button>
        </div>

        {/* Row 9: Revert to Base Version (v0.0.1) */}
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">Revert to Base Version (v0.0.1)</div>
            <div className={`text-[12px] ${mutedText}`}>
              Reverts executable back to original installer build if an update fails.
            </div>
          </div>
          <button
            type="button"
            disabled={isRepairing || isResettingBase}
            onClick={() => setPendingAction('reset-base')}
            className={`${actionSize} ${
              darkMode
                ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'
                : 'border-zinc-300 text-zinc-700 hover:bg-zinc-100'
            }`}
          >
            {isResettingBase ? 'REVERTING...' : 'REVERT V0.0.1'}
          </button>
        </div>

        {/* Row 10: Uninstall Downex */}
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">Uninstall Downex</div>
            <div className={`text-[12px] ${mutedText}`}>
              Opens the Windows uninstaller to remove Downex cleanly.
            </div>
          </div>
          <button
            type="button"
            disabled={isUninstalling}
            onClick={() => setPendingAction('uninstall')}
            className={`${actionSize} ${
              darkMode
                ? 'border-zinc-700 text-zinc-300 hover:border-red-500 hover:text-red-400'
                : 'border-zinc-300 text-zinc-700 hover:border-red-600 hover:text-red-600'
            }`}
          >
            {isUninstalling ? 'OPENING...' : 'UNINSTALL'}
          </button>
        </div>

        {/* Row 13: Reset all preferences (1:1 ScheduleMe wipe data pattern) */}
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">Reset all preferences</div>
            <div className={`text-[12px] ${mutedText}`}>
              Restores connection limit, tray behavior, and startup settings to defaults.
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!confirmReset) {
                setConfirmReset(true);
                return;
              }
              setConfirmReset(false);
              void handleResetToDefaults();
            }}
            className={`${actionSize} ${
              confirmReset
                ? 'bg-red-600 border-red-600 text-white font-semibold'
                : darkMode
                  ? 'border-zinc-700 text-zinc-300 hover:border-red-500 hover:text-red-400'
                  : 'border-zinc-300 text-zinc-700 hover:border-red-600 hover:text-red-600'
            }`}
          >
            {confirmReset ? 'CONFIRM RESET' : 'RESET DEFAULTS'}
          </button>
        </div>
      </div>

      {/* Dynamic Feedback Message */}
      {folderFeedback && (
        <div
          className={`mt-3 border px-3 py-2 text-[12px] ${
            darkMode
              ? 'border-zinc-800 bg-zinc-900 text-zinc-300'
              : 'border-zinc-200 bg-zinc-50 text-zinc-700'
          }`}
        >
          {folderFeedback}
        </div>
      )}

      {maintenanceMessage && (
        <div
          className={`mt-3 border px-3 py-2 text-[12px] ${
            darkMode
              ? 'border-zinc-800 bg-zinc-900 text-zinc-300'
              : 'border-zinc-200 bg-zinc-50 text-zinc-700'
          }`}
        >
          {maintenanceMessage}
        </div>
      )}
      </div>

      {/* Minimal Footer (Exact symmetric spacing above and below Terms • Privacy Policy, centered) */}
      <div
        data-testid="settings-footer"
        className={`mt-4 pt-2.5 pb-[11px] border-t ${cardBorder} flex items-center justify-center gap-2.5 text-[11px] leading-none shrink-0 ${mutedText}`}
      >
        <button
          type="button"
          onClick={() => openExternalUrl('https://downex.apps.gauravpatil.site/terms#terms')}
          className="hover:underline cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors leading-none py-0 my-0 inline-flex items-center"
        >
          Terms
        </button>
        <span className="leading-none select-none inline-flex items-center">&bull;</span>
        <button
          type="button"
          onClick={() => openExternalUrl('https://downex.apps.gauravpatil.site/privacy#privacy')}
          className="hover:underline cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors leading-none py-0 my-0 inline-flex items-center"
        >
          Privacy Policy
        </button>
        <span className="leading-none select-none inline-flex items-center">&bull;</span>
        <span
          className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors cursor-pointer select-all inline-flex items-center gap-1"
          title="Click to copy Hardware ID"
          onClick={() => {
            if (hardwareId) {
              navigator.clipboard.writeText(hardwareId);
              setCopiedHwid(true);
              setTimeout(() => setCopiedHwid(false), 2000);
            }
          }}
        >
          <span>ID: {hardwareId || 'DWNX-INITIALIZING'}</span>
          {copiedHwid && <span className="text-emerald-500 text-[9px] font-sans font-bold">COPIED</span>}
        </span>
      </div>

      {/* Confirmation Modal */}
      <RecoveryActionModal
        isOpen={pendingAction !== null}
        actionType={pendingAction}
        onClose={() => setPendingAction(null)}
        onConfirm={executeConfirmedAction}
        isLoading={isRepairing || isResettingBase || isUninstalling}
      />

      {/* Custom Folder Change Modal (Matches Latest UI/UX Industrial Practices) */}
      <FolderChangeModal
        isOpen={isFolderModalOpen}
        initialPath={defaultDir}
        onClose={() => setIsFolderModalOpen(false)}
        onSelect={handleFolderSelected}
        title="DEFAULT DOWNLOAD FOLDER"
        subtitle="GLOBAL APP SETTING"
      />
    </div>
  );
};
