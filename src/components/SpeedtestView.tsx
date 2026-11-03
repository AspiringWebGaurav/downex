import React, { useState, useEffect, useRef } from 'react';
import { 
  Gauge, 
  ArrowLeft, 
  Play, 
  Square, 
  RotateCcw, 
  Wifi, 
  Activity, 
  ArrowDown, 
  ArrowUp, 
  Sparkles,
  AlertCircle
} from 'lucide-react';
import { SpeedtestRunner, SpeedtestMetrics } from '../services/speedtestService';
import { useDownloadStore } from '../stores/downloadStore';

interface SpeedtestViewProps {
  onBack?: () => void;
}

export const SpeedtestView: React.FC<SpeedtestViewProps> = ({ onBack }) => {
  const setSelectedView = useDownloadStore((state) => state.setSelectedView);

  const [metrics, setMetrics] = useState<SpeedtestMetrics>(() => {
    let savedLast: any = null;
    try {
      const raw = localStorage.getItem('downex_last_speedtest');
      if (raw) savedLast = JSON.parse(raw);
    } catch {}

    return {
      phase: savedLast ? 'completed' : 'idle',
      ping: savedLast?.ping ?? null,
      jitter: savedLast?.jitter ?? null,
      currentSpeedMbps: savedLast?.download ?? 0,
      downloadMbps: savedLast?.download ?? null,
      uploadMbps: savedLast?.upload ?? null,
      progressPercent: savedLast ? 100 : 0,
      serverLocation: savedLast?.server ?? 'Cloudflare Edge CDN',
    };
  });

  const [activeResultTab, setActiveResultTab] = useState<'download' | 'upload'>('download');
  const runnerRef = useRef<SpeedtestRunner | null>(null);

  const handleReset = () => {
    if (runnerRef.current) {
      runnerRef.current.abort();
    }
    try {
      localStorage.removeItem('downex_last_speedtest');
    } catch {}
    setMetrics({
      phase: 'idle',
      ping: null,
      jitter: null,
      currentSpeedMbps: 0,
      downloadMbps: null,
      uploadMbps: null,
      progressPercent: 0,
      serverLocation: 'Cloudflare Edge CDN',
    });
    setActiveResultTab('download');
  };

  useEffect(() => {
    const runner = new SpeedtestRunner();
    runnerRef.current = runner;
    return () => {
      runner.abort();
    };
  }, []);

  const isTesting = metrics.phase === 'ping' || metrics.phase === 'download' || metrics.phase === 'upload';

  const handleStart = () => {
    if (!runnerRef.current) return;
    runnerRef.current.start((updated) => {
      setMetrics({ ...updated });
    });
  };

  const handleStop = () => {
    if (runnerRef.current) {
      runnerRef.current.abort();
      setMetrics((prev) => ({
        ...prev,
        phase: 'idle',
        currentSpeedMbps: 0,
      }));
    }
  };

  // Keyboard shortcut: Spacebar starts/stops test
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        if (isTesting) {
          handleStop();
        } else {
          handleStart();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isTesting]);

  // Dynamic Scale Range: 50 -> 100 -> 250 -> 500 -> 1000 Mbps
  const isCompleted = metrics.phase === 'completed';
  const displaySpeed = isCompleted
    ? (activeResultTab === 'upload' ? (metrics.uploadMbps || 0) : (metrics.downloadMbps || 0))
    : (metrics.currentSpeedMbps || 0);

  const isUploadActive = metrics.phase === 'upload' || (isCompleted && activeResultTab === 'upload');

  const maxScale = displaySpeed > 500 ? 1000 : displaySpeed > 250 ? 500 : displaySpeed > 100 ? 250 : 100;
  const normalizedSpeed = Math.min(Math.max(displaySpeed / maxScale, 0), 1);

  // High-Precision SVG Gauge Math
  // Center: (160, 125), Radius: 95, Sweep: 240 degrees (from 150° to 390°)
  const cx = 160;
  const cy = 125;
  const radius = 95;
  const strokeWidth = 9;
  const totalArcLength = 2 * Math.PI * radius * (240 / 360);
  const activeOffset = totalArcLength * (1 - normalizedSpeed);

  // Position of glowing perimeter indicator head
  const headAngleDeg = 150 + normalizedSpeed * 240;
  const headAngleRad = (headAngleDeg * Math.PI) / 180;
  const headX = cx + radius * Math.cos(headAngleRad);
  const headY = cy + radius * Math.sin(headAngleRad);

  // Quality Tier Verdict
  const getVerdict = () => {
    const dl = metrics.downloadMbps ?? 0;
    const ping = metrics.ping ?? 999;
    if (dl >= 250 && ping < 35) return { label: 'Ultra-Gigabit / Pro Gaming & 8K Ready', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30' };
    if (dl >= 100 && ping < 50) return { label: 'High Speed / 4K Streaming & Low Latency', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30' };
    if (dl >= 40) return { label: 'Fast Broadband / Multi-Device Streaming', color: 'text-blue-500 bg-blue-500/10 border-blue-500/30' };
    if (dl >= 15) return { label: 'Standard Connection / HD Streaming', color: 'text-amber-500 bg-amber-500/10 border-amber-500/30' };
    if (dl > 0) return { label: 'Basic Connection / Browsing Ready', color: 'text-zinc-500 bg-zinc-500/10 border-zinc-500/30' };
    return { label: 'Ready for Speed Diagnostic', color: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20' };
  };

  const verdict = getVerdict();

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 select-none p-4 sm:p-5 justify-between">
      {/* 1. Header Bar (~38px) */}
      <div className="flex items-center justify-between shrink-0 border-b border-zinc-200/80 dark:border-zinc-800/80 pb-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (onBack) onBack();
              else setSelectedView('all');
            }}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors cursor-pointer"
            title="Return to Downloads"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <Gauge className="w-5 h-5 text-emerald-500 stroke-[2.2]" />
            <div>
              <h1 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                Live Speed Test
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/30">
                  REAL EDGE CDN
                </span>
              </h1>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
                Instant multi-stream bandwidth & latency measurement
              </p>
            </div>
          </div>
        </div>

        {/* Phase Pill / Status Badge & Reset Control */}
        <div className="flex items-center gap-2">
          {(isCompleted || metrics.downloadMbps !== null) && (
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200/80 dark:border-zinc-700/80 transition-colors cursor-pointer"
              title="Reset speed test and clear results"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          )}
          {metrics.phase === 'ping' ? (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-mono font-semibold border border-blue-500/20 animate-pulse">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
              Probing Latency...
            </span>
          ) : metrics.phase === 'download' ? (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-mono font-semibold border border-emerald-500/20">
              <ArrowDown className="w-3.5 h-3.5 animate-bounce" />
              Testing Download...
            </span>
          ) : metrics.phase === 'upload' ? (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 text-xs font-mono font-semibold border border-violet-500/20">
              <ArrowUp className="w-3.5 h-3.5 animate-bounce" />
              Testing Upload...
            </span>
          ) : metrics.phase === 'completed' ? (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-mono font-semibold border border-emerald-500/20">
              <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
              Test Complete
            </span>
          ) : metrics.phase === 'error' ? (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-mono font-semibold border border-rose-500/20">
              <AlertCircle className="w-3.5 h-3.5" />
              {metrics.errorMessage || 'Test Interrupted'}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 text-xs font-mono font-semibold border border-zinc-200 dark:border-zinc-700">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Ready
            </span>
          )}
        </div>
      </div>

      {/* 2. Central Speedometer Gauge Zone (~210px, clean unobstructed geometry) */}
      <div className="relative flex flex-col items-center justify-center my-auto py-2">
        <div className="relative w-72 h-52 flex items-center justify-center">
          {/* Ambient Glow */}
          <div 
            className="absolute inset-2 rounded-full blur-2xl opacity-15 pointer-events-none transition-colors duration-700"
            style={{
              background: isUploadActive ? '#8b5cf6' : '#10b981',
            }}
          />

          {/* SVG Gauge */}
          <svg data-testid="speedometer-svg" className="w-full h-full" viewBox="0 0 320 230">
            <defs>
              <linearGradient id="downexSpeedGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="65%" stopColor="#059669" />
                <stop offset="100%" stopColor="#0284c7" />
              </linearGradient>

              <linearGradient id="downexUploadGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#8b5cf6" />
                <stop offset="100%" stopColor="#d946ef" />
              </linearGradient>

              <filter id="glowFilter" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor={isUploadActive ? '#8b5cf6' : '#10b981'} floodOpacity="0.6" />
              </filter>
            </defs>

            {/* Background Symmetrical Track (240° sweep) */}
            <circle
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke="currentColor"
              className="text-zinc-200/90 dark:text-zinc-800/90"
              strokeWidth={strokeWidth}
              strokeDasharray={`${totalArcLength} 999`}
              strokeDashoffset="0"
              strokeLinecap="round"
              transform={`rotate(150 ${cx} ${cy})`}
            />

            {/* Active Glowing Progress Track */}
            <circle
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={isUploadActive ? 'url(#downexUploadGrad)' : 'url(#downexSpeedGrad)'}
              strokeWidth={strokeWidth + 2}
              strokeDasharray={`${totalArcLength} 999`}
              strokeDashoffset={activeOffset}
              strokeLinecap="round"
              transform={`rotate(150 ${cx} ${cy})`}
              className="transition-all duration-100 ease-out"
              filter="url(#glowFilter)"
            />

            {/* Perimeter Glowing Indicator Pearl (Rides along the rim, NEVER intersecting digits) */}
            {normalizedSpeed > 0.01 && (
              <g className="transition-all duration-100 ease-out">
                <circle
                  cx={headX}
                  cy={headY}
                  r="7"
                  className="fill-white dark:fill-zinc-950"
                  stroke={isUploadActive ? '#8b5cf6' : '#10b981'}
                  strokeWidth="3"
                  filter="url(#glowFilter)"
                />
                <circle
                  cx={headX}
                  cy={headY}
                  r="3.5"
                  fill={isUploadActive ? '#8b5cf6' : '#10b981'}
                />
              </g>
            )}
          </svg>

          {/* Central Digital Readout (Dynamic Download / Upload & Clean Geometry) */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none pt-2">
            {metrics.phase === 'idle' && !metrics.downloadMbps ? (
              <button
                type="button"
                onClick={handleStart}
                className="pointer-events-auto w-24 h-24 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-black text-xl tracking-wider shadow-lg hover:shadow-emerald-500/30 hover:scale-105 active:scale-95 transition-all cursor-pointer flex flex-col items-center justify-center group"
              >
                <Play className="w-6 h-6 fill-white ml-1 group-hover:scale-110 transition-transform" />
                <span className="text-[11px] font-mono font-bold tracking-widest uppercase mt-0.5">START</span>
              </button>
            ) : isCompleted ? (
              <div className="flex flex-col items-center justify-center pointer-events-auto">
                {/* Segmented Switcher Tabs: Download & Upload */}
                <div className="flex items-center p-0.5 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200/80 dark:border-zinc-700/80 shadow-2xs mb-1">
                  <button
                    type="button"
                    onClick={() => setActiveResultTab('download')}
                    className={`flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                      activeResultTab === 'download'
                        ? 'bg-emerald-500 text-white shadow-xs'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                    }`}
                  >
                    <ArrowDown className="w-3 h-3" />
                    <span>Download</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveResultTab('upload')}
                    className={`flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                      activeResultTab === 'upload'
                        ? 'bg-violet-500 text-white shadow-xs'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                    }`}
                  >
                    <ArrowUp className="w-3 h-3" />
                    <span>Upload</span>
                  </button>
                </div>

                {/* Active Speed Digits */}
                <div className="flex items-baseline gap-1">
                  <span className={`text-4xl sm:text-5xl font-black font-mono tracking-tight drop-shadow-xs ${
                    activeResultTab === 'upload' ? 'text-violet-600 dark:text-violet-400' : 'text-emerald-600 dark:text-emerald-400'
                  }`}>
                    {displaySpeed.toFixed(1)}
                  </span>
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    Mbps
                  </span>
                </div>

                {/* Dynamic Dual Summary */}
                <div className="flex items-center gap-1.5 mt-0.5 text-[10.5px] font-mono">
                  <span className={`font-semibold uppercase tracking-wider ${
                    activeResultTab === 'upload' ? 'text-violet-600 dark:text-violet-400' : 'text-emerald-600 dark:text-emerald-400'
                  }`}>
                    {activeResultTab === 'upload' ? 'Upload Speed' : 'Download Speed'}
                  </span>
                  <span className="text-zinc-300 dark:text-zinc-700">•</span>
                  <span className="text-zinc-400 dark:text-zinc-500">
                    {activeResultTab === 'upload'
                      ? `↓ ${metrics.downloadMbps?.toFixed(1) ?? '--'} Mbps`
                      : `↑ ${metrics.uploadMbps?.toFixed(1) ?? '--'} Mbps`}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center">
                <span className="text-4xl sm:text-5xl font-black font-mono tracking-tight text-zinc-900 dark:text-zinc-50 drop-shadow-xs">
                  {displaySpeed.toFixed(1)}
                </span>
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mt-0.5">
                  Mbps
                </span>
                <span className={`text-[10px] font-mono font-semibold uppercase tracking-widest mt-1 ${
                  metrics.phase === 'upload' ? 'text-violet-600 dark:text-violet-400' : 'text-emerald-600 dark:text-emerald-400'
                }`}>
                  {metrics.phase === 'upload' ? 'Upload Test' : metrics.phase === 'download' ? 'Download Test' : 'Probing Latency'}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Dynamic Scale Markers */}
        <div className="flex items-center justify-between w-64 text-[9px] font-mono text-zinc-400 dark:text-zinc-500 px-2 -mt-1">
          <span>0</span>
          <span>{(maxScale * 0.25).toFixed(0)}</span>
          <span>{(maxScale * 0.5).toFixed(0)}</span>
          <span>{(maxScale * 0.75).toFixed(0)}</span>
          <span>{maxScale} Mbps</span>
        </div>
      </div>

      {/* 3. Four Core Metric Tiles Grid (~90px) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
        {/* Metric 1: Ping */}
        <div className="p-3 rounded-2xl bg-zinc-50/80 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/60 flex flex-col justify-between shadow-2xs">
          <div className="flex items-center justify-between text-zinc-400 dark:text-zinc-500 text-[10px] font-mono uppercase font-semibold">
            <span className="flex items-center gap-1.5">
              <Wifi className="w-3.5 h-3.5 text-blue-500" />
              Ping
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-black font-mono text-zinc-900 dark:text-zinc-100">
              {metrics.ping !== null ? metrics.ping : '--'}
            </span>
            <span className="text-[10px] font-mono text-zinc-400">ms</span>
          </div>
        </div>

        {/* Metric 2: Jitter */}
        <div className="p-3 rounded-2xl bg-zinc-50/80 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/60 flex flex-col justify-between shadow-2xs">
          <div className="flex items-center justify-between text-zinc-400 dark:text-zinc-500 text-[10px] font-mono uppercase font-semibold">
            <span className="flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-amber-500" />
              Jitter
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-black font-mono text-zinc-900 dark:text-zinc-100">
              {metrics.jitter !== null ? metrics.jitter : '--'}
            </span>
            <span className="text-[10px] font-mono text-zinc-400">ms</span>
          </div>
        </div>

        {/* Metric 3: Download */}
        <div 
          onClick={() => isCompleted && setActiveResultTab('download')}
          className={`p-3 rounded-2xl border flex flex-col justify-between shadow-2xs transition-all ${
            isCompleted ? 'cursor-pointer hover:border-emerald-500/50' : ''
          } ${
            metrics.phase === 'download' || (isCompleted && activeResultTab === 'download')
              ? 'bg-emerald-500/10 border-emerald-500/40 ring-1 ring-emerald-500/30' 
              : 'bg-zinc-50/80 dark:bg-zinc-900/60 border-zinc-200/80 dark:border-zinc-800/60'
          }`}>
          <div className="flex items-center justify-between text-zinc-400 dark:text-zinc-500 text-[10px] font-mono uppercase font-semibold">
            <span className="flex items-center gap-1.5">
              <ArrowDown className="w-3.5 h-3.5 text-emerald-500" />
              Download
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400">
              {metrics.downloadMbps !== null ? metrics.downloadMbps.toFixed(1) : (metrics.phase === 'download' ? metrics.currentSpeedMbps.toFixed(1) : '--')}
            </span>
            <span className="text-[10px] font-mono text-zinc-400">Mbps</span>
          </div>
        </div>

        {/* Metric 4: Upload */}
        <div 
          onClick={() => isCompleted && setActiveResultTab('upload')}
          className={`p-3 rounded-2xl border flex flex-col justify-between shadow-2xs transition-all ${
            isCompleted ? 'cursor-pointer hover:border-violet-500/50' : ''
          } ${
            metrics.phase === 'upload' || (isCompleted && activeResultTab === 'upload')
              ? 'bg-violet-500/10 border-violet-500/40 ring-1 ring-violet-500/30' 
              : 'bg-zinc-50/80 dark:bg-zinc-900/60 border-zinc-200/80 dark:border-zinc-800/60'
          }`}>
          <div className="flex items-center justify-between text-zinc-400 dark:text-zinc-500 text-[10px] font-mono uppercase font-semibold">
            <span className="flex items-center gap-1.5">
              <ArrowUp className="w-3.5 h-3.5 text-violet-500" />
              Upload
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-black font-mono text-violet-600 dark:text-violet-400">
              {metrics.uploadMbps !== null ? metrics.uploadMbps.toFixed(1) : (metrics.phase === 'upload' ? metrics.currentSpeedMbps.toFixed(1) : '--')}
            </span>
            <span className="text-[10px] font-mono text-zinc-400">Mbps</span>
          </div>
        </div>
      </div>

      {/* 4. Bottom Verdict & Control Bar (~42px) */}
      <div className="flex items-center justify-between shrink-0 pt-3 border-t border-zinc-200/80 dark:border-zinc-800/80 gap-3">
        {/* Quality Verdict Pill: only rendered when completed with verified metrics */}
        <div className="flex items-center gap-2">
          {isCompleted && metrics.downloadMbps !== null && (
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-semibold border ${verdict.color}`}>
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>{verdict.label}</span>
            </div>
          )}
        </div>

        {/* Action Controls: Reset & Start / Test Again */}
        <div className="flex items-center gap-2">
          {isTesting ? (
            <button
              type="button"
              onClick={handleStop}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-rose-500 text-white hover:bg-rose-600 active:scale-95 transition-all shadow-xs cursor-pointer"
            >
              <Square className="w-3.5 h-3.5 fill-white" />
              Stop
            </button>
          ) : (
            <>
              {(isCompleted || metrics.downloadMbps !== null) && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 active:scale-95 transition-all shadow-2xs cursor-pointer border border-zinc-200 dark:border-zinc-700"
                  title="Reset speed test and clear results"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleStart}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-semibold bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:opacity-90 active:scale-95 transition-all shadow-xs cursor-pointer"
              >
                {isCompleted ? (
                  <>
                    <RotateCcw className="w-3.5 h-3.5" />
                    Test Again
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Start Speed Test
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
