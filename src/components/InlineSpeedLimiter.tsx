import React, { useState, useEffect, useRef } from 'react';
import { Gauge, RotateCcw, Lock, Check, Save } from 'lucide-react';
import { DownloadItem } from '../types/download';
import { useDownloadStore } from '../stores/downloadStore';
import { saveCustomSpeedLimit, getSavedCustomSpeedLimit } from '../services/tauriService';

interface InlineSpeedLimiterProps {
  item: DownloadItem;
}

// Starter Options: 50Mbps, 100Mbps, 150Mbps, 180Mbps, 200Mbps
export const SPEED_PRESETS = [50, 100, 150, 180, 200];

// Dynamic MB conversion: 50 Mbps = 6.25 MB/s, 180 Mbps = 22.5 MB/s, 200 Mbps = 25 MB/s
export const formatMbpsToMbPerSec = (mbps: number): string => {
  if (mbps <= 0) return '0';
  const mb = mbps / 8;
  if (Number.isInteger(mb)) return String(mb);
  const fixed = mb.toFixed(2);
  return fixed.endsWith('0') ? mb.toFixed(1) : fixed;
};

const InlineSpeedLimiterComponent: React.FC<InlineSpeedLimiterProps> = ({ item }) => {
  const setSpeedLimit = useDownloadStore((state) => state.setSpeedLimit);

  // Controlled local input value
  const [inputValue, setInputValue] = useState<string>(
    item.speed_limit_mbps ? String(item.speed_limit_mbps) : ''
  );

  // User's locally saved custom speed limit from SQLite database
  const [savedCustom, setSavedCustom] = useState<number | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const saveTimerRef = useRef<number | null>(null);

  // Fetch saved custom speed limit on mount
  useEffect(() => {
    let isMounted = true;
    getSavedCustomSpeedLimit().then((val) => {
      if (isMounted && val && val > 0) {
        setSavedCustom(val);
      }
    });
    return () => {
      isMounted = false;
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

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

  const handleSaveCustom = async () => {
    const trimmed = inputValue.trim();
    if (trimmed) {
      const parsed = parseInt(trimmed, 10);
      if (parsed > 0) {
        handleApplyLimit(parsed);
        // Persist to local SQLite database (app_settings & downloads)
        await saveCustomSpeedLimit(parsed);
        setSavedCustom(parsed);
        setJustSaved(true);
        if (saveTimerRef.current !== null) {
          window.clearTimeout(saveTimerRef.current);
        }
        saveTimerRef.current = window.setTimeout(() => {
          setJustSaved(false);
          saveTimerRef.current = null;
        }, 2200);
      }
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
      handleSaveCustom();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setInputValue(item.speed_limit_mbps ? String(item.speed_limit_mbps) : '');
      e.currentTarget.blur();
    }
  };

  const handleBlur = () => {
    setIsInputFocused(false);
    const trimmed = inputValue.trim();
    if (trimmed) {
      const parsed = parseInt(trimmed, 10);
      if (parsed > 0 && parsed !== item.speed_limit_mbps) {
        handleSaveCustom();
      }
    } else {
      setInputValue(item.speed_limit_mbps ? String(item.speed_limit_mbps) : '');
    }
  };

  const isCapped = Boolean(item.speed_limit_mbps && item.speed_limit_mbps > 0);
  const isCustomLimitActive = isCapped && !SPEED_PRESETS.includes(item.speed_limit_mbps!);

  // Dynamic MB calculation for custom input (e.g. 180 Mbps = 22.5 MB/s)
  const parsedInput = parseInt(inputValue.trim(), 10);
  const liveCustomMb = !isNaN(parsedInput) && parsedInput > 0 ? formatMbpsToMbPerSec(parsedInput) : null;
  const isDirtyCustom = !isNaN(parsedInput) && parsedInput > 0 && parsedInput !== item.speed_limit_mbps;
  // Show dynamic MB conversion while typing or focused, avoiding duplicate clutter once applied
  const showDynamicMb = Boolean(liveCustomMb && (isDirtyCustom || isInputFocused));

  return (
    <div
      data-testid="inline-speed-limiter"
      className="flex items-center justify-between gap-1 px-1.5 py-0.5 my-0 h-[28px] bg-zinc-50/80 dark:bg-zinc-900/60 rounded-md border border-zinc-200/80 dark:border-zinc-800/80 text-[11px] select-none transition-colors duration-150 ease-out overflow-hidden"
    >
      {/* Left controls: Icon, Label, Starter Presets (50M, 100M, 150M, 180M, 200M), Custom Box */}
      <div className="flex items-center gap-1 min-w-0 flex-1 overflow-hidden">
        <div className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400 shrink-0 font-medium text-[10.5px]">
          <Gauge className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <span className="hidden sm:inline whitespace-nowrap">Limit:</span>
        </div>

        {/* Starter Presets: 50M, 100M, 150M, 180M, 200M */}
        <div className="flex items-center gap-0.5 shrink-0">
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
                className={`h-[22px] px-1.5 text-[9.5px] font-mono font-medium rounded border transition-colors duration-150 ease-out cursor-pointer flex items-center justify-center shrink-0 ${
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

        {/* Custom Input with Smooth Hover, Dynamic MB & Local Database Persistence */}
        <div
          data-testid="speed-limiter-custom-container"
          className={`group/custom flex items-center h-[22px] rounded border px-1 py-0 shadow-2xs transition-colors duration-150 ease-out shrink-0 ${
            isCustomLimitActive
              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:border-emerald-500/60'
              : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/90 focus-within:border-emerald-500/40 focus-within:ring-1 focus-within:ring-emerald-500/30'
          }`}
        >
          <input
            type="text"
            inputMode="numeric"
            value={inputValue}
            placeholder={savedCustom ? String(savedCustom) : 'Custom'}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsInputFocused(true)}
            onBlur={handleBlur}
            data-testid="speed-limiter-input"
            aria-label="Custom speed limit in Mbps"
            title={
              isCustomLimitActive
                ? `Active custom limit: ${item.speed_limit_mbps} Mbps (= ${formatMbpsToMbPerSec(item.speed_limit_mbps!)} MB/s)`
                : savedCustom
                ? `Saved custom limit: ${savedCustom} Mbps (Enter or click Save)`
                : 'Enter custom speed limit in Mbps'
            }
            className={`w-8 text-center font-mono text-[10px] font-semibold bg-transparent outline-none transition-colors duration-150 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 ${
              isCustomLimitActive
                ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                : 'text-zinc-900 dark:text-zinc-100'
            }`}
          />
          <span className="text-[9.5px] text-zinc-400 dark:text-zinc-500 font-mono pr-0.5 select-none">
            M
          </span>

          {/* Dynamic MB display right inside custom box while typing or focused */}
          {showDynamicMb && (
            <span
              data-testid="speed-limiter-dynamic-mb"
              className="text-[9.5px] text-emerald-600 dark:text-emerald-400 font-mono font-medium pl-1 border-l border-zinc-200 dark:border-zinc-700 select-none whitespace-nowrap"
              title={`${inputValue} Mbps = ${liveCustomMb} MB/s`}
            >
              ={liveCustomMb} MB/s
            </span>
          )}

          {/* Explicit Save button to commit to SQLite database */}
          {isDirtyCustom && (
            <button
              type="button"
              onClick={handleSaveCustom}
              data-testid="speed-limiter-save-btn"
              title="Save custom speed limit to local database & apply"
              className="ml-0.5 pl-1 border-l border-emerald-500/30 flex items-center gap-0.5 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 cursor-pointer transition-colors shrink-0"
            >
              <Save className="w-2.5 h-2.5" />
              <span>Save</span>
            </button>
          )}
        </div>
      </div>

      {/* Right side: Single Unified Cap Badge & Reset Control (symmetric, uniform h-[22px], rounded) */}
      <div className="shrink-0 flex items-center ml-auto pl-1">
        {isCapped ? (
          <div className="flex items-center h-[22px] rounded border border-emerald-500/35 bg-emerald-500/10 dark:bg-emerald-950/30 overflow-hidden text-[9.5px] font-mono shadow-2xs">
            <span
              data-testid="speed-limiter-status"
              className="flex items-center gap-1 px-1.5 text-emerald-600 dark:text-emerald-400 font-semibold select-none whitespace-nowrap"
              title={`Active limit: ${item.speed_limit_mbps} Mbps (= ${formatMbpsToMbPerSec(item.speed_limit_mbps!)} MB/s)`}
            >
              <Lock className="w-2.5 h-2.5 shrink-0" />
              <span>{item.speed_limit_mbps} Mbps Cap (={formatMbpsToMbPerSec(item.speed_limit_mbps!)} MB/s)</span>
              {justSaved && (
                <span
                  data-testid="speed-limiter-saved-indicator"
                  className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded-xs text-[8.5px] font-mono font-bold bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 animate-fade-in"
                >
                  <Check className="w-2 h-2" />
                  SAVED
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => handleApplyLimit(null)}
              data-testid="speed-limiter-reset"
              title="Reset speed limit — fully detach and return to normal full speed"
              className="flex items-center gap-1 px-1.5 h-full border-l border-emerald-500/30 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-sans font-medium text-[9.5px] transition-colors duration-150 ease-out cursor-pointer shrink-0"
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
            className="flex items-center gap-1 px-1.5 h-[22px] text-[9.5px] font-medium rounded border border-zinc-200/60 dark:border-zinc-800/60 bg-zinc-100/50 dark:bg-zinc-900/50 text-zinc-400 dark:text-zinc-600 cursor-not-allowed opacity-40 select-none shrink-0"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            <span>Reset</span>
          </button>
        )}
      </div>
    </div>
  );
};

// React.memo with custom equality comparator:
// Completely insulates limiter from 10-20 FPS download progress ticks (bytes, rate, eta, segments).
// Only re-renders when task id or speed_limit_mbps changes, ensuring 0ms hover lag!
export const InlineSpeedLimiter = React.memo<InlineSpeedLimiterProps>(
  InlineSpeedLimiterComponent,
  (prev, next) => {
    return (
      prev.item.id === next.item.id &&
      prev.item.speed_limit_mbps === next.item.speed_limit_mbps
    );
  }
);
