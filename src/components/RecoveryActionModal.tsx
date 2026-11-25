import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Wrench,
  RotateCcw,
  Trash2,
  AlertTriangle,
  Check,
  Loader2,
  Power,
  FolderOpen,
} from 'lucide-react';

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

type ToneVariant = 'rose' | 'emerald' | 'amber' | 'neutral';

interface ActionModalConfig {
  title: string;
  badge: string;
  subtitle: string;
  tone: ToneVariant;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  operationValue: string;
  operationTag: string;
  safetyValue: string;
  safetyTag: string;
  statusPill: string;
  bulletPoints: string[];
  warningTitle: string;
  warningDescription: string;
  requiresCheckbox: boolean;
  checkboxLabel: string;
  footerHint: string;
  confirmButtonText: string;
  confirmButtonLoading: string;
}

const ACTION_CONFIGS: Record<Exclude<RecoveryActionType, null>, ActionModalConfig> = {
  'reset-defaults': {
    title: 'Reset all preferences to defaults?',
    badge: 'RESET DEFAULTS',
    subtitle: 'PREFERENCES RESET',
    tone: 'rose',
    icon: RotateCcw,
    description:
      'Restores your startup, tray, clipboard, home stats, and speed settings back to default values.',
    operationValue: 'Reset Settings',
    operationTag: 'RESET',
    safetyValue: 'Folder & Files Safe',
    safetyTag: 'SAFE',
    statusPill: 'RESETS SETTINGS',
    bulletPoints: [
      'Turns Start with Windows and Keep in system tray back ON',
      'Turns automatic clipboard link detection back ON',
      'Sets download connections back to 32',
      'Turns the Speed & Stats panel on the home screen OFF',
    ],
    warningTitle: 'Overwrites custom preferences',
    warningDescription: 'Resets app settings only; your download folder and files stay safe.',
    requiresCheckbox: true,
    checkboxLabel: 'I confirm resetting my Downex preferences back to defaults.',
    footerHint: 'Downloaded files are not affected',
    confirmButtonText: 'Reset Defaults',
    confirmButtonLoading: 'Resetting...',
  },
  'reset-folder': {
    title: 'Reset default download folder?',
    badge: 'RESET FOLDER',
    subtitle: 'SAVE LOCATION',
    tone: 'neutral',
    icon: FolderOpen,
    description: 'Changes your save folder back to the standard Windows Downloads folder.',
    operationValue: 'Downloads\\Downex',
    operationTag: 'FOLDER',
    safetyValue: 'Existing Files Safe',
    safetyTag: 'SAFE',
    statusPill: 'FILES SAFE',
    bulletPoints: [
      'New downloads save to %USERPROFILE%\\Downloads\\Downex',
      'Files you already downloaded stay untouched',
      'You can change this folder anytime in Settings',
    ],
    warningTitle: 'Folder update',
    warningDescription: 'Only new downloads will save to the default folder.',
    requiresCheckbox: false,
    checkboxLabel: 'Confirm folder reset.',
    footerHint: 'Applies to new downloads',
    confirmButtonText: 'Reset Folder',
    confirmButtonLoading: 'Resetting...',
  },
  repair: {
    title: 'Repair app & restart?',
    badge: 'RUN REPAIR',
    subtitle: 'APP MAINTENANCE',
    tone: 'amber',
    icon: Wrench,
    description:
      'Closes and restarts Downex cleanly to fix stuck tasks, leftover files, or tray icon glitches.',
    operationValue: 'Clean & Restart',
    operationTag: 'REPAIR',
    safetyValue: 'Downloads & Settings Safe',
    safetyTag: 'SAFE',
    statusPill: 'RESTARTS APP',
    bulletPoints: [
      'Closes and restarts the Downex app automatically',
      'Cleans up leftover update files that may block the app',
      'Refreshes your system tray icon and app shortcuts',
      'Keeps all your downloaded files, queue, and settings safe',
    ],
    warningTitle: 'Restarts the app',
    warningDescription: 'Downex will close and reopen; any active downloads will pause.',
    requiresCheckbox: true,
    checkboxLabel: 'I understand Downex will restart to complete the repair.',
    footerHint: 'Saved downloads stay intact',
    confirmButtonText: 'Run Repair',
    confirmButtonLoading: 'Repairing...',
  },
  'reset-base': {
    title: 'Go back to Base version (v0.0.1)?',
    badge: 'REVERT TO V0.0.1',
    subtitle: 'VERSION ROLLBACK',
    tone: 'amber',
    icon: RotateCcw,
    description:
      'Downloads the original Base v0.0.1 version and reinstalls the app while keeping your data safe.',
    operationValue: 'Reinstall v0.0.1',
    operationTag: 'ROLLBACK',
    safetyValue: 'Downloads & Settings Safe',
    safetyTag: 'SAFE',
    statusPill: 'REINSTALLS V0.0.1',
    bulletPoints: [
      'Downloads and installs the original Base v0.0.1 app',
      'Removes newer updates and restarts Downex cleanly',
      'Keeps your download list, saved files, and settings',
      'You can always update to a newer version later',
    ],
    warningTitle: 'Replaces current app version',
    warningDescription: 'Swaps your app back to v0.0.1 and restarts Downex automatically.',
    requiresCheckbox: true,
    checkboxLabel: 'I confirm going back to Base v0.0.1 and restarting the app.',
    footerHint: 'Requires active internet connection',
    confirmButtonText: 'Revert to v0.0.1',
    confirmButtonLoading: 'Reverting...',
  },
  uninstall: {
    title: 'Uninstall Downex Desktop?',
    badge: 'UNINSTALL DOWNEX',
    subtitle: 'WINDOWS REMOVAL',
    tone: 'rose',
    icon: Trash2,
    description:
      'Closes Downex and opens the Windows uninstaller so you can remove the app cleanly.',
    operationValue: 'Remove Program',
    operationTag: 'UNINSTALL',
    safetyValue: 'Downloads Kept',
    safetyTag: 'SAFE',
    statusPill: 'FILES KEPT SAFE',
    bulletPoints: [
      'Closes Downex and stops background download capture',
      'Opens the official Windows removal wizard',
      'Removes the app program and desktop shortcuts',
      'Files you already downloaded on your PC are NOT deleted',
    ],
    warningTitle: 'Removes Downex from Windows',
    warningDescription: 'Removes the application only; your saved downloads stay safe.',
    requiresCheckbox: true,
    checkboxLabel: 'I confirm closing Downex and opening the Windows uninstaller.',
    footerHint: 'Downloaded files are safe',
    confirmButtonText: 'Uninstall Downex',
    confirmButtonLoading: 'Launching...',
  },
  'stop-engine': {
    title: 'Exit Downex completely?',
    badge: 'EXIT APPLICATION',
    subtitle: 'CLOSE APP',
    tone: 'rose',
    icon: Power,
    description: 'Closes all windows, removes the tray icon, and pauses active downloads until reopened.',
    operationValue: 'Close App',
    operationTag: 'EXIT',
    safetyValue: 'Queue Paused',
    safetyTag: 'SAFE',
    statusPill: 'FULL EXIT',
    bulletPoints: [
      'Pauses running downloads safely',
      'Removes the Downex icon from the system tray',
      'Stops browser download capture until you reopen Downex',
    ],
    warningTitle: 'Background capture off',
    warningDescription: 'Browser links will not auto-capture while closed.',
    requiresCheckbox: false,
    checkboxLabel: 'Exit Downex completely.',
    footerHint: 'Reopen anytime from Start menu',
    confirmButtonText: 'Exit App',
    confirmButtonLoading: 'Exiting...',
  },
};

const TONE_CLASSES: Record<
  ToneVariant,
  {
    headerText: string;
    activeBox: string;
    activeCheck: string;
    activePill: string;
    activeBanner: string;
    activeButton: string;
  }
> = {
  rose: {
    headerText: 'text-rose-600 dark:text-rose-400',
    activeBox: 'border-rose-500/50 bg-rose-500/[0.04] dark:bg-rose-950/20',
    activeCheck: 'bg-rose-600 border-rose-600 text-white',
    activePill: 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/30',
    activeBanner:
      'bg-rose-500/10 dark:bg-rose-950/40 border-rose-500/30 text-rose-800 dark:text-rose-300',
    activeButton:
      'bg-rose-600 hover:bg-rose-700 active:bg-rose-800 border-rose-600 text-white',
  },
  emerald: {
    headerText: 'text-emerald-600 dark:text-emerald-400',
    activeBox: 'border-emerald-500/50 bg-emerald-500/[0.04] dark:bg-emerald-950/20',
    activeCheck: 'bg-emerald-600 border-emerald-600 text-white',
    activePill: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    activeBanner:
      'bg-emerald-500/[0.08] dark:bg-emerald-950/30 border-emerald-500/25 text-emerald-800 dark:text-emerald-300',
    activeButton:
      'bg-black hover:bg-zinc-800 border-black text-white dark:bg-white dark:hover:bg-zinc-200 dark:border-white dark:text-zinc-950',
  },
  amber: {
    headerText: 'text-amber-600 dark:text-amber-400',
    activeBox: 'border-amber-500/50 bg-amber-500/[0.04] dark:bg-amber-950/20',
    activeCheck: 'bg-amber-600 border-amber-600 text-white',
    activePill: 'text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/30',
    activeBanner:
      'bg-amber-500/[0.08] dark:bg-amber-950/30 border-amber-500/30 text-amber-800 dark:text-amber-300',
    activeButton:
      'bg-amber-600 hover:bg-amber-700 active:bg-amber-800 border-amber-600 text-white',
  },
  neutral: {
    headerText: 'text-zinc-700 dark:text-zinc-300',
    activeBox: 'border-zinc-500/50 bg-zinc-500/[0.04] dark:bg-zinc-900/40',
    activeCheck: 'bg-zinc-900 border-zinc-900 text-white dark:bg-zinc-100 dark:border-zinc-100 dark:text-zinc-950',
    activePill: 'text-zinc-700 dark:text-zinc-300 bg-zinc-200/70 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700',
    activeBanner:
      'bg-zinc-100 dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300',
    activeButton:
      'bg-black hover:bg-zinc-800 border-black text-white dark:bg-white dark:hover:bg-zinc-200 dark:border-white dark:text-zinc-950',
  },
};

export const RecoveryActionModal: React.FC<RecoveryActionModalProps> = ({
  isOpen,
  actionType,
  onClose,
  onConfirm,
  isLoading,
}) => {
  const [hasAcknowledged, setHasAcknowledged] = useState(false);

  useEffect(() => {
    setHasAcknowledged(false);
  }, [isOpen, actionType]);

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

  const config = ACTION_CONFIGS[actionType];
  const tone = TONE_CLASSES[config.tone];
  const IconComponent = config.icon;
  const requiresCheckbox = config.requiresCheckbox;
  const canConfirm = (!requiresCheckbox || hasAcknowledged) && !isLoading;

  const modalContent = (
    <div
      data-testid={`recovery-modal-${actionType}`}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-xs select-none animate-in fade-in duration-100"
      onClick={() => {
        if (!isLoading) onClose();
      }}
    >
      <div
        data-testid="recovery-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recovery-modal-title"
        className="w-[480px] max-w-[94vw] max-h-[calc(100vh-2rem)] bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden select-none border border-zinc-200 dark:border-zinc-800 shadow-2xl modal-enter-instant flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title Bar Strip (1:1 Swiss Header matching NewDownloadModal & DeleteConfirmModal) */}
        <div className="h-8 px-3.5 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 select-none shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <IconComponent className={`w-3.5 h-3.5 stroke-[2] shrink-0 ${tone.headerText}`} />
            <span className={`font-mono-tabular text-[10.5px] uppercase tracking-wider font-semibold shrink-0 ${tone.headerText}`}>
              {config.badge}
            </span>
            <span className="text-[10px] font-mono-tabular text-zinc-400 uppercase truncate">
              {config.subtitle}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            title="Close (Esc)"
            data-testid="recovery-modal-close-btn"
            className="p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer focus:outline-none disabled:opacity-40"
          >
            <X className="w-3.5 h-3.5 stroke-[1.8]" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-3.5 space-y-2.5 overflow-y-auto no-scrollbar">
          {/* Row 1: Action Title & Safety Badge */}
          <div className="flex items-start justify-between gap-2.5">
            <div className="min-w-0">
              <h3
                id="recovery-modal-title"
                className="text-[13px] font-bold text-zinc-900 dark:text-zinc-100 tracking-tight leading-tight"
              >
                {config.title}
              </h3>
              <p className="text-[10.5px] text-zinc-500 dark:text-zinc-400 leading-snug mt-0.5">
                {config.description}
              </p>
            </div>
            <span className="text-[9.5px] font-mono-tabular font-semibold uppercase px-1.5 py-0.5 border border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5 shrink-0">
              {config.statusPill}
            </span>
          </div>

          {/* Row 2: 2-Column Structured Scope Strip (matching NewDownloadModal) */}
          <div className="grid grid-cols-2 gap-2">
            <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-950/40 px-2.5 py-1.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[9.5px] uppercase font-mono-tabular text-zinc-400 leading-tight">
                  Operation
                </div>
                <div className="font-mono-tabular text-[11.5px] font-bold text-zinc-900 dark:text-zinc-100 leading-snug truncate">
                  {config.operationValue}
                </div>
              </div>
              <span className="text-[9px] font-mono-tabular px-1.5 py-0.5 border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 uppercase shrink-0">
                {config.operationTag}
              </span>
            </div>

            <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-950/40 px-2.5 py-1.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[9.5px] uppercase font-mono-tabular text-zinc-400 leading-tight">
                  Your Downloads
                </div>
                <div className="font-mono-tabular text-[11.5px] font-bold text-zinc-900 dark:text-zinc-100 leading-snug truncate">
                  {config.safetyValue}
                </div>
              </div>
              <span className="text-[9px] font-mono-tabular px-1.5 py-0.5 border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 uppercase shrink-0">
                {config.safetyTag}
              </span>
            </div>
          </div>

          {/* Row 3: Changes & Impact Matrix */}
          <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 p-2 space-y-1.5">
            <div className="flex items-center justify-between text-[9.5px] font-mono-tabular text-zinc-500 uppercase pb-1 border-b border-zinc-200/70 dark:border-zinc-800/70">
              <span>Changes &amp; Impact</span>
              <span>{config.bulletPoints.length} STEPS</span>
            </div>
            <div className="space-y-1">
              {config.bulletPoints.map((pt, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 text-[11px] font-mono-tabular text-zinc-700 dark:text-zinc-300 leading-snug"
                >
                  <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0 stroke-[2.5]" />
                  <span>{pt}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Row 4: Interactive Confirmation Toggle + Compact Notice Strip */}
          {requiresCheckbox ? (
            <div
              data-testid="recovery-confirm-toggle"
              onClick={() => !isLoading && setHasAcknowledged(!hasAcknowledged)}
              className={`p-2 border transition-colors cursor-pointer select-none space-y-1.5 ${
                hasAcknowledged
                  ? tone.activeBox
                  : 'border-zinc-300 dark:border-zinc-700 bg-zinc-50/40 dark:bg-zinc-900/40 hover:border-zinc-400 dark:hover:border-zinc-600'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={`w-3.5 h-3.5 flex items-center justify-center border transition-colors shrink-0 ${
                      hasAcknowledged
                        ? tone.activeCheck
                        : 'border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800'
                    }`}
                  >
                    {hasAcknowledged && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                  </div>
                  <span className="text-[11px] font-mono-tabular font-semibold text-zinc-900 dark:text-zinc-100 leading-tight">
                    {config.checkboxLabel}
                  </span>
                </div>
                <span
                  className={`text-[9px] font-mono-tabular font-bold px-1.5 py-0.5 border shrink-0 uppercase ${
                    hasAcknowledged
                      ? tone.activePill
                      : 'text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700'
                  }`}
                >
                  {hasAcknowledged ? 'CONFIRMED' : 'REQUIRED'}
                </span>
              </div>

              <div
                className={`px-2 py-1 border flex items-center gap-1.5 ${
                  hasAcknowledged
                    ? tone.activeBanner
                    : 'bg-amber-500/[0.08] dark:bg-amber-950/30 border-amber-500/25 text-amber-800 dark:text-amber-300'
                }`}
              >
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span className="text-[10px] leading-tight font-mono-tabular font-medium">
                  {config.warningTitle}: {config.warningDescription}
                </span>
              </div>
            </div>
          ) : (
            <div className="px-2.5 py-1.5 bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
              <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
              <span className="text-[10px] leading-tight font-mono-tabular font-medium">
                {config.warningTitle}: {config.warningDescription}
              </span>
            </div>
          )}
        </div>

        {/* Bottom Actions Strip */}
        <div className="px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2 shrink-0">
          <span className="text-[10px] font-mono-tabular text-zinc-400 truncate">
            {requiresCheckbox && !hasAcknowledged ? 'Confirm checkbox above' : config.footerHint}
          </span>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              data-testid="recovery-modal-cancel-btn"
              className="h-7.5 px-3 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-mono-tabular text-[10.5px] uppercase tracking-wider text-zinc-700 dark:text-zinc-300 cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={onConfirm}
              disabled={!canConfirm}
              data-testid="recovery-modal-confirm-btn"
              className={`h-7.5 px-3.5 border font-mono-tabular text-[10.5px] uppercase tracking-wider font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                canConfirm
                  ? `${tone.activeButton} cursor-pointer`
                  : 'bg-zinc-400 dark:bg-zinc-700 border-zinc-400 dark:border-zinc-700 text-white/90 cursor-not-allowed'
              }`}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>{config.confirmButtonLoading}</span>
                </>
              ) : (
                <>
                  <IconComponent className="w-3 h-3 stroke-[2.2]" />
                  <span>{config.confirmButtonText}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }
  return modalContent;
};
