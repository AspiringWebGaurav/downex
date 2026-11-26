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

  const [metrics, setMetrics] = useState<SpeedtestMetrics>(() => ({
    phase: 'idle',
    ping: null,
    jitter: null,
    currentSpeedMbps: 0,
    downloadMbps: null,
    uploadMbps: null,
    progressPercent: 0,
    serverLocation: 'Cloudflare Edge CDN',
  }));

  const [activeResultTab, setActiveResultTab] = useState<'download' | 'upload'>('download');
  const runnerRef = useRef<SpeedtestRunner | null>(null);

  const handleReset = () => {
    if (runnerRef.current) {
      runnerRef.current.abort();
    }
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

  const isTesting = metrics.phase === 'ping' || metrics.phase === 'download' || metrics.phase === 'upload';
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const runner = new SpeedtestRunner();
    runnerRef.current = runner;
    return () => {
      mountedRef.current = false;
      runner.abort();
    };
  }, []);

  const handleStart = () => {
    if (!runnerRef.current) return;
    runnerRef.current.start((updated) => {
      if (mountedRef.current) {
        setMetrics({ ...updated });
      }
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

  // Keyboard shortcut: Spacebar starts/stops test (ref-safe, always invokes latest state)
  const spaceActionRef = useRef({ isTesting, handleStart, handleStop });
  spaceActionRef.current = { isTesting, handleStart, handleStop };
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName;
      if (
        e.code === 'Space' &&
        activeTag !== 'INPUT' &&
        activeTag !== 'TEXTAREA' &&
        activeTag !== 'BUTTON' &&
        activeTag !== 'SELECT' &&
        activeTag !== 'A'
      ) {
        e.preventDefault();
        if (spaceActionRef.current.isTesting) {
          spaceActionRef.current.handleStop();
        } else {
          spaceActionRef.current.handleStart();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Dynamic Scale Range: 50 -> 100 -> 250 -> 500 -> 1000 Mbps
  const isCompleted = metrics.phase === 'completed';
  const displaySpeed = isCompleted
    ? (activeResultTab === 'upload' ? (metrics.uploadMbps || 0) : (metrics.downloadMbps || 0))
    : (metrics.currentSpeedMbps || 0);

  const isUploadActive = metrics.phase === 'upload' || (isCompleted && activeResultTab === 'upload');

  const maxScale = displaySpeed > 500 ? 1000 : displaySpeed > 250 ? 500 : displaySpeed > 100 ? 250 : 100;
  const normalizedSpeed = Math.min(Math.max(displaySpeed / maxScale, 0), 1);

  // High-Precision SVG Gauge Math
  const cx = 160;
  const cy = 120;
  const radius = 100;
  const strokeWidth = 9;
  const totalArcLength = 2 * Math.PI * radius * (240 / 360);
  const activeOffset = totalArcLength * (1 - normalizedSpeed);

  // Position of glowing perimeter indicator head
  const headAngleDeg = 150 + normalizedSpeed * 240;
  const headAngleRad = (headAngleDeg * Math.PI) / 180;
  const headX = cx + radius * Math.cos(headAngleRad);
  const headY = cy + radius * Math.sin(headAngleRad);

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 select-none p-4 sm:p-5 justify-between">
      {/* 1. Header Bar */}
      <div className="flex items-center justify-between shrink-0 border-b border-zinc-200 dark:border-zinc-800 pb-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-3">
          <button
            type="button"
            onClick={() => {
              if (onBack) onBack();
              else setSelectedView('all');
            }}
            className="w-7 h-7 inline-flex items-center justify-center border border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-100 hover:border-zinc-400 dark:hover:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 transition-colors cursor-pointer shrink-0"
            title="Return to Downloads"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <div className="w-7 h-7 inline-flex items-center justify-center border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
            <Gauge className="w-3.5 h-3.5 stroke-[2.2]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-nowrap">
              <h1 className="font-mono-tabular text-[12.5px] font-bold uppercase tracking-wider text-zinc-900 dark:text-zinc-100 whitespace-nowrap leading-none shrink-0">
                Live Speed Test
              </h1>
              <span className="border border-emerald-500/40 bg-emerald-500/[0.04] text-emerald-600 dark:text-emerald-400 px-1.5 h-[18px] inline-flex items-center text-[9px] font-mono-tabular font-semibold uppercase tracking-wider whitespace-nowrap shrink-0 leading-none">
                REAL EDGE CDN
              </span>
            </div>
            <p className="font-mono-tabular text-[10px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wider truncate whitespace-nowrap mt-1 leading-none">
              Instant multi-stream bandwidth &amp; latency measurement
            </p>
          </div>
        </div>

        {/* Phase Pill / Status Badge & Reset Control */}
        <div className="flex items-center gap-2">
          {(isCompleted || metrics.downloadMbps !== null) && (
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[10.5px] font-mono-tabular font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100 border border-zinc-300 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors cursor-pointer"
              title="Reset speed test and clear results"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          )}
          {metrics.phase === 'ping' ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono-tabular font-semibold uppercase tracking-wider border border-blue-500/40 text-blue-600 dark:text-blue-400 bg-blue-500/[0.06] animate-pulse">
              <span className="w-1.5 h-1.5 bg-blue-500 animate-ping" />
              Probing Latency...
            </span>
          ) : metrics.phase === 'download' ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono-tabular font-semibold uppercase tracking-wider border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/[0.06]">
              <ArrowDown className="w-3 h-3 animate-bounce" />
              Testing Download...
            </span>
          ) : metrics.phase === 'upload' ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono-tabular font-semibold uppercase tracking-wider border border-violet-500/40 text-violet-600 dark:text-violet-400 bg-violet-500/[0.06]">
              <ArrowUp className="w-3 h-3 animate-bounce" />
              Testing Upload...
            </span>
          ) : metrics.phase === 'completed' ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono-tabular font-semibold uppercase tracking-wider border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/[0.06]">
              <Sparkles className="w-3 h-3 text-emerald-500" />
              Test Complete
            </span>
          ) : metrics.phase === 'error' ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono-tabular font-semibold uppercase tracking-wider border border-rose-500/40 text-rose-600 dark:text-rose-400 bg-rose-500/[0.06]">
              <AlertCircle className="w-3 h-3" />
              {metrics.errorMessage || 'Test Interrupted'}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono-tabular font-semibold uppercase tracking-wider border border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400">
              <span className="w-1.5 h-1.5 bg-emerald-500" />
              Ready
            </span>
          )}
        </div>
      </div>

      {/* 2. Central Speedometer Gauge Zone (~210px, clean unobstructed geometry) */}
      <div className="relative flex flex-col items-center justify-center my-auto py-2">
        {/* Systematic Mode Switcher / State Bar */}
        <div className="h-8 flex items-center justify-center mb-1 shrink-0">
          {isCompleted ? (
            <div className="flex items-center border border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50 p-0.5">
              <button
                type="button"
                onClick={() => setActiveResultTab('download')}
                className={`flex items-center gap-1.5 px-3 py-1 font-mono-tabular text-[10.5px] uppercase tracking-wider transition-colors cursor-pointer ${
                  activeResultTab === 'download'
                    ? 'bg-black text-white dark:bg-white dark:text-zinc-950 font-bold'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 font-semibold'
                }`}
                title="Display Download Speed on Gauge"
              >
                <ArrowDown className="w-3 h-3" />
                <span>Download</span>
                {metrics.downloadMbps !== null && (
                  <span className={`text-[10px] font-mono-tabular ml-0.5 ${
                    activeResultTab === 'download' ? 'text-zinc-200 dark:text-zinc-800' : 'text-zinc-400 dark:text-zinc-500'
                  }`}>
                    {metrics.downloadMbps.toFixed(1)}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setActiveResultTab('upload')}
                className={`flex items-center gap-1.5 px-3 py-1 font-mono-tabular text-[10.5px] uppercase tracking-wider transition-colors cursor-pointer ${
                  activeResultTab === 'upload'
                    ? 'bg-black text-white dark:bg-white dark:text-zinc-950 font-bold'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 font-semibold'
                }`}
                title="Display Upload Speed on Gauge"
              >
                <ArrowUp className="w-3 h-3" />
                <span>Upload</span>
                {metrics.uploadMbps !== null && (
                  <span className={`text-[10px] font-mono-tabular ml-0.5 ${
                    activeResultTab === 'upload' ? 'text-zinc-200 dark:text-zinc-800' : 'text-zinc-400 dark:text-zinc-500'
                  }`}>
                    {metrics.uploadMbps.toFixed(1)}
                  </span>
                )}
              </button>
            </div>
          ) : isTesting ? (
            <span className={`flex items-center gap-2 px-3 py-1 text-[10.5px] font-mono-tabular uppercase tracking-wider font-semibold border ${
              metrics.phase === 'upload'
                ? 'bg-violet-500/[0.06] text-violet-600 dark:text-violet-400 border-violet-500/40'
                : metrics.phase === 'download'
                ? 'bg-emerald-500/[0.06] text-emerald-600 dark:text-emerald-400 border-emerald-500/40'
                : 'bg-blue-500/[0.06] text-blue-600 dark:text-blue-400 border-blue-500/40'
            }`}>
              {metrics.phase === 'upload' ? (
                <>
                  <ArrowUp className="w-3 h-3 animate-bounce" />
                  Testing Multi-Stream Upload Throughput
                </>
              ) : metrics.phase === 'download' ? (
                <>
                  <ArrowDown className="w-3 h-3 animate-bounce" />
                  Testing Multi-Stream Download Throughput
                </>
              ) : (
                <>
                  <span className="w-1.5 h-1.5 bg-blue-500 animate-ping" />
                  Measuring Edge Latency & Jitter
                </>
              )}
            </span>
          ) : (
            <span className="text-[10.5px] font-mono-tabular uppercase tracking-wider text-zinc-400 dark:text-zinc-500 flex items-center gap-1.5">
              <Wifi className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>{metrics.serverLocation || 'Cloudflare Edge CDN'} • Ready</span>
            </span>
          )}
        </div>

        <div className="relative w-72 h-52 flex items-center justify-center">
          {/* Ambient Glow */}
          <div 
            className="absolute inset-2 rounded-full blur-2xl opacity-10 pointer-events-none transition-colors duration-700"
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

            {/* Perimeter Glowing Indicator Pearl */}
            {normalizedSpeed > 0.01 && (
              <g className="transition-all duration-100 ease-out">
                <circle
                  cx={headX}
                  cy={headY}
                  r="6"
                  className="fill-white dark:fill-zinc-950"
                  stroke={isUploadActive ? '#8b5cf6' : '#10b981'}
                  strokeWidth="2.5"
                  filter="url(#glowFilter)"
                />
                <circle
                  cx={headX}
                  cy={headY}
                  r="3"
                  fill={isUploadActive ? '#8b5cf6' : '#10b981'}
                />
              </g>
            )}
          </svg>

          {/* Central Digital Readout / Industrial Control Dial */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none pt-2">
            {metrics.phase === 'idle' && !metrics.downloadMbps ? (
              <button
                type="button"
                aria-label="START"
                onClick={handleStart}
                className="pointer-events-auto w-24 h-24 rounded-full border-2 border-zinc-300 dark:border-zinc-700 bg-zinc-50/90 dark:bg-zinc-900/90 hover:border-black dark:hover:border-white hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-900 dark:text-zinc-100 transition-all cursor-pointer flex flex-col items-center justify-center group active:scale-95 shadow-sm"
              >
                <Play className="w-5 h-5 fill-zinc-900 dark:fill-zinc-100 group-hover:scale-110 transition-transform ml-0.5" />
                <span className="font-mono-tabular text-[11px] font-bold tracking-widest uppercase mt-1">START</span>
                <span aria-hidden="true" className="font-mono-tabular text-[8.5px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">MULTI-STREAM</span>
              </button>
            ) : isCompleted ? (
              <div className="flex flex-col items-center justify-center">
                <div className="flex items-center justify-center">
                  <span className={`text-4xl sm:text-[46px] leading-none font-bold font-mono-tabular tracking-tight transition-colors duration-200 ${
                    activeResultTab === 'upload' ? 'text-violet-600 dark:text-violet-400' : 'text-emerald-600 dark:text-emerald-400'
                  }`}>
                    {displaySpeed.toFixed(1)}
                  </span>
                </div>

                <span className="text-[10px] font-mono-tabular font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500 mt-1">
                  Mbps
                </span>

                <span className={`text-[9.5px] font-mono-tabular font-semibold uppercase tracking-wider border px-2 py-0.5 mt-1.5 ${
                  activeResultTab === 'upload'
                    ? 'border-violet-500/40 text-violet-600 dark:text-violet-400 bg-violet-500/[0.05]'
                    : 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/[0.05]'
                }`}>
                  {activeResultTab === 'upload' ? 'Upload Speed' : 'Download Speed'}
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center">
                <div className="flex items-center justify-center">
                  <span className={`text-4xl sm:text-[46px] leading-none font-bold font-mono-tabular tracking-tight transition-colors duration-200 ${
                    metrics.phase === 'upload' ? 'text-violet-600 dark:text-violet-400' : 'text-emerald-600 dark:text-emerald-400'
                  }`}>
                    {displaySpeed.toFixed(1)}
                  </span>
                </div>
                <span className="text-[10px] font-mono-tabular font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500 mt-1">
                  Mbps
                </span>
                <span className={`text-[9.5px] font-mono-tabular font-semibold uppercase tracking-wider border px-2 py-0.5 mt-1.5 ${
                  metrics.phase === 'upload'
                    ? 'border-violet-500/40 text-violet-600 dark:text-violet-400 bg-violet-500/[0.05]'
                    : 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/[0.05]'
                }`}>
                  {metrics.phase === 'upload' ? 'Upload Stream' : metrics.phase === 'download' ? 'Download Stream' : 'Probing Latency'}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Dynamic Scale Markers */}
        <div className="flex items-center justify-between w-64 text-[9px] font-mono-tabular uppercase tracking-wider text-zinc-400 dark:text-zinc-500 px-2 -mt-1">
          <span>0</span>
          <span>{(maxScale * 0.25).toFixed(0)}</span>
          <span>{(maxScale * 0.5).toFixed(0)}</span>
          <span>{(maxScale * 0.75).toFixed(0)}</span>
          <span>{maxScale} Mbps</span>
        </div>
      </div>

      {/* 3. Four Core Metric Tiles Grid (~90px, 1:1 New Download Modal Industrial Aesthetic) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 shrink-0">
        {/* Metric 1: Ping */}
        <div className="p-2.5 border border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400 dark:text-zinc-500 text-[10px] font-mono-tabular uppercase tracking-wider font-semibold">
            <span className="flex items-center gap-1.5">
              <Wifi className="w-3.5 h-3.5 text-blue-500" />
              Ping
            </span>
            <span className="text-[8.5px] font-mono-tabular uppercase text-zinc-400">LATENCY</span>
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-2xl font-bold font-mono-tabular text-zinc-900 dark:text-zinc-100">
              {metrics.ping !== null ? metrics.ping : '--'}
            </span>
            <span className="text-[10px] font-mono-tabular uppercase text-zinc-400">ms</span>
          </div>
        </div>

        {/* Metric 2: Jitter */}
        <div className="p-2.5 border border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400 dark:text-zinc-500 text-[10px] font-mono-tabular uppercase tracking-wider font-semibold">
            <span className="flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-amber-500" />
              Jitter
            </span>
            <span className="text-[8.5px] font-mono-tabular uppercase text-zinc-400">STABILITY</span>
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-2xl font-bold font-mono-tabular text-zinc-900 dark:text-zinc-100">
              {metrics.jitter !== null ? metrics.jitter : '--'}
            </span>
            <span className="text-[10px] font-mono-tabular uppercase text-zinc-400">ms</span>
          </div>
        </div>

        {/* Metric 3: Download */}
        <div 
          onClick={() => isCompleted && setActiveResultTab('download')}
          title={isCompleted ? "Click to display Download Speed on gauge" : undefined}
          className={`p-2.5 border flex flex-col justify-between transition-colors ${
            isCompleted ? 'cursor-pointer hover:border-emerald-500/60' : ''
          } ${
            metrics.phase === 'download' || (isCompleted && activeResultTab === 'download')
              ? 'bg-emerald-500/[0.06] border-emerald-500/60 dark:border-emerald-400/60' 
              : 'border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50'
          }`}>
          <div className="flex items-center justify-between text-zinc-400 dark:text-zinc-500 text-[10px] font-mono-tabular uppercase tracking-wider font-semibold">
            <span className="flex items-center gap-1.5">
              <ArrowDown className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              Download
            </span>
            <span className="border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 px-1 py-0.2 text-[8px] font-mono-tabular uppercase font-semibold">
              MULTI-STREAM
            </span>
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-2xl font-bold font-mono-tabular text-emerald-600 dark:text-emerald-400">
              {metrics.downloadMbps !== null ? metrics.downloadMbps.toFixed(1) : (metrics.phase === 'download' ? metrics.currentSpeedMbps.toFixed(1) : '--')}
            </span>
            <span className="text-[10px] font-mono-tabular uppercase text-zinc-400">Mbps</span>
          </div>
        </div>

        {/* Metric 4: Upload */}
        <div 
          onClick={() => isCompleted && setActiveResultTab('upload')}
          title={isCompleted ? "Click to display Upload Speed on gauge" : undefined}
          className={`p-2.5 border flex flex-col justify-between transition-colors ${
            isCompleted ? 'cursor-pointer hover:border-violet-500/60' : ''
          } ${
            metrics.phase === 'upload' || (isCompleted && activeResultTab === 'upload')
              ? 'bg-violet-500/[0.06] border-violet-500/60 dark:border-violet-400/60' 
              : 'border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50'
          }`}>
          <div className="flex items-center justify-between text-zinc-400 dark:text-zinc-500 text-[10px] font-mono-tabular uppercase tracking-wider font-semibold">
            <span className="flex items-center gap-1.5">
              <ArrowUp className="w-3.5 h-3.5 text-violet-500" />
              Upload
            </span>
            <span className="border border-violet-500/40 text-violet-600 dark:text-violet-400 px-1 py-0.2 text-[8px] font-mono-tabular uppercase font-semibold">
              STREAM
            </span>
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-2xl font-bold font-mono-tabular text-violet-600 dark:text-violet-400">
              {metrics.uploadMbps !== null ? metrics.uploadMbps.toFixed(1) : (metrics.phase === 'upload' ? metrics.currentSpeedMbps.toFixed(1) : '--')}
            </span>
            <span className="text-[10px] font-mono-tabular uppercase text-zinc-400">Mbps</span>
          </div>
        </div>
      </div>

      {/* 4. Bottom Centered & Symmetrical Control Bar */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center shrink-0 pt-3 border-t border-zinc-200 dark:border-zinc-800 min-h-12 w-full gap-3">
        {/* Left Side: Reset Control (Symmetrically balances against right keyboard hint) */}
        <div className="flex items-center justify-start min-w-0">
          {(isCompleted || metrics.downloadMbps !== null) && !isTesting && (
            <button
              type="button"
              onClick={handleReset}
              className="h-8 px-3.5 font-mono-tabular text-[10.5px] font-semibold uppercase tracking-wider border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer flex items-center gap-1.5 shrink-0"
              title="Reset speed test and clear results"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          )}
        </div>

        {/* Center: Main Primary Action Button (Dead-Center Symmetrical Axis) */}
        <div className="flex items-center justify-center shrink-0">
          {isTesting ? (
            <button
              type="button"
              onClick={handleStop}
              className="h-8 px-6 font-mono-tabular text-[11px] font-bold uppercase tracking-wider bg-red-600 hover:bg-red-700 text-white transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs shrink-0"
            >
              <Square className="w-3 h-3 fill-white" />
              <span>Stop Test</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStart}
              className="h-8 px-6 font-mono-tabular text-[11px] font-bold uppercase tracking-wider bg-zinc-800 hover:bg-black dark:bg-zinc-200 dark:hover:bg-white text-white dark:text-zinc-950 transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs shrink-0"
            >
              {isCompleted ? (
                <>
                  <RotateCcw className="w-3 h-3" />
                  <span>Test Again</span>
                </>
              ) : (
                <>
                  <Play className="w-3 h-3 fill-current" />
                  <span>Start Speed Test</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Right Side: Keyboard Shortcut Hint (Isolated Right Track) */}
        <div className="flex items-center justify-end min-w-0">
          <div className="hidden sm:flex items-center gap-1.5 text-[10px] font-mono-tabular text-zinc-400 dark:text-zinc-500 uppercase tracking-wider shrink-0">
            <span className="px-1.5 py-0.5 border border-zinc-200 dark:border-zinc-800 bg-zinc-100/70 dark:bg-zinc-900/70 text-zinc-600 dark:text-zinc-400 font-semibold text-[9px]">
              SPACE
            </span>
            <span>{isTesting ? 'TO STOP' : 'TO START'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
