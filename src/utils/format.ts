/**
 * Downex Data & Telemetry Formatting Utilities
 * Lightweight, zero-allocation helpers for bandwidth, sizes, and throughput metrics.
 */

export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0 || !isFinite(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  if (i <= 0) return `${Math.round(bytes)} B`;
  const val = bytes / Math.pow(k, i);
  return `${val >= 100 ? val.toFixed(1) : val.toFixed(2)} ${sizes[i]}`;
}

export function formatSpeed(bytesPerSec?: number | null): string {
  if (!bytesPerSec || bytesPerSec <= 0 || !isFinite(bytesPerSec)) return '0 MB/s';
  const mb = bytesPerSec / (1024 * 1024);
  if (mb < 0.1) {
    const kb = bytesPerSec / 1024;
    return `${kb.toFixed(1)} KB/s`;
  }
  return `${mb.toFixed(1)} MB/s`;
}

export function splitBytes(bytes?: number | null): { value: number; unit: string; decimals: number } {
  if (!bytes || bytes <= 0 || !isFinite(bytes)) {
    return { value: 0, unit: 'B', decimals: 0 };
  }
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  if (i <= 0) {
    return { value: Math.round(bytes), unit: 'B', decimals: 0 };
  }
  const val = bytes / Math.pow(k, i);
  const decimals = val >= 100 ? 1 : 2;
  return { value: val, unit: sizes[i], decimals };
}

export function splitSpeed(bytesPerSec?: number | null): { value: number; unit: string; decimals: number } {
  if (!bytesPerSec || bytesPerSec <= 0 || !isFinite(bytesPerSec)) {
    return { value: 0, unit: 'MB/s', decimals: 0 };
  }
  const mb = bytesPerSec / (1024 * 1024);
  if (mb < 0.1) {
    const kb = bytesPerSec / 1024;
    return { value: kb, unit: 'KB/s', decimals: 1 };
  }
  return { value: mb, unit: 'MB/s', decimals: 1 };
}

/**
 * Formats a duration in seconds into human-readable time taken (e.g. "45 sec", "2 min 15 sec", "1 hr 12 min").
 */
export function formatTimeTaken(seconds?: number | null): string {
  if (seconds === undefined || seconds === null || !isFinite(seconds) || seconds <= 0) {
    return '< 1 sec';
  }
  const totalSec = Math.round(seconds);
  if (totalSec < 1) return '< 1 sec';
  if (totalSec < 60) return `${totalSec} sec`;

  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  if (hours > 0) {
    if (secs > 0) return `${hours} hr ${minutes} min ${secs} sec`;
    if (minutes > 0) return `${hours} hr ${minutes} min`;
    return `${hours} hr`;
  }

  if (secs > 0) return `${minutes} min ${secs} sec`;
  return `${minutes} min`;
}

export interface ResumeCapabilityInfo {
  canResume: boolean;
  label: 'Yes' | 'No' | 'Unknown';
  modalStatusText: string;
  description: string;
  colorClass: string;
  iconColorClass: string;
  badgeBgClass: string;
}

/**
 * Centralized resume and byte-range capability resolver for Downex.
 * Harmonizes download modal probe results, SQLite DB states, and table visualizers.
 */
export function getResumeCapability(
  input?: { supports_ranges?: boolean | null; segments?: unknown[]; total_bytes?: number | null } | boolean | null
): ResumeCapabilityInfo {
  let supportsRanges: boolean | null | undefined;
  let hasMultiSegments = false;

  if (typeof input === 'boolean') {
    supportsRanges = input;
  } else if (input && typeof input === 'object') {
    supportsRanges = input.supports_ranges;
    if (Array.isArray(input.segments) && input.segments.length > 1) {
      hasMultiSegments = true;
    }
  } else if (input === null) {
    supportsRanges = false;
  }

  // 1. Explicitly false -> Server does not support HTTP byte ranges
  if (supportsRanges === false) {
    return {
      canResume: false,
      label: 'No',
      modalStatusText: 'Cannot pause or resume',
      description: 'Server does not support HTTP Range requests. Pausing or stopping will restart the download from 0%.',
      colorClass: 'text-amber-600 dark:text-amber-400',
      iconColorClass: 'text-amber-500',
      badgeBgClass: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200/60 dark:border-amber-800/40',
    };
  }

  // 2. Explicitly true or active multi-segment transfer (multi-segmenting requires HTTP byte ranges)
  if (supportsRanges === true || hasMultiSegments) {
    return {
      canResume: true,
      label: 'Yes',
      modalStatusText: 'Can pause and resume',
      description: 'Server supports HTTP Range requests. Download can be paused and resumed seamlessly.',
      colorClass: 'text-emerald-600 dark:text-emerald-400',
      iconColorClass: 'text-emerald-500',
      badgeBgClass: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200/60 dark:border-emerald-800/40',
    };
  }

  // 3. Unknown (not yet probed or unverified)
  return {
    canResume: false,
    label: 'Unknown',
    modalStatusText: 'Resume status unknown',
    description: 'Server byte range support has not been verified yet.',
    colorClass: 'text-zinc-500 dark:text-zinc-400',
    iconColorClass: 'text-zinc-400 dark:text-zinc-500',
    badgeBgClass: 'bg-zinc-50 dark:bg-zinc-800/40 border-zinc-200/60 dark:border-zinc-700/40',
  };
}

