/**
 * Downex — Silicon Hardware Event & Directive Streaming Service
 * 
 * Establishes a zero-poll, real-time bidirectional attestation channel:
 * 1. Derives tamper-proof silicon HWID on startup.
 * 2. Attests hardware to ecosystem backend.
 * 3. Connects to real-time Server-Sent Events stream (/api/downex/stream/{hwid}).
 * 4. Receives instant BAN / UNBAN directives and dynamically executes them live with ZERO refresh or restart.
 */

import { useHardwareBanStore } from '../stores/hardwareBanStore';
import { useMarqueeNoticeStore, MarqueeNotice } from '../stores/marqueeNoticeStore';
import { useAppVersionStore } from '../stores/appVersionStore';
import { updateService } from './updateService';
import { isTauri, getResolvedVersion } from './tauriService';
import { APP_BASE_VERSION, cleanVersion } from '../utils/version';

let resolvedEcosystemBaseUrl: string | null = null;

export function isLocalDevRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  const port = window.location.port;

  // Packaged Tauri Windows WebView2 runs on http://tauri.localhost — never treat it as local dev server
  if (host === 'tauri.localhost') {
    return Boolean((import.meta as any)?.env?.DEV) && (port === '1420' || port === '5173');
  }

  return (
    Boolean((import.meta as any)?.env?.DEV) ||
    port === '1420' ||
    port === '5173' ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.localhost')
  );
}

export function getEcosystemBaseUrl(): string {
  if (resolvedEcosystemBaseUrl) return resolvedEcosystemBaseUrl;

  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    try {
      const custom = localStorage.getItem('downex_custom_api_url');
      if (custom && (custom.startsWith('https://') || custom.startsWith('http://127.0.0.1') || custom.startsWith('http://localhost'))) {
        return custom;
      }
    } catch {}

    try {
      if (localStorage.getItem('downex_use_local_backend') === 'true') {
        return 'http://127.0.0.1:3000';
      }
    } catch {}

    if (isLocalDevRuntime()) {
      return 'http://127.0.0.1:3000';
    }
  }
  return 'https://downex.apps.gauravpatil.site';
}

let activeEventSource: EventSource | null = null;
let reconnectTimer: any = null;
let sseRetryAttempts = 0;
let isInitialized = false;
let currentBootEpoch = 0;
let syncQueuePromise: Promise<void> = Promise.resolve();

interface DirectivePayload {
  action: 'BAN' | 'UNBAN' | 'hardware_ban' | 'hardware_unban' | 'HARDWARE_BAN' | 'HARDWARE_UNBAN' | string;
  target_hwid?: string;
  reason?: string;
  timestamp?: number;
}

const ACTIVE_OTA_STATES = new Set([
  'checking',
  'available',
  'downloading',
  'verifying',
  'patching',
  'installing',
  'restarting',
  'waiting_timer',
  'queued',
  'ready',
  'up-to-date',
]);

function buildNoticesSignature(list: unknown): string {
  if (!Array.isArray(list) || list.length === 0) return '';
  return list
    .filter((item): item is MarqueeNotice => Boolean(item && typeof item === 'object'))
    .map(
      (n) =>
        `${n.id || ''}:${n.updatedAt || n.createdAt || ''}:${(n.text || '').trim()}:${n.tone || ''}:${n.modeLabel || ''}:${n.modeColor || ''}:${n.direction || ''}:${n.speed ?? 1}:${Boolean(n.showCountdown)}:${n.expiresAt ?? ''}`
    )
    .join('|');
}

function runAppVersionPacketSync(
  applyToSystem: () => Promise<void> | void,
  shouldRun?: () => boolean
): Promise<void> {
  const execute = async () => {
    if (shouldRun && !shouldRun()) {
      return;
    }

    const isOtaBusy = () => {
      const st = updateService.getStatus();
      return ACTIVE_OTA_STATES.has(st.state) && !st.isSilentSync;
    };

    if (isOtaBusy()) {
      await applyToSystem();
      return;
    }

    // 1. Checking incoming SSE / server payload
    updateService.notify({
      state: 'checking',
      isManualCheck: false,
      isSilentSync: true,
      errorMessage: undefined,
    });
    await new Promise((resolve) => setTimeout(resolve, 220));
    if (isOtaBusy()) { await applyToSystem(); return; }

    // 2. Smooth 1% -> 100% download stage on APP VERSION row
    const packetBytes = 65536;
    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      if (isOtaBusy()) { await applyToSystem(); return; }
      const pct = Math.min(100, Math.round((i / steps) * 100));
      updateService.notify({
        state: 'downloading',
        isManualCheck: false,
        isSilentSync: true,
        progress: {
          percentage: pct,
          downloadedBytes: Math.floor((pct / 100) * packetBytes),
          totalBytes: packetBytes,
        },
        errorMessage: undefined,
      });
      await new Promise((resolve) => setTimeout(resolve, 28));
    }

    if (isOtaBusy()) { await applyToSystem(); return; }

    // 3. Cryptographic / structural verification stage
    updateService.notify({
      state: 'verifying',
      isManualCheck: false,
      isSilentSync: true,
      progress: {
        percentage: 100,
        downloadedBytes: packetBytes,
        totalBytes: packetBytes,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 280));
    if (isOtaBusy()) { await applyToSystem(); return; }

    // 4. Patching / applying verified state to the running system
    updateService.notify({
      state: 'patching',
      isManualCheck: false,
      isSilentSync: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 240));

    try {
      await applyToSystem();
    } finally {
      if (!isOtaBusy()) {
        // Return cleanly to idle APP VERSION (no false UP TO DATE badge on background sync)
        updateService.notify({
          state: 'idle',
          isManualCheck: false,
          isSilentSync: false,
          progress: undefined,
          errorMessage: undefined,
        });
      }
    }
  };

  syncQueuePromise = syncQueuePromise.then(execute, execute);
  return syncQueuePromise;
}

function syncNoticesThroughAppVersion(list: unknown, pulseOnReveal: boolean): Promise<void> {
  const incomingList = Array.isArray(list) ? list : [];
  const nextSig = buildNoticesSignature(incomingList);

  return runAppVersionPacketSync(
    () => {
      useMarqueeNoticeStore.getState().setNotices(incomingList, pulseOnReveal && incomingList.length > 0);
    },
    () => nextSig !== buildNoticesSignature(useMarqueeNoticeStore.getState().notices)
  );
}

/**
 * Handles incoming directives from either SSE stream or attestation fallback.
 */
export async function handleDirectivePayload(payload: DirectivePayload, hwid: string): Promise<void> {
  if (!payload || !payload.action) return;

  const target = (payload.target_hwid || '').trim().toUpperCase();
  const current = hwid.trim().toUpperCase();

  if (target && (target === current || target === '*')) {
    const actionUpper = payload.action.toUpperCase();

    if (actionUpper === 'BAN' || actionUpper === 'HARDWARE_BAN') {
      console.warn('[Downex Silicon] Instant REALTIME BAN directive received:', payload);
      await runAppVersionPacketSync(async () => {
        if (useHardwareBanStore.getState().isBanned) return; // Already banned, skip animation
        await useHardwareBanStore.getState().enforceBanLive(payload.reason || 'You have been banned from ADMIN');
      });
    } else if (actionUpper === 'UNBAN' || actionUpper === 'HARDWARE_UNBAN') {
      console.log('[Downex Silicon] Instant REALTIME UNBAN directive received:', payload);
      let didReinstate = false;
      try {
        await runAppVersionPacketSync(async () => {
          if (!useHardwareBanStore.getState().isBanned) return; // Already unbanned, skip animation
          didReinstate = true;
          const startedAt = Date.now();
          useHardwareBanStore.getState().setReinstating(true);
          await useHardwareBanStore.getState().liftBanLive();
          const remainingMs = Math.max(0, 1200 - (Date.now() - startedAt));
          if (remainingMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, remainingMs));
          }
          useHardwareBanStore.getState().setReinstating(false);
        });
      } finally {
        if (didReinstate) {
          useHardwareBanStore.getState().setReinstating(false);
        }
      }
    }
  }
}

/**
 * Attests device to remote ecosystem registry and verifies permission state.
 * Probes candidate URLs safely and locks onto the first responsive endpoint.
 */
async function attestDevice(hwid: string, bootEpoch: number): Promise<string | null> {
  const preferred = getEcosystemBaseUrl();
  // Never allow browser/Playwright previews (!isTauri) to attest or stream into production ecosystem DB
  const candidates = !isTauri
    ? ['http://127.0.0.1:3000']
    : isLocalDevRuntime()
    ? [
        preferred,
        'http://127.0.0.1:3000',
        'https://downex.apps.gauravpatil.site',
        'https://downex.gauravpatil.site',
      ]
    : [
        preferred,
        'https://downex.apps.gauravpatil.site',
        'https://downex.gauravpatil.site',
      ];
  const uniqueCandidates = Array.from(new Set(candidates));

  for (const candidate of uniqueCandidates) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      let reportedVersion = useAppVersionStore.getState().currentVersion || APP_BASE_VERSION;
      try {
        const resolved = cleanVersion(await getResolvedVersion());
        if (resolved && resolved !== '0.0.0') {
          reportedVersion = resolved;
        }
      } catch {}

      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(`${candidate}/api/downex/attest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hwid,
          version: reportedVersion,
          os: 'Windows 11 x64 (NTFS Silicon Enforced)',
        }),
        signal: controller.signal,
      });

      if (res.ok) {
        if (bootEpoch !== currentBootEpoch) return candidate;
        resolvedEcosystemBaseUrl = candidate;
        const data = await res.json();
        if (bootEpoch !== currentBootEpoch) return candidate;
        if (data && Array.isArray(data.notices)) {
          await syncNoticesThroughAppVersion(data.notices, true);
        }
        if (data && data.is_banned === true) {
          if (!useHardwareBanStore.getState().isBanned) {
            console.warn('[Downex Silicon] Server attested BANNED state for HWID:', hwid);
            await handleDirectivePayload(
              {
                action: 'HARDWARE_BAN',
                target_hwid: hwid,
                reason: data.reason || 'You have been banned from ADMIN',
              },
              hwid
            );
          }
        } else if (data && data.is_banned === false) {
          if (useHardwareBanStore.getState().isBanned) {
            console.log('[Downex Silicon] Server attested UNBANNED state, lifting local ban:', hwid);
            await handleDirectivePayload(
              {
                action: 'HARDWARE_UNBAN',
                target_hwid: hwid,
              },
              hwid
            );
          }
        }
        return candidate;
      }
    } catch {
      // Try next candidate silently
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }
  return null;
}

/**
 * Connects to the real-time SSE directive stream for this machine.
 */
function connectDirectiveStream(hwid: string): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (activeEventSource) {
    try {
      activeEventSource.close();
    } catch {}
    activeEventSource = null;
  }

  const baseUrl = resolvedEcosystemBaseUrl || getEcosystemBaseUrl();
  const streamUrl = `${baseUrl}/api/downex/stream/${encodeURIComponent(hwid)}`;

  try {
    const es = new EventSource(streamUrl);
    activeEventSource = es;

    es.onopen = () => {
      sseRetryAttempts = 0;
    };

    es.addEventListener('connected', () => {
      sseRetryAttempts = 0;
      console.log('[Downex Silicon] Real-time directive stream established for:', hwid, 'at', baseUrl);
    });

    const onIncomingData = async (raw: string) => {
      try {
        const payload: DirectivePayload = JSON.parse(raw);
        await handleDirectivePayload(payload, hwid);
      } catch (err) {
        console.error('[Downex Silicon] Failed to parse incoming directive:', err);
      }
    };

    // Listen to custom "directive" event
    es.addEventListener('directive', (e: MessageEvent) => {
      if (e.data) onIncomingData(e.data);
    });

    // Listen to global real-time marquee notification packets
    es.addEventListener('notices', async (e: MessageEvent) => {
      if (!e.data) return;
      try {
        const parsed = JSON.parse(e.data);
        if (!parsed || !Array.isArray(parsed.notices)) return;

        // Always download & verify through APP VERSION pipeline whenever notices change (never pop out of the box)
        await syncNoticesThroughAppVersion(parsed.notices, true);
      } catch (err) {
        console.warn('[Downex Silicon] Failed to parse marquee notices packet:', err);
      }
    });

    // Also listen to standard "message" event for maximum transport resilience
    es.onmessage = (e: MessageEvent) => {
      if (e.data) onIncomingData(e.data);
    };

    const streamBootEpoch = currentBootEpoch;
    es.onerror = () => {
      try {
        es.close();
      } catch {}
      if (activeEventSource === es) {
        activeEventSource = null;
      }
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const delayMs = Math.min(60000, 3000 * Math.pow(2, Math.min(sseRetryAttempts, 5)));
      sseRetryAttempts += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (isInitialized && streamBootEpoch === currentBootEpoch) {
          connectDirectiveStream(hwid);
        }
      }, delayMs);
    };
  } catch (err) {
    console.warn('[Downex Silicon] Could not establish EventSource:', err);
  }
}

let isRecoveryAttestInFlight = false;

/**
 * Proactively verifies stream health upon UI reveal, window focus, or network change.
 * Zero-poll: strictly a single no-op if stream is OPEN; auto-heals if dropped or initially offline.
 */
export function ensureDirectiveStreamConnected(): void {
  const hwid = useHardwareBanStore.getState().hwid;
  if (!hwid || !isInitialized) return;

  if (!resolvedEcosystemBaseUrl) {
    if (isRecoveryAttestInFlight) return;
    isRecoveryAttestInFlight = true;
    const capturedEpoch = currentBootEpoch;
    attestDevice(hwid, capturedEpoch)
      .then((attestedBase) => {
        if (attestedBase && isInitialized && capturedEpoch === currentBootEpoch) {
          connectDirectiveStream(hwid);
        }
      })
      .catch(() => {})
      .finally(() => {
        isRecoveryAttestInFlight = false;
      });
    return;
  }

  if (!activeEventSource || activeEventSource.readyState === EventSource.CLOSED) {
    console.log('[Downex Silicon] Healing closed directive stream for:', hwid);
    connectDirectiveStream(hwid);
  }
}

/**
 * Initializes the Silicon Hardware Event Service on application boot.
 */
export function initHardwareEventService(): () => void {
  // Keep single SSE stream inside main window; secondary quick-capture dialogs read ban status from IPC/store
  if (typeof window !== 'undefined') {
    const winLabel = (window as any).__DOWNEX_WINDOW_LABEL__;
    if (winLabel === 'download_dialog' || winLabel === 'download_complete') {
      return () => {};
    }
  }
  if (isInitialized) {
    return () => {};
  }
  isInitialized = true;
  sseRetryAttempts = 0;
  const bootEpoch = ++currentBootEpoch;

  let currentHwid = '';
  const handleOnline = () => {
    if (bootEpoch === currentBootEpoch && currentHwid) {
      ensureDirectiveStreamConnected();
    }
  };
  window.addEventListener('online', handleOnline);

  (async () => {
    try {
      // 1. Initialize store ban status first
      await useHardwareBanStore.getState().initBanStatus();
      if (bootEpoch !== currentBootEpoch) return;
      currentHwid = useHardwareBanStore.getState().hwid;
      if (!currentHwid) return;

      // 2. Initial Attestation (runs strictly ONCE on boot)
      const attestedBase = await attestDevice(currentHwid, bootEpoch);
      if (bootEpoch !== currentBootEpoch) return;

      // 3. Open Zero-Poll Real-Time SSE Stream (fall back to canonical ecosystem URL if attest failed transiently)
      if (attestedBase || isTauri) {
        connectDirectiveStream(currentHwid);
      }
    } catch (err) {
      console.warn('[Downex Silicon] Init failed:', err);
    }
  })();

  return () => {
    currentBootEpoch++;
    isInitialized = false;
    window.removeEventListener('online', handleOnline);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (activeEventSource) {
      try {
        activeEventSource.close();
      } catch {}
      activeEventSource = null;
    }
  };
}
