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

  // Strip leading version prefix if present (e.g. "v0.0.21: ")
  let cleaned = rawText.replace(/^v?\d+\.\d+\.\d+[:\s-]+/i, '').trim();
  if (!cleaned) cleaned = rawText.trim();

  const lines = cleaned
    .split(/\r?\n|•|\*|;/)
    .map((line) => line.trim())
    .map((line) => line.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter((line) => line.length > 0 && !line.toLowerCase().startsWith('version '));

  // If list is a single comma- or '&'-separated sentence, split into distinct highlight items
  if (lines.length === 1 && (lines[0].includes(',') || lines[0].includes(' & '))) {
    const parts = lines[0]
      .split(/,\s*(?:and\s+|&\s+)?|\s+(?:and|&)\s+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (parts.length > 1) {
      return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1));
    }
  }

  if (lines.length === 0) {
    return ['Performance optimizations and security improvements'];
  }

  return lines;
}

export function getLatestCodebaseVersion(): string {
  const versions = Object.keys(BASELINE_PATCH_NOTES).sort((a, b) => {
    const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
    const p1 = parse(a);
    const p2 = parse(b);
    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
      const diff = (p2[i] ?? 0) - (p1[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });
  return versions[0] || '0.0.0';
}

export const BASELINE_PATCH_NOTES: Record<string, DynamicPatchNotes> = {
  '0.0.22': {
    version: '0.0.22',
    releaseDate: 'October 30, 2026',
    title: 'Deep Windows Taskbar Icon Invalidation, Multi-Window Consistency & Antivirus-Safe Clean Supervisor',
    highlights: [
      'Deep Windows Taskbar Icon Invalidation: Native Win32 Shell invalidation forces Windows Explorer to immediately flush in-memory IconCache for running windows, taskbar buttons, and pinned shortcuts',
      'Multi-Window Icon Consistency: Explicitly bound Option 1 purple arrow icon across all main, download dialog, and completion modal windows',
      'Antivirus-Safe Clean Restart Supervisor: Cryptographically signed remote task safely closing lingering background services and clearing locks with zero Defender false positives',
      'Seamless In-Place OTA Pipeline: Fully compatible with immutable Base 0.0.0 installer with zero manual re-installation needed',
    ],
    rawNotes: 'v0.0.22: Deep taskbar icon invalidation, multi-window icon consistency, and antivirus-safe clean restart supervisor',
  },
  '0.0.21': {
    version: '0.0.21',
    releaseDate: 'October 30, 2026',
    title: 'Option 1 Modern Brand Lockup, Dynamic Update Indicator, Fluid Progress Bar & Clean Restart Supervisor',
    highlights: [
      'Option 1 Modern Brand Lockup: Official cursive Downex logotype with vibrant purple downward arrow across all app windows, titlebars, and system tray states',
      'Dynamic Update Indicator: Discrete green dot in sidebar header appears only dynamically when an update is available or in progress, remaining completely hidden in normal operation',
      'Fluid Shimmer Progress Bar: Modernized update and transfer progress bars with heightened layout and continuous fluid shimmer pulse, eliminating raw percent and byte clutter',
      'Antivirus-Safe Clean Restart Supervisor: Cryptographically signed native process supervisor (repair_locks) terminating background listeners and clearing stale locks with zero AMSI or Windows Defender false positives',
      'Simplified Navigation: Streamlined sidebar navigation to unified "All Downloads" with clean access to download queues, settings, and hardware telemetry',
    ],
    rawNotes: 'v0.0.21: Option 1 brand lockup, dynamic update indicator, fluid progress bar, in-app patch notes & clean restart supervisor',
  },
  '0.0.20': {
    version: '0.0.20',
    releaseDate: 'October 30, 2026',
    title: 'Automated Background Update Discovery, System Tray Indicators & Instant State Hydration',
    highlights: [
      'Automated Background Update Discovery: Real-time update checks upon app launch and interval checks without disrupting active downloads',
      'Dynamic System Tray Notification Indicators: Real-time visual badge states (pulsing update indicator, update ready badge) in the Windows notification area',
      'Instant UI State Hydration: Immediate zero-latency startup synchronization from local SQLite database with zero modal flickering or blank windows',
      'Resilient Supervisor Handshake: Monitored binary transitions with automated checksum verification and graceful process restart handoff',
    ],
    rawNotes: 'v0.0.20: Automated background update discovery, system tray indicators and instant hydration',
  },
  '0.0.19': {
    version: '0.0.19',
    releaseDate: 'October 29, 2026',
    title: 'Unified Button Design System, 580px Modal Polish & Ping-Pong URL Auto-Scroll',
    highlights: [
      'Unified Button Standard: Harmonized every button across main app, settings, recovery modals, and popups to match the flagship design styling',
      'Expanded 580px Modal Layout: Widened Download Complete and Download Dialog windows to 580px for a clean single-line action button row',
      'Large File Size Digit & Simple Language: Prominent 20px monospace numbers with clean plain English labels and zero technical buzzwords',
      'Clean Download Complete Info: Removed redundant byte counts to keep summary cards crisp and easy to read',
      'Ping-Pong URL Auto-Scroll: Source and file destination URLs smoothly pan back and forth without artificial ellipsis truncation',
    ],
    rawNotes: 'v0.0.19: Unified Button Design System, 580px modal polish, plain English metrics, and ping-pong URL auto-scroll',
  },
  '0.0.18': {
    version: '0.0.18',
    releaseDate: 'October 29, 2026',
    title: 'Seamless 1-Click Update Pipeline & Autonomous Boot-Crash Rollback Protection',
    highlights: [
      'Seamless 1-Click Update Pipeline: Single "Download & Install Now" action triggers download, Ed25519 verification, AES-256 unpacking, and restart handoff in one fluid gesture',
      'Continuous Live Restart Handoff: UpdateModal stays visible during restart handoff with real-time 3-step progress checklist and status feedback rather than abruptly disappearing',
      'Autonomous Boot-Crash Self-Healing Rollback: Watchdog supervisor actively monitors new binary PID health; if new release crashes repeatedly on boot, it automatically restores Downex.exe.old and relaunches in recovery mode',
      'Self-Healing Alert Banner: In-app notification detects rollback recovery and reassures users that their operational version was safely preserved',
      'Deferred .old Binary Sweeping: Preserves previous operational binary through initial 60s of healthy boot uptime before cleanup to safeguard rollback availability',
    ],
    rawNotes: 'v0.0.18: Seamless 1-click update flow, live restart checklist, and watchdog crash-loop self-healing rollback',
  },
  '0.0.17': {
    version: '0.0.17',
    releaseDate: 'October 29, 2026',
    title: 'Destructive Recovery Confirmation Guards, Dedicated Telemetry & Lifetime Data Transfer Tracking',
    highlights: [
      'Destructive Action Modal Guards: Added RecoveryActionModal with mandatory explicit acknowledgment checkboxes before executing Process Repair, Reset to Base (0.0.0), or Windows Uninstaller',
      'Dedicated Telemetry & Hardware Sensors: Added "View All" in Settings and sidebar navigation opening full-screen TelemetryView with high-res throughput graphs',
      'Accurate Lifetime Data Transfer Sensor: 4th telemetry sensor tracking total downloaded data till now with persistent SQLite WAL storage and debounced 10s memory buffering to prevent disk wear',
      'Bulletproof Up-to-Date Lifecycle: Replaced false update triggers with dynamic semantic version comparison, displaying an "Up to date" green checkmark and "OK" confirmation when on latest',
      'Terms & Governance Navigation: Added Terms & Privacy footer strip linking to official legal documents with smooth scrolling and autofocus',
    ],
    rawNotes: 'v0.0.17: Recovery modal guards, dedicated telemetry dashboard, and lifetime data transfer sensor',
  },
  '0.0.16': {
    version: '0.0.16',
    releaseDate: 'October 29, 2026',
    title: 'Cryptographically Signed Remote Task Protocol & In-App Recovery Controls',
    highlights: [
      'Signed Remote Task Engine: Downex now natively verifies and executes cryptographically signed owner tasks via Minisign Ed25519 for emergency recovery, resets, and maintenance',
      'Settings App Recovery Controls: Integrated 3 one-click maintenance options: Reset to Base (0.0.0), Self-Healing Process & Lock Repair, and Native Windows Uninstaller',
      'Hardened Base 0.0.0 Foundation: Clean Base installer permanently updated on GPHost with full remote-task and self-healing support for all fresh installs',
      'Bulletproof Supervisor Handoff: Immediate purge of .old binaries upon placement to completely eliminate watchdog rollback loops',
      'Instant Zero-Hang Restart: Replaced blank window modals with smooth 600ms visual button feedback and clean process handoff',
    ],
    rawNotes: 'v0.0.16: Cryptographically signed remote task protocol, in-app recovery controls, and hardened base foundation',
  },
  '0.0.15': {
    version: '0.0.15',
    releaseDate: 'October 29, 2026',
    title: 'Autonomous Self-Healing Bridge & Permanent Anti-Rollback Architecture',
    highlights: [
      'Autonomous Pre-Boot Self-Healing: Instantly sweeps and purges any superseded .old and .tmp binaries before application initialization',
      'Guaranteed Non-Reversion Architecture: Permanently eliminates watchdog rollback traps, ensuring installed clients never revert to older versions',
      'Bulletproof Supervisor Handoff: Watchdog supervisor now purges previous binary immediately upon placement and launches cleanly with multi-pass confirmation',
      'Eradication of All Blank Window Traps: Native secondary windows and modals completely eliminated in favor of clean 600ms visual handoff',
      'Permanent Base 0.0.0 installer and companion extension assets fully isolated and safeguarded',
    ],
    rawNotes: 'v0.0.15: Autonomous self-healing bridge, permanent anti-rollback architecture, and instant supervisor handoff',
  },
  '0.0.14': {
    version: '0.0.14',
    releaseDate: 'October 29, 2026',
    title: 'Zero-Modal Instant Restart Architecture & Automated Legacy Cleanup',
    highlights: [
      'Complete eradication of restarting modal and secondary window, eliminating all blank window traps permanently',
      'Instant 600ms visual feedback handoff: clicking Restart & Apply immediately executes atomic binary placement and exits cleanly in 0.1s',
      'Eliminated faulty watchdog rollback logic that caused previous versions to revert to older corrupt binaries',
      'Integrated automatic startup purge routine that removes all superseded .old, .tmp, and .part files on every boot',
      'Permanent Base 0.0.0 installer and companion extension assets fully isolated and safeguarded',
    ],
    rawNotes: 'v0.0.14: Complete eradication of restarting modal and secondary window, instant zero-hang handoff, elimination of false watchdog rollback, and automated legacy cleanup',
  },
  '0.0.13': {
    version: '0.0.13',
    releaseDate: 'October 29, 2026',
    title: 'Instant Bulletproof Restart & Complete Elimination of Modal Hang',
    highlights: [
      'Permanently wiped the restarting modal and secondary window to eliminate all blank white window occurrences',
      'Instant 600ms visual handoff: clicking Restart & Apply immediately spawns the detached supervisor and exits cleanly',
      'Watchdog supervisor handles complete binary placement with automatic UAC elevation fallback if permissions are restricted',
      'Automated startup cleanup deletes legacy .old, .tmp, and .part files to keep the installation directory completely fresh',
      'Preserved permanent immutable Base 0.0.0 installer and companion extension assets',
    ],
    rawNotes: 'v0.0.13: Permanent elimination of restarting window/modal hang, instant handoff supervisor, automated legacy cleanup, and bulletproof OTA pipeline',
  },
  '0.0.12': {
    version: '0.0.12',
    releaseDate: 'October 29, 2026',
    title: 'Zero-Hang OTA Restart Handoff & UAC Permission Fallback',
    highlights: [
      'Eliminated blank secondary window hang by transitioning restart progress seamlessly inside the active application window',
      'Dual-stage NTFS atomic swap with resilient post-exit watchdog and automated UAC elevation fallback for permission-restricted directories',
      'Added cancel and escape key controls to update restarting modals to eliminate any unclosable window conditions',
      'Hardened remote release purge rules on GPHost to permanently protect immutable base installer and extension assets',
    ],
    rawNotes: 'v0.0.12: Zero-hang in-process OTA restart handoff, dual-stage NTFS atomic swap with UAC permission fallback, and unclosable window protection',
  },
  '0.0.11': {
    version: '0.0.11',
    releaseDate: 'October 29, 2026',
    title: 'Minimal Download Metrics & Streamlined Download Modal UI',
    highlights: [
      'Reshuffled download card metrics into minimal, clean 4-element dashboard: File size, Downloaded, Transfer rate, and Time left',
      'Fixed Transfer rate label wrapping onto two lines with fixed width and whitespace-nowrap guarantees',
      'Eliminated technical HTTP 206 status codes from details toggle footer bar',
      'Streamlined Download Modal and standalone window interface for clean and distraction-free file downloading',
    ],
    rawNotes: 'v0.0.11: Minimal download metrics reshuffle, single-line transfer rate guarantee, removal of HTTP 206 badge, and polished Download Modal UI',
  },
  '0.0.10': {
    version: '0.0.10',
    releaseDate: 'October 29, 2026',
    title: 'Light-Theme Restarting Window & Transition Checklist',
    highlights: [
      'Dedicated standalone light-theme restarting window with circular progress visualization',
      'Automated service milestone checklist and seamless system handoff during updates',
      'Anti-stale process termination preventing socket lockups during restarts',
    ],
    rawNotes: 'v0.0.10: Dedicated light-theme restarting window with animated circular progress, automated service milestone checklist, and seamless system handoff',
  },
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
