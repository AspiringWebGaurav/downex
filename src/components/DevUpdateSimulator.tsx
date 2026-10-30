import React, { useState } from 'react';
import { updateService } from '../services/updateService';
import { FlaskConical, Play, CheckCircle, ArrowDown, RefreshCw, X, ChevronUp, ChevronDown } from 'lucide-react';

export const DevUpdateSimulator: React.FC = () => {
  // Only render in dev or browser preview mode
  const isDev = Boolean((import.meta as any).env?.DEV || typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__);
  const [isOpen, setIsOpen] = useState(false);

  if (!isDev) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 select-none font-sans">
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-900/90 dark:bg-white/90 text-white dark:text-zinc-900 text-xs font-medium shadow-lg backdrop-blur-md hover:scale-105 active:scale-95 transition-all cursor-pointer border border-zinc-700/50 dark:border-zinc-200/50"
          title="Interactive Update Modal QA Tester"
        >
          <FlaskConical className="w-3.5 h-3.5 text-emerald-400 dark:text-emerald-600 animate-pulse" />
          <span>Test Download Modal</span>
          <ChevronUp className="w-3 h-3 opacity-60" />
        </button>
      ) : (
        <div className="w-64 rounded-2xl bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border border-zinc-200/80 dark:border-zinc-800/80 p-3.5 shadow-2xl flex flex-col gap-2 text-zinc-900 dark:text-zinc-100 animate-in fade-in slide-in-from-bottom-2 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between pb-1.5 border-b border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center gap-1.5">
              <FlaskConical className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-xs font-semibold">Download Modal Tester</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-col gap-1.5 pt-1">
            <button
              onClick={() => updateService.simulateUpdate('auto')}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium shadow-xs transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-1.5">
                <Play className="w-3 h-3 fill-current" />
                <span>Run Full Flow</span>
              </div>
              <span className="text-[10px] opacity-80">Auto</span>
            </button>

            <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider px-1 pt-1">
              Inspect Specific States:
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => updateService.simulateUpdate('available')}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-medium transition-colors cursor-pointer"
                title="Pop up modal with Download & Later buttons"
              >
                <ArrowDown className="w-3 h-3 text-emerald-500" />
                <span>1. Available</span>
              </button>

              <button
                onClick={() => updateService.simulateUpdate('downloading')}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-medium transition-colors cursor-pointer"
                title="Simulate active download progress"
              >
                <RefreshCw className="w-3 h-3 text-blue-500 animate-spin" />
                <span>2. In-Progress</span>
              </button>

              <button
                onClick={() => updateService.simulateUpdate('verifying')}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-medium transition-colors cursor-pointer"
                title="Simulate verifying package state"
              >
                <CheckCircle className="w-3 h-3 text-emerald-500" />
                <span>3. Verifying</span>
              </button>

              <button
                onClick={() => updateService.simulateUpdate('ready')}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-medium transition-colors cursor-pointer"
                title="Simulate update ready with restart action"
              >
                <CheckCircle className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                <span>4. Ready</span>
              </button>
            </div>

            <button
              onClick={() => updateService.simulateUpdate('idle')}
              className="mt-1 w-full flex items-center justify-center gap-1.5 px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 text-[11px] font-medium transition-colors cursor-pointer"
            >
              <X className="w-3 h-3" />
              <span>Reset & Close Modal</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
