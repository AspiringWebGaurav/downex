/**
 * Downex Version Utility - Ported and enhanced from GPN architecture
 * Guarantees consistent 'vX.Y.Z' or 'X.Y.Z' display across the entire application.
 * Prevents double 'vv' prefixes under all circumstances and provides semver comparisons.
 */

export const APP_BASE_VERSION = '0.0.1';

export function cleanVersion(v?: string | null): string {
  if (!v) return APP_BASE_VERSION;
  return v.trim().replace(/^[vV]+/, '') || APP_BASE_VERSION;
}

export function formatVersion(v?: string | null): string {
  return `v${cleanVersion(v)}`;
}

export function compareSemver(v1: string, v2: string): number {
  const parse = (v: string) =>
    cleanVersion(v)
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const p1 = parse(v1);
  const p2 = parse(v2);
  const len = Math.max(p1.length, p2.length);
  for (let i = 0; i < len; i++) {
    const a = p1[i] ?? 0;
    const b = p2[i] ?? 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

/**
 * Strict single-digit decimal rollover sequence:
 * 0.0.1 -> ... -> 0.0.9 -> 0.1.0 ... -> 0.9.9 -> 1.0.0
 */
export function getNextSingleDigitVersion(version?: string | null): string {
  const parts = cleanVersion(version)
    .split('.')
    .map((p) => parseInt(p, 10) || 0);
  let major = parts[0] ?? 0;
  let minor = parts[1] ?? 0;
  let patch = parts[2] ?? 0;
  if (patch >= 9) {
    patch = 0;
    if (minor >= 9) {
      minor = 0;
      major += 1;
    } else {
      minor += 1;
    }
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}
