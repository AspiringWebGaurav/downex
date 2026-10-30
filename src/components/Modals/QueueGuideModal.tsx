import React, { useEffect } from 'react';
import { 
  X, 
  ListOrdered, 
  Clock, 
  Play, 
  Zap, 
  Download
} from 'lucide-react';
import { Button } from '../ui/Button';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs select-none p-4 animate-in fade-in duration-150">
      <div 
        className="w-full max-w-xl bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="h-14 px-6 flex items-center justify-between border-b border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950/70 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 dark:bg-emerald-500/20 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0 shadow-2xs">
              <ListOrdered className="w-4 h-4 stroke-[2.5]" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 leading-tight">
                How 1-by-1 Queue Works
              </h2>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Sequential downloading at peak speed without splitting internet bandwidth
              </p>
            </div>
          </div>

          <button
            onClick={() => setQueueGuideOpen(false)}
            title="Close (Esc)"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4 text-zinc-800 dark:text-zinc-200 overflow-y-auto max-h-[75vh]">
          {/* Concept Explanation Card */}
          <div className="p-3.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/60 flex items-start gap-3">
            <div className="w-6 h-6 rounded-md bg-emerald-600 dark:bg-emerald-500 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
              <Zap className="w-3.5 h-3.5 fill-current" />
            </div>
            <div className="space-y-1">
              <span className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                Why use 1-by-1 Queue instead of downloading all at once?
              </span>
              <p className="text-[11px] text-emerald-800/90 dark:text-emerald-300/90 leading-relaxed">
                When you download multiple large files simultaneously, they compete for bandwidth and crawl slowly. 
                With <strong>1-by-1 Queue</strong>, Downex dedicates <strong>100% of your network speed (up to 32 parallel connections)</strong> to file #1. 
                As soon as it completes, file #2 starts automatically without any manual intervention!
              </p>
            </div>
          </div>

          {/* 3 Step Visual Guide */}
          <div className="space-y-2.5">
            <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider px-1">
              3 Simple Steps to Use the Queue
            </span>

            <div className="rounded-xl border border-zinc-200/80 dark:border-zinc-800 divide-y divide-zinc-200/60 dark:divide-zinc-800/60 bg-zinc-50/50 dark:bg-zinc-900/40">
              {/* Step 1 */}
              <div className="p-3.5 flex items-start gap-3.5">
                <div className="w-6 h-6 rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 flex items-center justify-center text-xs font-bold shrink-0 shadow-xs">
                  1
                </div>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      Add a file and choose "Later"
                    </span>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                      <Clock className="w-2.5 h-2.5" /> Later
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Click <strong>+ New Download</strong> (Ctrl+N), enter your URL, and click the <strong>Later</strong> button instead of Start Download.
                    <br />
                    <span className="text-zinc-400 dark:text-zinc-500 text-[10px]">
                      Tip: On any paused download in "All Downloads", click the queue icon to add it to the waiting line.
                    </span>
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="p-3.5 flex items-start gap-3.5">
                <div className="w-6 h-6 rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 flex items-center justify-center text-xs font-bold shrink-0 shadow-xs">
                  2
                </div>
                <div className="space-y-0.5">
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    Files line up in priority order
                  </span>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Go to the <strong>Queues</strong> tab in the sidebar. All your enqueued files are held safely in a paused queue waiting their turn.
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="p-3.5 flex items-start gap-3.5">
                <div className="w-6 h-6 rounded-full bg-emerald-600 text-white dark:bg-emerald-500 dark:text-zinc-900 flex items-center justify-center text-xs font-bold shrink-0 shadow-xs">
                  3
                </div>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      Click "Start Queue (1 by 1)"
                    </span>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300">
                      <Play className="w-2.5 h-2.5 fill-current" /> Auto Run
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Downex starts file #1 at full speed. When it finishes (100%), file #2 starts automatically until all queued downloads are completed.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 px-6 border-t border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 flex items-center justify-end gap-3 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={() => setQueueGuideOpen(false)}
          >
            Got it
          </Button>

          <Button
            type="button"
            variant="primary-emerald"
            size="md"
            icon={<Download className="w-3.5 h-3.5 stroke-[2.5]" />}
            onClick={handleOpenAddModal}
          >
            + Add to Queue Now
          </Button>
        </div>
      </div>
    </div>
  );
};
