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
