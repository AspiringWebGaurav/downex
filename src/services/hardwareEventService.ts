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
import { useMarqueeNoticeStore } from '../stores/marqueeNoticeStore';
import { updateService } from './updateService';
import { APP_BASE_VERSION } from '../utils/version';

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

  if (typeof window !== 'undefined') {
    try {
      const custom = localStorage.getItem('downex_custom_api_url');
      if (custom) return custom;
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
let isInitialized = false;
let isProcessingTransition = false;

interface DirectivePayload {
  action: 'BAN' | 'UNBAN' | 'hardware_ban' | 'hardware_unban' | 'HARDWARE_BAN' | 'HARDWARE_UNBAN' | string;
  target_hwid?: string;
  reason?: string;
  timestamp?: number;
}

/**
 * Handles incoming directives from either SSE stream or attestation fallback.
 */
export async function handleDirectivePayload(payload: DirectivePayload, hwid: string): Promise<void> {
  if (!payload || !payload.action || isProcessingTransition) return;

  const target = (payload.target_hwid || '').trim().toUpperCase();
  const current = hwid.trim().toUpperCase();

  if (target === current || target === '*' || !target) {
    const actionUpper = payload.action.toUpperCase();

    if (actionUpper === 'BAN' || actionUpper === 'HARDWARE_BAN') {
      const currentBanState = useHardwareBanStore.getState().isBanned;
      if (currentBanState) return; // Already banned, skip animation

      isProcessingTransition = true;
      try {
        console.warn('[Downex Silicon] Instant REALTIME BAN directive received:', payload);

        // 1. Stage progression animation on sidebar App Version
        updateService.notify({ state: 'checking', isManualCheck: true });
        await new Promise((resolve) => setTimeout(resolve, 300));

        updateService.notify({ state: 'verifying', isManualCheck: true });
        await new Promise((resolve) => setTimeout(resolve, 350));

        updateService.notify({ state: 'patching', isManualCheck: true });
        await new Promise((resolve) => setTimeout(resolve, 450));

        // 2. Enforce live ban instantly in React store & native Rust
        await useHardwareBanStore.getState().enforceBanLive(payload.reason || 'You have been banned from ADMIN');

        // 3. Clear updating state
        updateService.notify({ state: 'idle', isManualCheck: false });
      } finally {
        isProcessingTransition = false;
      }
    } else if (actionUpper === 'UNBAN' || actionUpper === 'HARDWARE_UNBAN') {
      const currentBanState = useHardwareBanStore.getState().isBanned;
      if (!currentBanState) return; // Already unbanned, skip animation

      isProcessingTransition = true;
      try {
        console.log('[Downex Silicon] Instant REALTIME UNBAN directive received:', payload);
        const startedAt = Date.now();

        // 1. Enter 1.5s restoring state on live UI while keeping sidebar cleanly locked
        useHardwareBanStore.getState().setReinstating(true);

        // 2. Stage progression animation on sidebar App Version
        updateService.notify({ state: 'verifying', isManualCheck: true });
        await new Promise((resolve) => setTimeout(resolve, 350));

        updateService.notify({ state: 'installing', isManualCheck: true });
        await new Promise((resolve) => setTimeout(resolve, 450));

        // 3. Lift ban and reinstate saved user settings (sidebar, menu, layout)
        await useHardwareBanStore.getState().liftBanLive();

        // 4. Hold clean loader until ~1.5s total transition completes so user sees reinstatement
        const remainingMs = Math.max(0, 1500 - (Date.now() - startedAt));
        if (remainingMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, remainingMs));
        }

        // 5. Reveal restored workspace & sidebar
        useHardwareBanStore.getState().setReinstating(false);

        // 6. Show clean UP TO DATE completion for 2.5s
        updateService.notify({ state: 'up-to-date', isManualCheck: true });
        setTimeout(() => {
          updateService.notify({ state: 'idle', isManualCheck: false });
        }, 2500);
      } finally {
        useHardwareBanStore.getState().setReinstating(false);
        isProcessingTransition = false;
      }
    }
  }
}

/**
 * Attests device to remote ecosystem registry and verifies permission state.
 * Probes candidate URLs safely and locks onto the first responsive endpoint.
 */
async function attestDevice(hwid: string): Promise<string> {
  const preferred = getEcosystemBaseUrl();
  const candidates = isLocalDevRuntime()
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
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const res = await fetch(`${candidate}/api/downex/attest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hwid,
          version: APP_BASE_VERSION,
          os: 'Windows 11 x64 (NTFS Silicon Enforced)',
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        resolvedEcosystemBaseUrl = candidate;
        const data = await res.json();
        if (data && Array.isArray(data.notices)) {
          useMarqueeNoticeStore.getState().setNotices(data.notices, false);
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
    }
  }
  return preferred;
}

/**
 * Connects to the real-time SSE directive stream for this machine.
 */
function connectDirectiveStream(hwid: string): void {
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

    es.addEventListener('connected', () => {
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

        if (parsed.is_initial === true) {
          // Silent initial sync on connect
          useMarqueeNoticeStore.getState().setNotices(parsed.notices, false);
          return;
        }

        // Live packet from Admin: animate APP VERSION stage progression just like BAN/UNBAN packets
        if (!isProcessingTransition) {
          isProcessingTransition = true;
          try {
            updateService.notify({ state: 'checking', isManualCheck: true });
            await new Promise((resolve) => setTimeout(resolve, 280));

            updateService.notify({ state: 'verifying', isManualCheck: true });
            await new Promise((resolve) => setTimeout(resolve, 320));

            updateService.notify({ state: 'patching', isManualCheck: true });
            await new Promise((resolve) => setTimeout(resolve, 380));

            useMarqueeNoticeStore.getState().setNotices(parsed.notices, true);

            updateService.notify({ state: 'up-to-date', isManualCheck: true });
            setTimeout(() => {
              updateService.notify({ state: 'idle', isManualCheck: false });
            }, 2200);
          } finally {
            isProcessingTransition = false;
          }
        } else {
          useMarqueeNoticeStore.getState().setNotices(parsed.notices, true);
        }
      } catch (err) {
        console.warn('[Downex Silicon] Failed to parse marquee notices packet:', err);
      }
    });

    // Also listen to standard "message" event for maximum transport resilience
    es.onmessage = (e: MessageEvent) => {
      if (e.data) onIncomingData(e.data);
    };

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          if (isInitialized) {
            connectDirectiveStream(hwid);
          }
        }, 3000);
      }
    };
  } catch (err) {
    console.warn('[Downex Silicon] Could not establish EventSource:', err);
  }
}

/**
 * Proactively verifies stream health upon UI reveal, window focus, or network change.
 * Zero-poll: strictly a single no-op if stream is OPEN; auto-heals if dropped.
 */
export function ensureDirectiveStreamConnected(): void {
  const hwid = useHardwareBanStore.getState().hwid;
  if (!hwid || !isInitialized) return;

  if (!activeEventSource || activeEventSource.readyState === EventSource.CLOSED) {
    console.log('[Downex Silicon] Healing closed directive stream for:', hwid);
    connectDirectiveStream(hwid);
  }
}

/**
 * Initializes the Silicon Hardware Event Service on application boot.
 */
export function initHardwareEventService(): () => void {
  if (isInitialized) {
    return () => {};
  }
  isInitialized = true;

  let currentHwid = '';

  (async () => {
    try {
      // 1. Initialize store ban status first
      await useHardwareBanStore.getState().initBanStatus();
      currentHwid = useHardwareBanStore.getState().hwid;
      if (!currentHwid) return;

      // 2. Initial Attestation (runs strictly ONCE on boot)
      await attestDevice(currentHwid);

      // 3. Open Zero-Poll Real-Time SSE Stream (pure push from Firebase RTDB)
      connectDirectiveStream(currentHwid);

      // 4. Re-connect on network recovery
      window.addEventListener('online', () => {
        if (currentHwid) {
          connectDirectiveStream(currentHwid);
        }
      });
    } catch (err) {
      console.warn('[Downex Silicon] Init failed:', err);
    }
  })();

  return () => {
    isInitialized = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (activeEventSource) {
      try {
        activeEventSource.close();
      } catch {}
      activeEventSource = null;
    }
  };
}
