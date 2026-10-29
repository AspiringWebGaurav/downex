import React, { useEffect, useState } from 'react';
import { X, Sparkles, CheckCircle2, ArrowRight } from 'lucide-react';
import { useAppVersionStore } from '../stores/appVersionStore';

export const PatchNotesModal: React.FC = () => {
  const isPatchNotesOpen = useAppVersionStore((state) => state.isPatchNotesOpen);
  const patchNotes = useAppVersionStore((state) => state.patchNotes);
  const closePatchNotes = useAppVersionStore((state) => state.closePatchNotes);
  const [isCloseHovered, setIsCloseHovered] = useState(false);

  useEffect(() => {
    if (!isPatchNotesOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        closePatchNotes();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPatchNotesOpen, closePatchNotes]);

  if (!isPatchNotesOpen || !patchNotes) return null;

  const currentVer = patchNotes.version.startsWith('v')
    ? patchNotes.version
    : `v${patchNotes.version}`;
  const prevVer = patchNotes.previousVersion.startsWith('v')
    ? patchNotes.previousVersion
    : `v${patchNotes.previousVersion}`;

  // Parse notes lines into structured items if available
  const rawNotes = patchNotes.notes?.trim() || '';
  const noteLines = rawNotes
    ? rawNotes
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
    : [
        'Enhanced multi-connection download engine throughput and chunk allocation',
        'In-process atomic OTA update synchronization with zero-lock shadow swap',
        'Real-time streaming download progress with calibrated micro-animations',
        'Persistent state recovery and Windows Shell integration improvements',
      ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs select-none animate-in fade-in duration-200">
      <div className="w-[460px] max-w-[calc(100vw-32px)] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        {/* Header Celebration Banner */}
        <div className="relative px-6 pt-6 pb-4 bg-gradient-to-b from-emerald-500/10 via-emerald-500/5 to-transparent border-b border-zinc-100 dark:border-zinc-800/60">
          <button
            onClick={() => {
              setIsCloseHovered(false);
              closePatchNotes();
            }}
            onMouseEnter={() => setIsCloseHovered(true)}
            onMouseLeave={() => setIsCloseHovered(false)}
            className={`absolute top-4 right-4 p-1.5 rounded-lg transition-colors cursor-pointer focus:outline-none ${
              isCloseHovered
                ? 'bg-rose-500 text-white dark:bg-rose-600'
                : 'text-zinc-400 dark:text-zinc-500 bg-transparent'
            }`}
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                  Update Installed Successfully
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  Active
                </span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Downex is now running the latest release.
              </p>
            </div>
          </div>

          {/* Version Transition Capsule */}
          <div className="mt-4 flex items-center justify-between p-2.5 rounded-xl bg-zinc-100/80 dark:bg-zinc-800/60 border border-zinc-200/60 dark:border-zinc-700/60 font-mono text-xs">
            <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
              <span className="text-[10px] uppercase tracking-wider font-semibold">Previous</span>
              <span className="px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700/60 text-zinc-700 dark:text-zinc-300 font-medium">
                {prevVer}
              </span>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-zinc-400" />
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-600 dark:text-emerald-400">Current</span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-600 text-white font-bold shadow-xs">
                {currentVer}
              </span>
            </div>
          </div>
        </div>

        {/* Patch Notes Content */}
        <div className="p-6 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-mono">
              What's New in {currentVer}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200/60 dark:border-zinc-800/80 max-h-48 overflow-y-auto flex flex-col gap-2">
            {noteLines.map((line, idx) => {
              const cleanLine = line.replace(/^[-*•]\s*/, '');
              return (
                <div key={idx} className="flex items-start gap-2.5 text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                  <span>{cleanLine}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer Action */}
        <div className="px-6 py-4 bg-zinc-50/70 dark:bg-zinc-900/80 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-end">
          <button
            onClick={closePatchNotes}
            className="w-full py-2 px-4 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
          >
            <span>Got it, thanks!</span>
          </button>
        </div>
      </div>
    </div>
  );
};
