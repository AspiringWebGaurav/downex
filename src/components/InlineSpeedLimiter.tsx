import React, { useState, useEffect } from 'react';
import { Gauge, RotateCcw, Lock } from 'lucide-react';
import { DownloadItem } from '../types/download';
import { useDownloadStore } from '../stores/downloadStore';

interface InlineSpeedLimiterProps {
  item: DownloadItem;
}

// Starter Options: 20Mbps, 50Mbps, 100Mbps, 150Mbps, 200Mbps
const SPEED_PRESETS = [20, 50, 100, 150, 200];

// Dynamic MB conversion: 20 Mbps = 2.5 MB/s, 120 Mbps = 15 MB/s
export const formatMbpsToMbPerSec = (mbps: number): string => {
  if (mbps <= 0) return '0';
  const mb = mbps / 8;
  if (Number.isInteger(mb)) return String(mb);
  const fixed = mb.toFixed(2);
  return fixed.endsWith('0') ? mb.toFixed(1) : fixed;
};

export const InlineSpeedLimiter: React.FC<InlineSpeedLimiterProps> = ({ item }) => {
  const setSpeedLimit = useDownloadStore((state) => state.setSpeedLimit);

  // Controlled local input value
  const [inputValue, setInputValue] = useState<string>(
    item.speed_limit_mbps ? String(item.speed_limit_mbps) : ''
  );

  // Sync input value when external store limit changes
  useEffect(() => {
    setInputValue(item.speed_limit_mbps ? String(item.speed_limit_mbps) : '');
  }, [item.speed_limit_mbps]);

  const handleApplyLimit = (val: number | null) => {
    if (val === null || isNaN(val) || val <= 0) {
      setSpeedLimit(item.id, null);
      setInputValue('');
    } else {
      const rounded = Math.round(val);
      setSpeedLimit(item.id, rounded);
      setInputValue(String(rounded));
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (/^\d*$/.test(raw)) {
      setInputValue(raw);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const trimmed = inputValue.trim();
      if (trimmed) {
        const parsed = parseInt(trimmed, 10);
        if (parsed > 0) {
          handleApplyLimit(parsed);
        }
      }
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setInputValue(item.speed_limit_mbps ? String(item.speed_limit_mbps) : '');
      e.currentTarget.blur();
    }
  };

  const handleBlur = () => {
    const trimmed = inputValue.trim();
    if (trimmed) {
      const parsed = parseInt(trimmed, 10);
      if (parsed > 0) {
        handleApplyLimit(parsed);
      }
    } else {
      setInputValue(item.speed_limit_mbps ? String(item.speed_limit_mbps) : '');
    }
  };

  const isCapped = Boolean(item.speed_limit_mbps && item.speed_limit_mbps > 0);
  const isCustomLimitActive = isCapped && !SPEED_PRESETS.includes(item.speed_limit_mbps!);

  // Dynamic MB calculation for custom input (e.g. 120 Mbps = 15 MB/s)
  const parsedInput = parseInt(inputValue.trim(), 10);
  const liveCustomMb = !isNaN(parsedInput) && parsedInput > 0 ? formatMbpsToMbPerSec(parsedInput) : null;

  return (
    <div
      data-testid="inline-speed-limiter"
      className="flex items-center justify-between gap-1.5 px-2 py-0.5 my-0 h-[28px] bg-zinc-50/80 dark:bg-zinc-900/60 rounded-md border border-zinc-200/80 dark:border-zinc-800/80 text-[11px] select-none transition-colors"
    >
      {/* Left controls: Icon, Label, Starter Presets (20M, 50M, 100M, 150M, 200M), Custom Box */}
      <div className="flex items-center gap-1.5 min-w-0">
        <div className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400 shrink-0 font-medium text-[11px]">
          <Gauge className="w-3.5 h-3.5 text-emerald-500" />
          <span className="hidden sm:inline">Speed Limit:</span>
        </div>

        {/* Starter Presets: 20M, 50M, 100M, 150M, 200M (uniform h-[22px], rounded-md) */}
        <div className="flex items-center gap-1">
          {SPEED_PRESETS.map((preset) => {
            const isSelected = item.speed_limit_mbps === preset;
            const mbEquivalent = formatMbpsToMbPerSec(preset);
            return (
              <button
                key={preset}
                type="button"
                onClick={() => handleApplyLimit(preset)}
                data-testid={`speed-limiter-preset-${preset}`}
                title={`Limit to ${preset} Mbps (= ${mbEquivalent} MB/s)`}
                className={`h-[22px] px-1.5 text-[10px] font-mono font-medium rounded-md border transition-all cursor-pointer flex items-center justify-center ${
                  isSelected
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40 font-bold shadow-2xs'
                    : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/30 hover:border-emerald-500/30 text-zinc-700 dark:text-zinc-300 hover:text-emerald-600 dark:hover:text-emerald-400'
                }`}
              >
                {preset}M
              </button>
            );
          })}
        </div>

        {/* Custom Input with Dynamic MB (uniform h-[22px], rounded-md) */}
        <div
          className={`flex items-center h-[22px] rounded-md border px-1.5 py-0 shadow-2xs transition-all ${
            isCustomLimitActive
              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
              : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 focus-within:border-emerald-500/40 focus-within:ring-1 focus-within:ring-emerald-500/30'
          }`}
        >
          <input
            type="text"
            inputMode="numeric"
            value={inputValue}
            placeholder="Custom"
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            data-testid="speed-limiter-input"
            aria-label="Custom speed limit in Mbps"
            className={`w-11 text-center font-mono text-[10.5px] font-semibold bg-transparent outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500 ${
              isCustomLimitActive
                ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                : 'text-zinc-900 dark:text-zinc-100'
            }`}
          />
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono pr-0.5 select-none">
            Mbps
          </span>

          {/* Dynamic MB display right inside custom box (e.g. = 15 MB/s) */}
          {liveCustomMb && (
            <span
              data-testid="speed-limiter-dynamic-mb"
              className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono font-medium pl-1 border-l border-zinc-200 dark:border-zinc-700 select-none whitespace-nowrap"
              title={`${inputValue} Mbps = ${liveCustomMb} MB/s`}
            >
              ={liveCustomMb} MB/s
            </span>
          )}
        </div>
      </div>

      {/* Right side: Single Unified Cap Badge & Reset Control (symmetric, uniform h-[22px], rounded-md) */}
      <div className="shrink-0 flex items-center">
        {isCapped ? (
          <div className="flex items-center h-[22px] rounded-md border border-emerald-500/35 bg-emerald-500/10 dark:bg-emerald-950/30 overflow-hidden text-[10px] font-mono shadow-2xs">
            <span
              data-testid="speed-limiter-status"
              className="flex items-center gap-1 px-2 text-emerald-600 dark:text-emerald-400 font-semibold select-none"
            >
              <Lock className="w-2.5 h-2.5" />
              <span>{item.speed_limit_mbps} Mbps Cap (={formatMbpsToMbPerSec(item.speed_limit_mbps!)} MB/s)</span>
            </span>
            <button
              type="button"
              onClick={() => handleApplyLimit(null)}
              data-testid="speed-limiter-reset"
              title="Reset speed limit — fully detach and return to normal full speed"
              className="flex items-center gap-1 px-2 h-full border-l border-emerald-500/30 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-sans font-medium text-[10px] transition-colors cursor-pointer"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              <span>Reset</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled
            data-testid="speed-limiter-reset"
            title="Speed limit is unthrottled (running normal full speed)"
            className="flex items-center gap-1 px-2 h-[22px] text-[10px] font-medium rounded-md border border-zinc-200/60 dark:border-zinc-800/60 bg-zinc-100/50 dark:bg-zinc-900/50 text-zinc-400 dark:text-zinc-600 cursor-not-allowed opacity-40 select-none"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            <span>Reset</span>
          </button>
        )}
      </div>
    </div>
  );
};
