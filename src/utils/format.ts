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
