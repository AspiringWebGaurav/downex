import React, { useState, useEffect } from 'react';
import { X, Wrench, RotateCcw, Trash2, AlertTriangle, CheckCircle2, Loader2, Power, FolderOpen } from 'lucide-react';

export type RecoveryActionType =
  | 'repair'
  | 'reset-base'
  | 'uninstall'
  | 'stop-engine'
  | 'reset-defaults'
  | 'reset-folder'
  | null;

interface RecoveryActionModalProps {
  isOpen: boolean;
  actionType: RecoveryActionType;
  onClose: () => void;
  onConfirm: () => void;
  isLoading: boolean;
}

export const RecoveryActionModal: React.FC<RecoveryActionModalProps> = ({
  isOpen,
  actionType,
  onClose,
  onConfirm,
  isLoading,
}) => {
  const [hasAcknowledged, setHasAcknowledged] = useState(false);

  // Reset acknowledgment checkbox whenever modal opens/changes
  useEffect(() => {
    setHasAcknowledged(false);
  }, [isOpen, actionType]);

  // Handle ESC key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onClose]);

  if (!isOpen || !actionType) return null;

  const config = {
    'reset-defaults': {
      title: 'Reset All Settings to Recommended Defaults?',
      badge: 'RESTORE RECOMMENDED DEFAULTS',
      badgeColor: 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
      icon: RotateCcw,
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      iconBg: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/80',
      description:
        'This will reset your Downex preferences back to recommended factory settings. Your downloaded files, active tasks, and history are safe and will NOT be touched.',
      bulletPoints: [
        'Keep running in system tray on close: Set to ON (Recommended)',
        'Start Downex with Windows: Set to ON (Recommended)',
        'Clipboard URL auto-detection: Set to ON',
        'Speed & Stats panel on home page: Set to OFF (Clean Mode)',
        'Download acceleration: Reset to 16 parallel connections',
        'Default download folder: Reset to %USERPROFILE%\\Downloads\\Downex',
      ],
      warningTitle: 'Preference Reset Confirmation',
      warningDescription:
        'Your custom preferences will be restored to recommended defaults. Downloaded files remain untouched.',
      requiresCheckbox: false,
      checkboxLabel: 'I want to reset my settings to recommended defaults.',
      confirmButtonText: 'Reset to Defaults',
      confirmButtonLoading: 'Resetting...',
      confirmButtonClass: 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white',
    },
    'reset-folder': {
      title: 'Reset Default Download Folder?',
      badge: 'RESET FOLDER',
      badgeColor: 'bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border-zinc-300 dark:border-zinc-700',
      icon: FolderOpen,
      iconColor: 'text-zinc-700 dark:text-zinc-300',
      iconBg: 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700',
      description:
        'This will change the default folder where new downloads are saved back to your Windows user Downloads folder.',
      bulletPoints: [
        'New downloads will save to: %USERPROFILE%\\Downloads\\Downex',
        'Files previously downloaded in your current folder will remain completely untouched',
        'You can change this folder again at any time using "Change Folder..."',
      ],
      warningTitle: 'Folder Reset Confirmation',
      warningDescription:
        'Future downloads will save to the default folder instead of your current custom directory.',
      requiresCheckbox: false,
      checkboxLabel: 'Reset my default download folder to the standard location.',
      confirmButtonText: 'Reset Folder',
      confirmButtonLoading: 'Resetting...',
      confirmButtonClass: 'bg-zinc-900 hover:bg-black dark:bg-zinc-700 dark:hover:bg-zinc-600 text-white',
    },
    repair: {
      title: 'Repair App & Clear Cache?',
      badge: 'APP REPAIR & MAINTENANCE',
      badgeColor: 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
      icon: Wrench,
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      iconBg: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/80',
      description:
        'This diagnostic routine will clear temporary cache files, release database locks, and restart Downex cleanly to resolve stuck tasks.',
      bulletPoints: [
        'Clears temporary cache and stale update containers',
        'Releases active database locks and resets socket pools',
        'Restarts Downex fresh in the background',
        'Preserves all active downloads, files, and settings',
      ],
      warningTitle: 'App Restart Required',
      warningDescription: 'Downex will briefly close and restart to complete the repair routine.',
      requiresCheckbox: true,
      checkboxLabel: 'I understand that Downex will restart immediately to complete the repair.',
      confirmButtonText: 'Run Repair',
      confirmButtonLoading: 'Repairing...',
      confirmButtonClass: 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white',
    },
    'reset-base': {
      title: 'Revert to Base Version (v0.0.0)?',
      badge: 'VERSION ROLLBACK',
      badgeColor: 'bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800',
      icon: RotateCcw,
      iconColor: 'text-amber-600 dark:text-amber-400',
      iconBg: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/80',
      description:
        'This will roll back your application executable to the clean original Base 0.0.0 installer. Use this if an update ever causes stability issues.',
      bulletPoints: [
        'Replaces current Downex executable with verified Base 0.0.0 installer',
        'Clears dynamic update packages and resets app binaries',
        'Your download history, files, and settings remain 100% intact',
        'Downex will restart immediately with base binaries',
      ],
      warningTitle: 'Rollback Confirmation',
      warningDescription: 'All recent OTA updates will be rolled back to the original base foundation.',
      requiresCheckbox: true,
      checkboxLabel: 'I acknowledge that this action will revert Downex to version 0.0.0 and restart.',
      confirmButtonText: 'Revert to v0.0.0',
      confirmButtonLoading: 'Reverting...',
      confirmButtonClass: 'bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white',
    },
    uninstall: {
      title: 'Completely Uninstall Downex Desktop?',
      badge: 'UNINSTALL DOWNEX',
      badgeColor: 'bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-800',
      icon: Trash2,
      iconColor: 'text-rose-600 dark:text-rose-400',
      iconBg: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/80',
      description:
        'This will close Downex, remove system startup services, and launch the Windows uninstallation wizard to remove the application.',
      bulletPoints: [
        'Pauses active downloads and disconnects browser extension',
        'Removes Windows autostart entries and system tray services',
        'Launches the official Windows uninstaller to remove app binaries',
        'Files you already downloaded on your PC will NOT be deleted',
      ],
      warningTitle: 'Permanent Removal',
      warningDescription: 'This will remove Downex from your system. Downloaded files are kept safely.',
      requiresCheckbox: true,
      checkboxLabel: 'I confirm that I want to exit and uninstall Downex from Windows.',
      confirmButtonText: 'Uninstall Downex',
      confirmButtonLoading: 'Launching...',
      confirmButtonClass: 'bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white',
    },
    'stop-engine': {
      title: 'Exit Downex Completely?',
      badge: 'EXIT APPLICATION',
      badgeColor: 'bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border-zinc-300 dark:border-zinc-700',
      icon: Power,
      iconColor: 'text-rose-600 dark:text-rose-400',
      iconBg: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/60',
      description:
        'This will close all Downex windows, remove the background system tray icon, and pause active downloads until you reopen the app.',
      bulletPoints: [
        'Pauses running downloads safely to prevent corrupted files',
        'Removes Downex from the Windows system tray notification area',
        'Disconnects browser extension download capture until reopened',
        'Completely shuts down the application process',
      ],
      warningTitle: 'Background Service Termination',
      warningDescription: 'Downex will not capture browser downloads while closed.',
      requiresCheckbox: false,
      checkboxLabel: 'I understand that Downex will exit completely.',
      confirmButtonText: 'Exit App',
      confirmButtonLoading: 'Exiting...',
      confirmButtonClass: 'bg-zinc-900 hover:bg-black dark:bg-zinc-700 dark:hover:bg-zinc-600 text-white',
    },
  }[actionType];

  const IconComponent = config.icon;
  const requiresCheckbox = config.requiresCheckbox === true;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150 select-none"
      onClick={() => {
        if (!isLoading) onClose();
      }}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-5 border-b border-zinc-100 dark:border-zinc-800 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${config.iconBg} border flex items-center justify-center shrink-0 shadow-xs`}>
              <IconComponent className={`w-5 h-5 ${config.iconColor}`} />
            </div>
            <div>
              <span className={`inline-block px-2 py-0.5 rounded-sm border text-[9px] font-mono font-bold tracking-wider mb-1 ${config.badgeColor}`}>
                {config.badge}
              </span>
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 leading-tight">
                {config.title}
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4">
          <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
            {config.description}
          </p>

          {/* Impact Bullet Points */}
          <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/80 dark:border-zinc-700/60 p-3.5 space-y-2">
            <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 block mb-1">
              Changes & Impact:
            </span>
            {config.bulletPoints.map((pt, idx) => (
              <div key={idx} className="flex items-start gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                <span>{pt}</span>
              </div>
            ))}
          </div>

          {/* Action Warning / Info Banner */}
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-bold text-[11px] font-mono uppercase tracking-wider">
                {config.warningTitle}
              </span>
              <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
                {config.warningDescription}
              </p>
            </div>
          </div>

          {/* Optional Safety Checkbox (for destructive binary/uninstall actions) */}
          {requiresCheckbox && (
            <label className="flex items-start gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 hover:bg-zinc-100/60 dark:hover:bg-zinc-800/40 transition-colors cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hasAcknowledged}
                onChange={(e) => setHasAcknowledged(e.target.checked)}
                disabled={isLoading}
                className="mt-0.5 w-4 h-4 rounded-xs border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:ring-0 cursor-pointer"
              />
              <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 leading-snug">
                {config.checkboxLabel}
              </span>
            </label>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="p-4 bg-zinc-50/80 dark:bg-zinc-950/60 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="h-9 px-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 text-xs font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={(requiresCheckbox && !hasAcknowledged) || isLoading}
            className={`h-9 px-5 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${config.confirmButtonClass}`}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{config.confirmButtonLoading}</span>
              </>
            ) : (
              <span>{config.confirmButtonText}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
