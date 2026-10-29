/**
 * Downex In-App Patch Notes & Release Catalog
 * 
 * Provides dynamic release highlights and baseline historical changelogs
 * for all published versions from v0.0.0 through v0.0.8.
 * Decoupled from application build cycles.
 */


export interface DynamicPatchNotes {
  version: string;
  releaseDate: string;
  title: string;
  highlights: string[];
  rawNotes?: string;
  isCustom?: boolean;
  updatedAt?: number;
}

export function parseNotesToHighlights(rawText?: string): string[] {
  if (!rawText || !rawText.trim()) {
    return ['Performance optimizations and security improvements'];
  }

  return rawText
    .split(/\r?\n|•|\*|;/)
    .map((line) => line.trim())
    .map((line) => line.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter((line) => line.length > 0 && !line.toLowerCase().startsWith('v0.') && !line.toLowerCase().startsWith('version '));
}

export const BASELINE_PATCH_NOTES: Record<string, DynamicPatchNotes> = {
  '0.0.9': {
    version: '0.0.9',
    releaseDate: 'October 29, 2026',
    title: 'In-App Patch Notes Management & Engine Synchronization',
    highlights: [
      'Dedicated in-app Patch Notes management center integrated directly into Downex Settings',
      'Decoupled patch notes persistence using SQLite WAL database with zero binary rebuild requirements',
      'Interactive timeline with version tagging, highlight checklists, and expandable manifest notes',
      'In-app Patch Note Authoring Modal allowing instant creation and editing of release changelogs',
      'On-demand cloud sync harvesting release notes directly from live OTA manifests',
    ],
    rawNotes: 'v0.0.9: In-app Patch Notes management center in Settings, SQLite table persistence, and live cloud manifest synchronization',
  },
  '0.0.8': {
    version: '0.0.8',
    releaseDate: 'October 29, 2026',
    title: 'Enterprise Update Experience & Verification Suite',
    highlights: [
      'Refined minimal, enterprise-grade update notification toast without consumer sparkle glyphs',
      'Integrated in-app Patch Notes center in Settings for complete release changelog inspection',
      'Decoupled patch notes storage with SQLite engine persistence and on-demand cloud sync',
      'Comprehensive Playwright E2E testing suite covering full OTA and restarting lifecycles',
    ],
    rawNotes: 'v0.0.8: Enterprise minimal update notification, in-app Patch Notes management, SQLite engine sync, and E2E test verification.',
  },
  '0.0.7': {
    version: '0.0.7',
    releaseDate: 'October 29, 2026',
    title: 'Dedicated Light-Theme Restart Supervisor',
    highlights: [
      'Dedicated light-theme restarting window with 7-second intentional handoff transition',
      'Graceful socket shutdown and single-instance IPC mutex release prior to update execution',
      'Atomic process supervisor preventing Windows socket locks during binary replacement',
      'Real-time state flush for SQLite WAL journals to prevent database locking during restart',
    ],
    rawNotes: 'v0.0.7: Dedicated light-theme restarting window with 7-second handoff transition and atomic process supervisor.',
  },
  '0.0.6': {
    version: '0.0.6',
    releaseDate: 'October 29, 2026',
    title: 'Minisign Verification Hardening & Fresh Installation Parity',
    highlights: [
      'Cryptographic Minisign Ed25519 signature verification hardening across fresh Windows environments',
      'Standardized uncompressed binary streams during signature calculation to prevent digest mismatches',
      'Direct payload signature validation ensuring identical update behavior on new and existing PCs',
      'Eliminated false-positive verification errors on clean Windows deployments',
    ],
    rawNotes: 'v0.0.6: Minisign signature verification hardening and clean Windows deployment parity.',
  },
  '0.0.5': {
    version: '0.0.5',
    releaseDate: 'October 28, 2026',
    title: 'Smart Link Detection & Clipboard Auto-Capture',
    highlights: [
      'Automatic clipboard URL monitoring for instant HTTP/HTTPS download link detection',
      'Instant pre-filled download dialog popup when copying links from external applications',
      'Background HTTP HEAD probe metadata analysis for fast filename and content length discovery',
      'Settings toggle to enable or disable automatic clipboard link inspection',
    ],
    rawNotes: 'v0.0.5: Clipboard URL auto-detection, pre-filled download dialog, and fast HTTP probe inspection.',
  },
  '0.0.4': {
    version: '0.0.4',
    releaseDate: 'October 27, 2026',
    title: 'System Tray & Windows Autostart Integration',
    highlights: [
      'Minimize to system tray on window close to keep active downloads running uninterrupted',
      'Native Windows startup autostart integration with silent background tray boot',
      'Interactive tray context menu for queue control, clipboard triggers, and update checks',
      'Configurable tray preferences in the settings view with immediate persistence',
    ],
    rawNotes: 'v0.0.4: Minimize to tray on close, silent startup autostart, and interactive tray menu.',
  },
  '0.0.3': {
    version: '0.0.3',
    releaseDate: 'October 26, 2026',
    title: 'High-Throughput Concurrent Chunk Multiplexer',
    highlights: [
      'IDM-style parallel socket acceleration supporting up to 32 simultaneous TCP connections',
      'Dynamic byte-range segment partitioning for maximum bandwidth utilization',
      'On-the-fly chunk recombination with atomic file streaming directly into target paths',
      'Dynamic connection count selector (4, 8, 16, 32 sockets) in Downex Settings',
    ],
    rawNotes: 'v0.0.3: Multi-threaded parallel TCP chunk multiplexer with dynamic range allocation up to 32 sockets.',
  },
  '0.0.2': {
    version: '0.0.2',
    releaseDate: 'October 25, 2026',
    title: 'Engine Recovery & UI Status Indicators',
    highlights: [
      'Automatic resume and exponential backoff retry logic for interrupted network streams',
      'Detailed download table with real-time transfer rates, ETA, and byte progress calculations',
      'Enhanced error state reporting and actionable retry triggers on connection loss',
      'Telemetry sparkline graphs visualizing live network throughput across active queues',
    ],
    rawNotes: 'v0.0.2: Auto-resume on connection drops, detailed download table progress, and throughput telemetry.',
  },
  '0.0.1': {
    version: '0.0.1',
    releaseDate: 'October 24, 2026',
    title: 'Initial Dynamic OTA Update Pipeline',
    highlights: [
      'In-process atomic shadow replacement engine for seamless desktop app updates',
      'Minisign Ed25519 cryptographic update payload verification',
      'Automated background update discovery with non-intrusive notification banners',
      'Fallback manual update trigger in sidebar and system tray',
    ],
    rawNotes: 'v0.0.1: First dynamic OTA release pipeline with Minisign Ed25519 verification and atomic swap.',
  },
  '0.0.0': {
    version: '0.0.0',
    releaseDate: 'October 20, 2026',
    title: 'Lifetime Base Anchor Release',
    highlights: [
      'Core Tauri 2 + React 19 architecture with high-throughput Rust download engine',
      'High-performance SQLite WAL database for atomic task state and queue persistence',
      'Manifest V3 companion browser extension communication via WebSocket IPC',
      'Permanent, immutable base desktop installer for Windows x64 environments',
    ],
    rawNotes: 'v0.0.0: Lifetime base anchor installer with SQLite WAL engine and browser extension integration.',
  },
};
