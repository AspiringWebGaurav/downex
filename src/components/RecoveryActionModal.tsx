import React, { useState, useEffect } from 'react';
import { X, Wrench, RotateCcw, Trash2, AlertTriangle, CheckCircle2, Loader2, Power } from 'lucide-react';

export type RecoveryActionType = 'repair' | 'reset-base' | 'uninstall' | 'stop-engine' | null;

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
    repair: {
      title: 'Execute Process & Lock Repair?',
      badge: 'SELF-HEALING MAINTENANCE',
      badgeColor: 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
      icon: Wrench,
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      iconBg: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/80',
      description:
        'This diagnostic routine will forcefully terminate any stuck background watchdog tasks, flush temporary files, release locked SQLite handles, and perform an instant clean restart.',
      bulletPoints: [
        'Terminates orphaned background processes and file watchers',
        'Sweeps temporary and stale .tmp / .old update containers',
        'Releases active SQLite database locks and resets socket pools',
        'Preserves all active downloads and configuration settings',
      ],
      checkboxLabel: 'I understand that Downex will terminate background processes and restart immediately.',
      confirmButtonText: 'YES, RUN REPAIR',
      confirmButtonLoading: 'REPAIRING...',
      confirmButtonClass: 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white',
    },
    'reset-base': {
      title: 'Reset Executable to Base Foundation (v0.0.0)?',
      badge: 'IRREVERSIBLE BINARY ROLLBACK',
      badgeColor: 'bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800',
      icon: RotateCcw,
      iconColor: 'text-amber-600 dark:text-amber-400',
      iconBg: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/80',
      description:
        'This operation will replace your current executable binary with the verified immutable Base 0.0.0 foundation installer. Any dynamic OTA releases will be rolled back.',
      bulletPoints: [
        'Replaces current Downex.exe on disk with clean Base 0.0.0 foundation',
        'Clears any partially staged or incompatible dynamic update containers',
        'Your download history, target files, and personal preferences remain 100% intact',
        'Downex will shut down and immediately restart with base binaries',
      ],
      checkboxLabel: 'I acknowledge that this action will revert Downex to version 0.0.0 and restart the application.',
      confirmButtonText: 'YES, RESET TO BASE (v0.0.0)',
      confirmButtonLoading: 'REVERTING...',
      confirmButtonClass: 'bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white',
    },
    uninstall: {
      title: 'Completely Uninstall Downex Desktop?',
      badge: 'DESTRUCTIVE SYSTEM REMOVAL',
      badgeColor: 'bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-800',
      icon: Trash2,
      iconColor: 'text-rose-600 dark:text-rose-400',
      iconBg: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/80',
      description:
        'This will immediately terminate Downex, unregister system protocol associations, and launch the native Windows uninstallation wizard to permanently remove Downex from your system.',
      bulletPoints: [
        'Terminates all active downloads and background connection sockets',
        'Removes Windows autostart entries, tray services, and shell associations',
        'Launches the official Windows NSIS uninstaller to clean app binaries',
        'Downloaded files stored on your PC will NOT be deleted',
      ],
      checkboxLabel: 'I confirm that I want to exit Downex and permanently remove the application from Windows.',
      confirmButtonText: 'YES, UNINSTALL DOWNEX',
      confirmButtonLoading: 'LAUNCHING...',
      confirmButtonClass: 'bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white',
    },
    'stop-engine': {
      title: 'Stop Background Engine & Exit?',
      badge: 'SHUT DOWN ALL BACKGROUND SERVICES',
      badgeColor: 'bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border-zinc-300 dark:border-zinc-700',
      icon: Power,
      iconColor: 'text-rose-600 dark:text-rose-400',
      iconBg: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/60',
      description:
        'This will completely shut down all Downex background processes, close the browser extension loopback bridge (port 18888), remove the system tray icon, and pause active downloads.',
      bulletPoints: [
        'Disconnects browser extension integration and stops link interception',
        'Pauses active download queues safely to prevent data corruption',
        'Removes Downex from the Windows system tray notification area',
        'Completely terminates the application process until you open it again',
      ],
      checkboxLabel: 'I understand that Downex will stop grabbing browser links and exit completely.',
      confirmButtonText: 'YES, STOP & EXIT',
      confirmButtonLoading: 'STOPPING...',
      confirmButtonClass: 'bg-zinc-800 hover:bg-zinc-900 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-white',
    },
  }[actionType];

  const IconComponent = config.icon;

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
              Execution Impact Details:
            </span>
            {config.bulletPoints.map((pt, idx) => (
              <div key={idx} className="flex items-start gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                <span>{pt}</span>
              </div>
            ))}
          </div>

          {/* Irreversibility Warning Banner */}
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-bold text-[11px] font-mono uppercase tracking-wider">
                Irreversible Action Safety Guard
              </span>
              <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
                This operation is critical. You must explicitly acknowledge the safety statement below to unlock execution.
              </p>
            </div>
          </div>

          {/* Mandatory Safety Checkbox */}
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
        </div>

        {/* Modal Footer Actions */}
        <div className="p-4 bg-zinc-50/80 dark:bg-zinc-950/60 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="h-10 px-4 rounded-sm border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 font-mono text-xs font-semibold uppercase tracking-wider hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-50"
          >
            NO, CANCEL
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={!hasAcknowledged || isLoading}
            className={`h-10 px-5 rounded-sm font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${config.confirmButtonClass}`}
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
