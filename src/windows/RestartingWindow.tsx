import React, { useEffect, useState } from 'react';
import { RefreshCw, CheckCircle2, ShieldCheck, Database, Server, Cpu } from 'lucide-react';
import { 
  getRestartingPayload, 
  onOpenRestartingModal, 
  applyInProcessUpdate
} from '../services/tauriService';

const COUNTDOWN_TOTAL_MS = 7000;

export const RestartingWindow: React.FC = () => {
  const [targetVersion, setTargetVersion] = useState<string>(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const t = urlParams.get('target');
      if (t) return t.startsWith('v') ? t : `v${t}`;
    } catch {}
    return 'Latest';
  });

  const [stagingPath, setStagingPath] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Force Light Theme strictly on document and body
  useEffect(() => {
    document.documentElement.classList.remove('dark');
    document.body.classList.remove('dark');
  }, []);

  // Retrieve payload on boot
  useEffect(() => {
    getRestartingPayload().then((payload: any) => {
      if (payload) {
        if (payload.target_version) {
          const v = payload.target_version;
          setTargetVersion(v.startsWith('v') ? v : `v${v}`);
        }
        if (payload.staging_path) {
          setStagingPath(payload.staging_path);
        }
      }
    });

    const unlisten = onOpenRestartingModal((payload: any) => {
      if (payload) {
        if (payload.target_version) {
          const v = payload.target_version;
          setTargetVersion(v.startsWith('v') ? v : `v${v}`);
        }
        if (payload.staging_path) {
          setStagingPath(payload.staging_path);
        }
      }
    });

    // Fallback if not passed: check localStorage
    try {
      const raw = localStorage.getItem('downex_persisted_update');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.stagedPath) setStagingPath(parsed.stagedPath);
        if (parsed?.targetVersion) {
          const v = parsed.targetVersion;
          setTargetVersion(v.startsWith('v') ? v : `v${v}`);
        }
      }
    } catch {}

    try {
      const recent = localStorage.getItem('downex_recently_updated');
      if (recent) {
        const parsed = JSON.parse(recent);
        if (parsed?.targetVersion) {
          const v = parsed.targetVersion;
          setTargetVersion(v.startsWith('v') ? v : `v${v}`);
        }
      }
    } catch {}

    return () => {
      unlisten();
    };
  }, []);

  // 7.0-second countdown timer
  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const now = Date.now();
      const diff = Math.min(COUNTDOWN_TOTAL_MS, now - startTime);
      setElapsed(diff);
      if (diff >= COUNTDOWN_TOTAL_MS) {
        clearInterval(interval);
        // Handoff to apply update
        const cleanVer = targetVersion.replace(/^v/, '');
        applyInProcessUpdate({
          stagingPath: stagingPath || undefined,
          targetVersion: cleanVer,
        }).catch((err) => {
          console.error('[RestartingWindow] applyInProcessUpdate error:', err);
        });
      }
    }, 40);

    return () => clearInterval(interval);
  }, [targetVersion, stagingPath]);

  const progressPercent = Math.min(100, Math.floor((elapsed / COUNTDOWN_TOTAL_MS) * 100));
  const isFinalizing = elapsed >= COUNTDOWN_TOTAL_MS - 500;

  // SVG Circular Ring Math
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progressPercent / 100) * circumference;

  // Calibrated step milestone states across 7000ms
  const step1Done = elapsed >= 1600;
  const step2Done = elapsed >= 3400;
  const step3Done = elapsed >= 5200;
  const step4Active = elapsed >= 5200;

  return (
    <div 
      data-tauri-drag-region
      className="w-screen h-screen flex flex-col items-center justify-between p-6 bg-white text-zinc-900 font-sans select-none overflow-hidden relative border border-zinc-200/90 shadow-2xl"
    >
      {/* Subtle Ambient Emerald Radial Glow */}
      <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Main Content Area */}
      <div data-tauri-drag-region className="w-full flex-1 flex flex-col items-center justify-between z-10 gap-3">
        {/* Animated Countdown Ring with Centered Emerald Icon */}
        <div data-tauri-drag-region className="relative w-20 h-20 flex items-center justify-center shrink-0 mt-1">
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

        {/* Titles Header */}
        <div data-tauri-drag-region className="flex flex-col gap-1 text-center px-2">
          <h2 data-tauri-drag-region className="text-base font-bold text-zinc-900 tracking-tight">
            Please wait, apps and services restarting...
          </h2>
          <p data-tauri-drag-region className="text-xs text-zinc-500 leading-relaxed max-w-sm">
            Preparing system handoff to <span className="font-semibold text-emerald-700 font-mono bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200/80">{targetVersion}</span>. This brief preparation prevents socket locks and ensures a clean restart.
          </p>
        </div>

        {/* Calibrated Service Telemetry Milestones Card (Light Theme) */}
        <div className="w-full bg-zinc-50 border border-zinc-200/80 rounded-2xl p-3.5 flex flex-col gap-2.5 text-left shadow-2xs">
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
        <div className="w-full flex flex-col gap-1.5 mt-1">
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
  );
};

export default RestartingWindow;
