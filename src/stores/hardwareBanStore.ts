import { create } from 'zustand';
import {
  checkIsHardwareBanned,
  getSiliconHardwareId,
  enforceHardwareBan,
  liftHardwareBan,
} from '../services/tauriService';
import { useDownloadStore } from './downloadStore';

const PREBAN_UI_SNAPSHOT_KEY = 'downex_preban_ui_snapshot';
const LEGACY_PREBAN_SIDEBAR_KEY = 'downex_preban_sidebar_collapsed';
const SIDEBAR_STORAGE_KEY = 'downex_sidebar_collapsed';

interface PreBanUiSnapshot {
  sidebarCollapsed: boolean;
  selectedView: string;
  showTelemetryOnHome: boolean;
}

export function capturePreBanUiSnapshot(): void {
  if (typeof window === 'undefined') return;
  try {
    // Only capture once per ban cycle so compacted/restricted UI never overwrites true user settings
    if (localStorage.getItem(PREBAN_UI_SNAPSHOT_KEY) !== null) return;

    const dlState = useDownloadStore.getState();
    const legacySidebar = localStorage.getItem(LEGACY_PREBAN_SIDEBAR_KEY);
    const savedSidebar = legacySidebar ?? localStorage.getItem(SIDEBAR_STORAGE_KEY);

    const snapshot: PreBanUiSnapshot = {
      sidebarCollapsed: savedSidebar === 'true',
      selectedView: dlState.selectedView || 'all',
      showTelemetryOnHome: Boolean(dlState.showTelemetryOnHome),
    };

    localStorage.setItem(PREBAN_UI_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch (err) {
    console.warn('[HardwareBanStore] Failed to capture pre-ban UI snapshot:', err);
  }
}

export function restorePreBanUiSnapshot(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(PREBAN_UI_SNAPSHOT_KEY);
    let restoredSidebar = localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';

    if (raw) {
      const snapshot = JSON.parse(raw) as Partial<PreBanUiSnapshot>;
      if (typeof snapshot.sidebarCollapsed === 'boolean') {
        restoredSidebar = snapshot.sidebarCollapsed;
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(restoredSidebar));
      }
      if (typeof snapshot.selectedView === 'string' && snapshot.selectedView) {
        useDownloadStore.getState().setSelectedView(snapshot.selectedView);
      }
      if (typeof snapshot.showTelemetryOnHome === 'boolean') {
        useDownloadStore.getState().setShowTelemetryOnHome(snapshot.showTelemetryOnHome);
      }
      localStorage.removeItem(PREBAN_UI_SNAPSHOT_KEY);
    } else {
      const legacySidebar = localStorage.getItem(LEGACY_PREBAN_SIDEBAR_KEY);
      if (legacySidebar !== null) {
        restoredSidebar = legacySidebar === 'true';
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(restoredSidebar));
      }
    }

    localStorage.removeItem(LEGACY_PREBAN_SIDEBAR_KEY);

    window.dispatchEvent(
      new CustomEvent('downex-restore-ui-settings', {
        detail: { sidebarCollapsed: restoredSidebar },
      })
    );
  } catch (err) {
    console.warn('[HardwareBanStore] Failed to restore pre-ban UI snapshot:', err);
  }
}

interface HardwareBanState {
  isBanned: boolean;
  isReinstating: boolean;
  hwid: string;
  banReason?: string;
  isInitialized: boolean;

  // Actions
  initBanStatus: () => Promise<void>;
  setReinstating: (val: boolean) => void;
  setBannedLive: (isBanned: boolean, reason?: string) => void;
  enforceBanLive: (reason?: string) => Promise<void>;
  liftBanLive: () => Promise<void>;
}

let initBanInFlight: Promise<void> | null = null;
let liveBanEpoch = 0;

export const useHardwareBanStore = create<HardwareBanState>((set, get) => {
  let initialIsBanned = false;
  let initialReason: string | undefined = undefined;
  if (typeof window !== 'undefined') {
    try {
      initialIsBanned = localStorage.getItem('downex_is_hardware_banned') === 'true';
      initialReason = localStorage.getItem('downex_hardware_ban_reason') || undefined;
    } catch {}
  }

  return {
    isBanned: initialIsBanned,
    isReinstating: false,
    hwid: '',
    banReason: initialReason,
    isInitialized: false,

    setReinstating: (val: boolean) => set({ isReinstating: val }),

    initBanStatus: async () => {
      if (initBanInFlight) return initBanInFlight;
      const capturedEpoch = liveBanEpoch;
      initBanInFlight = (async () => {
        try {
          const hwid = await getSiliconHardwareId();
          const isBanned = await checkIsHardwareBanned();
          if (capturedEpoch !== liveBanEpoch) {
            // Live SSE ban/unban directive superseded boot check; preserve HWID without overwriting live ban state
            set({ hwid, isInitialized: true });
            return;
          }
          let reason: string | undefined = undefined;
          try {
            reason = localStorage.getItem('downex_hardware_ban_reason') || undefined;
          } catch {}

          if (isBanned) {
            capturePreBanUiSnapshot();
          } else {
            restorePreBanUiSnapshot();
          }

          set({
            hwid,
            isBanned,
            banReason: isBanned ? reason : undefined,
            isInitialized: true,
          });
        } catch (err) {
          console.warn('[HardwareBanStore] Init failed:', err);
        } finally {
          initBanInFlight = null;
        }
      })();
      return initBanInFlight;
    },

    setBannedLive: (isBanned: boolean, reason?: string) => {
      liveBanEpoch += 1;
      try {
        localStorage.setItem('downex_is_hardware_banned', String(isBanned));
        if (reason && isBanned) {
          localStorage.setItem('downex_hardware_ban_reason', reason);
        } else if (!isBanned) {
          localStorage.removeItem('downex_hardware_ban_reason');
        }

        if (isBanned) {
          capturePreBanUiSnapshot();
        } else {
          restorePreBanUiSnapshot();
        }
      } catch {}

      if (isBanned) {
        useDownloadStore.setState({
          isNewModalOpen: false,
          completeModalPayload: null,
          isQueueGuideOpen: false,
        });
      }

      set({
        isBanned,
        banReason: isBanned ? (reason || get().banReason) : undefined,
      });
    },

    enforceBanLive: async (reason?: string) => {
      liveBanEpoch += 1;
      const banReason = reason || 'You have been banned from ADMIN';

      // Preserve exact user UI/menu/layout settings before compacting into banned view
      capturePreBanUiSnapshot();

      // Dismiss any open workspace modals so HardwareBannedView is never obscured
      useDownloadStore.setState({
        isNewModalOpen: false,
        completeModalPayload: null,
        isQueueGuideOpen: false,
      });

      // 1. Immediately update reactive Zustand state synchronously
      set({
        isBanned: true,
        isReinstating: false,
        banReason,
      });

      // 2. Persist to native Rust & local storage anchors
      try {
        await enforceHardwareBan(banReason);
      } catch (err) {
        console.warn('[HardwareBanStore] Native enforce ban error:', err);
      }
    },

    liftBanLive: async () => {
      liveBanEpoch += 1;
      // 1. Restore exact pre-ban UI/menu/sidebar settings
      restorePreBanUiSnapshot();

      try {
        localStorage.setItem('downex_is_hardware_banned', 'false');
        localStorage.removeItem('downex_hardware_ban_reason');
      } catch {}

      // 2. Update reactive Zustand state synchronously
      set({
        isBanned: false,
        banReason: undefined,
      });

      // 3. Clear native Rust & local storage anchors
      try {
        await liftHardwareBan();
      } catch (err) {
        console.warn('[HardwareBanStore] Native lift ban error:', err);
      }
    },
  };
});

if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as any).__DOWNEX_BAN_STORE__ = useHardwareBanStore;
}
