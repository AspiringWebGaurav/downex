import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw, CheckCircle2, ShieldCheck, Database, Server, Cpu, X } from 'lucide-react';
import { useAppVersionStore } from '../stores/appVersionStore';
import { updateService } from '../services/updateService';

const COUNTDOWN_TOTAL_MS = 7000;

export const RestartingModal: React.FC = () => {
  const status = useAppVersionStore((state) => state.status);
  const isRestarting = status.state === 'restarting';

  const [elapsed, setElapsed] = useState(0);
  const [isCloseHovered, setIsCloseHovered] = useState(false);

  const handleCancel = useCallback(() => {
    setIsCloseHovered(false);
    updateService.notify({
      state: 'ready',
      errorMessage: undefined,
    });
  }, []);

  // Escape key listener to dismiss if needed
  useEffect(() => {
    if (!isRestarting) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRestarting, handleCancel]);

  useEffect(() => {
    if (!isRestarting) {
      setElapsed(0);
      return;
    }

    const startTime = Date.now();
    const interval = setInterval(() => {
      const now = Date.now();
      const diff = Math.min(COUNTDOWN_TOTAL_MS, now - startTime);
      setElapsed(diff);
      if (diff >= COUNTDOWN_TOTAL_MS) {
        clearInterval(interval);
      }
    }, 40);

    return () => clearInterval(interval);
  }, [isRestarting]);

  if (!isRestarting) return null;

  const targetVersion = status.targetVersion
    ? status.targetVersion.startsWith('v')
      ? status.targetVersion
      : `v${status.targetVersion}`
    : 'Latest';

  const progressPercent = Math.min(100, Math.floor((elapsed / COUNTDOWN_TOTAL_MS) * 100));
  const isFinalizing = elapsed >= COUNTDOWN_TOTAL_MS - 500;

  // SVG Circular Ring Math
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progressPercent / 100) * circumference;

  // Step milestone states calibrated for 7000ms
  const step1Done = elapsed >= 1600;
  const step2Done = elapsed >= 3400;
  const step3Done = elapsed >= 5200;
  const step4Active = elapsed >= 5200;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-xs select-none animate-in fade-in duration-200">
      <div className="w-[460px] max-w-[calc(100vw-32px)] bg-white border border-zinc-200/90 rounded-3xl shadow-[0_25px_60px_-15px_rgba(0,0,0,0.18)] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 relative">
        {/* Subtle Ambient Emerald Glow */}
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Dismiss Button in Top Right */}
        <button
          onClick={handleCancel}
          onMouseEnter={() => setIsCloseHovered(true)}
          onMouseLeave={() => setIsCloseHovered(false)}
          className={`absolute top-4 right-4 z-20 w-7 h-7 rounded-lg flex items-center justify-center transition-colors cursor-pointer focus:outline-none ${
            isCloseHovered
              ? 'bg-rose-500 text-white'
              : 'text-zinc-400 hover:text-zinc-600 bg-zinc-100/60'
          }`}
          title="Cancel restart (Esc)"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Content Container */}
        <div className="p-7 flex flex-col items-center text-center relative z-10 gap-5">
          {/* Animated Countdown Ring with Centered Emerald Icon */}
          <div className="relative w-20 h-20 flex items-center justify-center shrink-0">
            {/* Background Track Ring */}
            <svg className="w-full h-full -rotate-90">
              <circle
                cx="40"
                cy="40"
                r={radius}
                className="stroke-zinc-100"
                strokeWidth="4"
                fill="transparent"
              />
              {/* Animated Progress Ring */}
              <circle
                cx="40"
                cy="40"
                r={radius}
                className="stroke-emerald-500 transition-all duration-75 ease-linear"
                strokeWidth="4"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                fill="transparent"
              />
            </svg>

            {/* Center Visual: Rotating Reload Icon matching user specification */}
            <div className="absolute inset-0 flex items-center justify-center flex-col">
              <div className="w-13 h-13 rounded-full bg-emerald-50 border border-emerald-500/30 flex items-center justify-center shadow-2xs">
                <RefreshCw 
                  className={`w-6 h-6 text-emerald-600 transition-all ${isFinalizing ? 'animate-spin' : ''}`}
                  style={{ animationDuration: '2s' }}
                />
              </div>
            </div>
          </div>

          {/* Titles */}
          <div className="flex flex-col gap-1.5">
            <h2 className="text-lg font-bold text-zinc-900 tracking-tight">
              Please wait, apps and services restarting...
            </h2>
            <p className="text-xs text-zinc-500 leading-relaxed max-w-sm">
              Preparing system handoff to <span className="font-semibold text-emerald-700 font-mono bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200/80">{targetVersion}</span>. This brief preparation prevents socket locks and ensures a clean restart.
            </p>
          </div>

          {/* Calibrated Service Telemetry Milestones Card (Light Theme) */}
          <div className="w-full bg-zinc-50 border border-zinc-200/80 rounded-2xl p-4 flex flex-col gap-2.5 text-left shadow-2xs">
            {/* Step 1 */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2.5 text-zinc-700">
                <Server className="w-3.5 h-3.5 text-zinc-400" />
                <span className="font-medium">Pausing active downloads & queue state</span>
              </div>
              {step1Done ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 text-emerald-600 animate-spin shrink-0" />
              )}
            </div>

            {/* Step 2 */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2.5 text-zinc-700">
                <Database className="w-3.5 h-3.5 text-zinc-400" />
                <span className="font-medium">Flushing SQLite database & WAL transactions</span>
              </div>
              {step2Done ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : step1Done ? (
                <RefreshCw className="w-3.5 h-3.5 text-emerald-600 animate-spin shrink-0" />
              ) : (
                <div className="w-2 h-2 rounded-full bg-zinc-300 mx-1 shrink-0" />
              )}
            </div>

            {/* Step 3 */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2.5 text-zinc-700">
                <Cpu className="w-3.5 h-3.5 text-zinc-400" />
                <span className="font-medium">Releasing single-instance socket & IPC handles</span>
              </div>
              {step3Done ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : step2Done ? (
                <RefreshCw className="w-3.5 h-3.5 text-emerald-600 animate-spin shrink-0" />
              ) : (
                <div className="w-2 h-2 rounded-full bg-zinc-300 mx-1 shrink-0" />
              )}
            </div>

            {/* Step 4 */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2.5 text-zinc-700">
                <ShieldCheck className="w-3.5 h-3.5 text-zinc-400" />
                <span className="font-medium">Launching updated Downex engine...</span>
              </div>
              {isFinalizing ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : step4Active ? (
                <RefreshCw className="w-3.5 h-3.5 text-emerald-600 animate-spin shrink-0" />
              ) : (
                <div className="w-2 h-2 rounded-full bg-zinc-300 mx-1 shrink-0" />
              )}
            </div>
          </div>

          {/* Smooth Linear Progress Bar (Light Theme) */}
          <div className="w-full flex flex-col gap-1.5">
            <div className="w-full h-2 rounded-full bg-zinc-100 border border-zinc-200/60 overflow-hidden p-0.5">
              <div
                className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all duration-75 ease-linear shadow-[0_0_8px_rgba(16,185,129,0.35)]"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono px-0.5">
              <span className="text-zinc-500 font-medium">Restarting services</span>
              <span className="text-zinc-700 font-semibold">{progressPercent}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RestartingModal;
