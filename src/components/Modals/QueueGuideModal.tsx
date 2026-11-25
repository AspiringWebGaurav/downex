import React, { useEffect } from 'react';
import { 
  X, 
  ListOrdered, 
  Clock, 
  Zap, 
  ShieldCheck,
  CheckCircle2,
  Download,
  Layers
} from 'lucide-react';
import { useDownloadStore } from '../../stores/downloadStore';

export const QueueGuideModal: React.FC = () => {
  const isQueueGuideOpen = useDownloadStore((state) => state.isQueueGuideOpen);
  const setQueueGuideOpen = useDownloadStore((state) => state.setQueueGuideOpen);
  const setNewModalOpen = useDownloadStore((state) => state.setNewModalOpen);
  const setSelectedView = useDownloadStore((state) => state.setSelectedView);

  // Close on Escape
  useEffect(() => {
    if (!isQueueGuideOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setQueueGuideOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isQueueGuideOpen, setQueueGuideOpen]);

  if (!isQueueGuideOpen) return null;

  const handleOpenAddModal = () => {
    setQueueGuideOpen(false);
    setSelectedView('queues');
    setNewModalOpen(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[1px] select-none p-3.5 transition-opacity duration-100">
      <div 
        className="w-full max-w-2xl bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 shadow-2xl flex flex-col modal-enter-instant overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="h-12 px-4 flex items-center justify-between border-b border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950/70 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-6.5 h-6.5 bg-emerald-500/10 dark:bg-emerald-500/20 border border-emerald-500/25 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
              <ListOrdered className="w-3.5 h-3.5 stroke-[2.2]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[13px] font-bold text-zinc-900 dark:text-zinc-100 font-mono-tabular uppercase tracking-wider leading-none">
                  How 1-by-1 Queue Works
                </h2>
                <span className="text-[9px] font-mono-tabular px-1.5 py-0.2 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 uppercase font-semibold">
                  SEQUENTIAL ENGINE
                </span>
              </div>
              <p className="text-[10.5px] text-zinc-500 dark:text-zinc-400 font-sans mt-0.5">
                Maximum line speed, clean workspace isolation, and automated resume safeguards
              </p>
            </div>
          </div>

          <button
            onClick={() => setQueueGuideOpen(false)}
            title="Close (Esc)"
            className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5 stroke-[2]" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 space-y-3.5 text-zinc-800 dark:text-zinc-200 overflow-y-auto max-h-[75vh]">
          {/* Why 1-by-1 Queue Banner */}
          <div className="p-3 border border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20 flex items-start gap-3">
            <div className="w-6 h-6 bg-emerald-600 dark:bg-emerald-500 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
              <Zap className="w-3.5 h-3.5 fill-current" />
            </div>
            <div className="space-y-1">
              <div className="text-[11.5px] font-bold text-emerald-900 dark:text-emerald-200 font-mono-tabular uppercase tracking-tight">
                Why use 1-by-1 Queue instead of downloading all files at once?
              </div>
              <p className="text-[11px] text-emerald-900/85 dark:text-emerald-300/85 leading-relaxed font-sans text-justify [text-justify:inter-word]">
                When multiple downloads run at the same time, they fight for bandwidth and all crawl along slowly.
                With <strong>1-by-1 Queue</strong>, Downex dedicates <strong>100% of your internet bandwidth (up to 32 parallel sockets)</strong> exclusively 
                to the active file. The instant it reaches 100%, the next file begins automatically with zero delay.
              </p>
            </div>
          </div>

          {/* 4 Symmetrical Workflow Cards (2x2 Grid) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {/* Card 1: Workspace Separation */}
            <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 p-3.5 flex flex-col justify-between">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-mono-tabular text-emerald-600 dark:text-emerald-400 font-bold">
                    STEP 01
                  </span>
                  <span className="text-[9px] font-mono-tabular px-1.5 py-0.2 border border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 uppercase font-medium">
                    CLEAN LIST
                  </span>
                </div>
                <div className="font-mono-tabular text-[12.5px] font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span>Workspace Isolation</span>
                </div>
                <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed font-sans text-justify [text-justify:inter-word]">
                  Click <strong className="text-zinc-900 dark:text-zinc-200 font-medium">Later</strong> when adding links or click <strong className="text-zinc-900 dark:text-zinc-200 font-medium">Queue</strong> on any item. Queued files leave the active download view and move to Queues, keeping your main workspace clean.
                </p>
              </div>
              <div className="pt-2 text-[9px] font-mono-tabular text-zinc-400 uppercase tracking-wider border-t border-zinc-200/80 dark:border-zinc-800/80 mt-2 flex items-center justify-between">
                <span>Action: Queue / Later</span>
                <span>Uncluttered</span>
              </div>
            </div>

            {/* Card 2: Dynamic Numbering */}
            <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 p-3.5 flex flex-col justify-between">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-mono-tabular text-emerald-600 dark:text-emerald-400 font-bold">
                    STEP 02
                  </span>
                  <span className="text-[9px] font-mono-tabular px-1.5 py-0.2 border border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 uppercase font-medium">
                    ORDERED #1...#N
                  </span>
                </div>
                <div className="font-mono-tabular text-[12.5px] font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                  <span>Dynamic Live Numbering</span>
                </div>
                <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed font-sans text-justify [text-justify:inter-word]">
                  Files are seeded with clear live priority badges (<strong className="font-mono text-zinc-800 dark:text-zinc-200">#1 • Next in Line</strong>, <strong className="font-mono text-zinc-800 dark:text-zinc-200">#2 • In Line</strong>). You can always see exactly which file will execute next.
                </p>
              </div>
              <div className="pt-2 text-[9px] font-mono-tabular text-zinc-400 uppercase tracking-wider border-t border-zinc-200/80 dark:border-zinc-800/80 mt-2 flex items-center justify-between">
                <span>Sequence: FIFO</span>
                <span>Priority #1</span>
              </div>
            </div>

            {/* Card 3: Non-Resumable Guard */}
            <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 p-3.5 flex flex-col justify-between">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-mono-tabular text-amber-600 dark:text-amber-400 font-bold">
                    STEP 03
                  </span>
                  <span className="text-[9px] font-mono-tabular px-1.5 py-0.2 border border-amber-500/40 text-amber-700 dark:text-amber-300 uppercase font-medium">
                    SAFEGUARD
                  </span>
                </div>
                <div className="font-mono-tabular text-[12.5px] font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span>Non-Resumable Guard</span>
                </div>
                <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed font-sans text-justify [text-justify:inter-word]">
                  If an active download does not support HTTP Range resume, Downex intercepts it before pausing or queueing. A warning modal alerts you before any unresumable progress could be discarded.
                </p>
              </div>
              <div className="pt-2 text-[9px] font-mono-tabular text-zinc-400 uppercase tracking-wider border-t border-zinc-200/80 dark:border-zinc-800/80 mt-2 flex items-center justify-between">
                <span>Safety: Data Loss Prevention</span>
                <span>Verified</span>
              </div>
            </div>

            {/* Card 4: Auto Handoff on 100% */}
            <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 p-3.5 flex flex-col justify-between">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-mono-tabular text-emerald-600 dark:text-emerald-400 font-bold">
                    STEP 04
                  </span>
                  <span className="text-[9px] font-mono-tabular px-1.5 py-0.2 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 uppercase font-medium">
                    AUTO HANDOFF
                  </span>
                </div>
                <div className="font-mono-tabular text-[12.5px] font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span>Completed Reflection</span>
                </div>
                <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed font-sans text-justify [text-justify:inter-word]">
                  Downloads run strictly 1-by-1 at maximum line speed. The moment a file reaches 100%, it automatically reflects back into All Downloads as Completed, and File #2 immediately begins.
                </p>
              </div>
              <div className="pt-2 text-[9px] font-mono-tabular text-zinc-400 uppercase tracking-wider border-t border-zinc-200/80 dark:border-zinc-800/80 mt-2 flex items-center justify-between">
                <span>Pipeline: 1-by-1</span>
                <span>Auto Handoff</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-3 px-4 border-t border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/50 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setQueueGuideOpen(false)}
            className="h-7.5 px-3 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-mono-tabular text-[11px] uppercase tracking-wider text-zinc-700 dark:text-zinc-300 cursor-pointer"
          >
            Got it
          </button>

          <button
            type="button"
            onClick={handleOpenAddModal}
            className="h-7.5 px-3.5 bg-zinc-900 hover:bg-black dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 font-mono-tabular text-[11px] font-semibold uppercase tracking-wider cursor-pointer flex items-center gap-1.5 shadow-2xs"
          >
            <Download className="w-3.5 h-3.5 stroke-[2.2]" />
            <span>Add Download to Queue</span>
          </button>
        </div>
      </div>
    </div>
  );
};
