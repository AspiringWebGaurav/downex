import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import {
  isTauri,
  getResolvedVersion,
  syncWindowsInstalledVersion,
  cleanSupersededOldBinaries,
  getStagedUpdate,
  getPendingUpdate,
  resetToBaseAppDev,
} from '../services/tauriService';
import { updateService, UpdateStatus } from '../services/updateService';
import { APP_BASE_VERSION, cleanVersion, formatVersion, compareSemver } from '../utils/version';

const PERSISTED_UPDATE_KEY = 'downex_persisted_update_status';

interface AppVersionStore {
  currentVersion: string;
  formattedVersion: string;
  status: UpdateStatus;
  isModalOpen: boolean;
  isToastDismissed: boolean;
  isDeferredDueToDownloads: boolean;
  onDownloadsCompleted: () => void;
  dismissToast: () => void;
  showToast: () => void;
  initVersion: () => Promise<void>;
  checkForUpdates: (silent?: boolean) => Promise<void>;
  evaluateAndApplyUpdate: () => Promise<void>;
  downloadUpdate: () => Promise<boolean>;
  downloadAndApplyUpdate: () => Promise<boolean>;
  installAndRestart: () => Promise<void>;
  openModal: () => void;
  closeModal: () => void;
  resetToBaseApp: (invokeNative?: boolean) => Promise<void>;
}

let isResettingBaseApp = false;

export const useAppVersionStore = create<AppVersionStore>((set, get) => {
  const initialDismissed = (() => {
    try {
      return sessionStorage.getItem('downex_toast_dismissed') === 'true';
    } catch {
      return false;
    }
  })();

  const initialCodebaseVer = APP_BASE_VERSION;

  return {
    currentVersion: initialCodebaseVer,
    formattedVersion: formatVersion(initialCodebaseVer),
    status: updateService.getStatus(),
    isModalOpen: false,
    isToastDismissed: initialDismissed,

    resetToBaseApp: async (invokeNative = true) => {
      if (isResettingBaseApp) return;
      isResettingBaseApp = true;
      try {
        try {
          localStorage.removeItem(PERSISTED_UPDATE_KEY);
          localStorage.removeItem('downex_recently_updated');
          localStorage.removeItem('downex_simulated_version');
          localStorage.removeItem('downex_toast_dismissed');
          localStorage.setItem('downex_last_known_version', APP_BASE_VERSION);
          localStorage.setItem('downex_persisted_version', APP_BASE_VERSION);
          localStorage.setItem('downex_autostart_enabled', 'true');
          localStorage.setItem('downex_close_to_tray', 'true');
        } catch {}

        if (invokeNative) {
          try {
            await resetToBaseAppDev();
          } catch (err) {
            console.warn('[Downex Store] Native dev reset error:', err);
          }
        }

        updateService.resetToBaseVersion();

        set({
          currentVersion: APP_BASE_VERSION,
          formattedVersion: formatVersion(APP_BASE_VERSION),
          status: {
            state: 'idle',
            currentVersion: APP_BASE_VERSION,
          },
          isModalOpen: false,
          isToastDismissed: false,
          isDeferredDueToDownloads: false,
        });
      } finally {
        isResettingBaseApp = false;
      }
    },

    isDeferredDueToDownloads: false,
    onDownloadsCompleted: async () => {
      set({ isDeferredDueToDownloads: false, isToastDismissed: false });
      try {
        const pending = await getPendingUpdate();
        const currentVer = get().currentVersion;
        if (pending && pending.version && compareSemver(cleanVersion(pending.version), currentVer) > 0) {
          updateService.isDeferredDueToDownloads = false;
          updateService.notify({
            state: 'available',
            targetVersion: cleanVersion(pending.version),
            manifest: pending,
          });
          const { setTrayIcon } = await import('../services/tauriService');
          setTrayIcon('update_available').catch(() => {});
        }
      } catch {}
    },
    dismissToast: () => {
      try {
        sessionStorage.setItem('downex_toast_dismissed', 'true');
      } catch {}
      set({ isToastDismissed: true });
    },

    showToast: () => {
      try {
        sessionStorage.removeItem('downex_toast_dismissed');
      } catch {}
      set({ isToastDismissed: false });
    },

    initVersion: async () => {
      try {
        // In dev mode, clean legacy pre-purge test keys (>= 0.0.40) from local storage on startup
        if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) {
          try {
            const persisted = localStorage.getItem('downex_persisted_version');
            const lastVer = localStorage.getItem('downex_last_known_version');
            if (
              (persisted && compareSemver(cleanVersion(persisted), '0.0.40') >= 0) ||
              (lastVer && compareSemver(cleanVersion(lastVer), '0.0.40') >= 0)
            ) {
              localStorage.removeItem('downex_persisted_version');
              localStorage.removeItem('downex_last_known_version');
              localStorage.removeItem('downex_recently_updated');
              localStorage.removeItem(PERSISTED_UPDATE_KEY);
            }
          } catch {}
        }

        const rawVer = await getResolvedVersion();
        const cleaned = cleanVersion(rawVer);
        set({
          currentVersion: cleaned,
          formattedVersion: formatVersion(cleaned),
        });
        updateService.setCurrentVersion(cleaned);

        // Pre-sync Windows Registry with active runtime version
        await syncWindowsInstalledVersion(cleaned);

        // Version upgrade transition check (GPN pattern)
        try {
          const lastVersion = localStorage.getItem('downex_last_known_version');
          const hasUpgraded = lastVersion && compareSemver(cleaned, lastVersion) > 0;
          const wasRecentlyUpdated = Boolean(localStorage.getItem('downex_recently_updated') || hasUpgraded);

          if (hasUpgraded) {
            localStorage.removeItem(PERSISTED_UPDATE_KEY);
            cleanSupersededOldBinaries().catch(() => {});
          }
          localStorage.setItem('downex_last_known_version', cleaned);
          localStorage.setItem('downex_persisted_version', cleaned);

          if (wasRecentlyUpdated) {
            // One-time post-update verification check: shows "UP TO DATE" on sidebar for 3.5s after fresh update restart
            setTimeout(async () => {
              try {
                await get().checkForUpdates(false);
              } catch (e) {
                console.warn('[Downex Store] Post-update verification notice:', e);
              } finally {
                try {
                  localStorage.removeItem('downex_recently_updated');
                } catch {}
              }
            }, 1200);
          }
        } catch {}

        // Restore persisted update status across refreshes/restarts
        try {
          const saved = localStorage.getItem(PERSISTED_UPDATE_KEY);
          if (saved) {
            const data = JSON.parse(saved);
            const manifest: any = data.manifest || data;
            const targetVersion = cleanVersion(data.targetVersion || manifest?.version || '');
            const hasUrl = manifest && (manifest.url || manifest.platforms?.['windows-x86_64']?.url);

            if (manifest && hasUrl && targetVersion && compareSemver(targetVersion, cleaned) > 0) {
              // Check if staged binary is already present on disk
              const stagedOnDisk = await getStagedUpdate(targetVersion);
              const stagedPath = stagedOnDisk || data.stagedPath;

              if (stagedPath && (stagedOnDisk || data.state === 'ready')) {
                updateService.setStagedBinaryPath(stagedPath);
                updateService.notify({
                  state: 'ready',
                  manifest,
                  targetVersion,
                  stagedPath,
                });
              } else {
                updateService.notify({
                  state: 'available',
                  manifest,
                  targetVersion,
                });
              }
            } else {
              localStorage.removeItem(PERSISTED_UPDATE_KEY);
              updateService.notify({
                state: 'idle',
                manifest: null,
                targetVersion: undefined,
                errorMessage: undefined,
              });
            }
          }
        } catch {}

        // In browser dev preview / Playwright mock mode outside Tauri: schedule silent check to support route mocks
        if (!isTauri) {
          setTimeout(() => {
            get().checkForUpdates(true).catch(() => {});
          }, 1200);
        }

        // Re-synchronize on window focus when unminimized from tray (zero network requests)
        if (typeof window !== 'undefined' && !(window as any).__DOWNEX_FOCUS_SYNC_WIRED__) {
          (window as any).__DOWNEX_FOCUS_SYNC_WIRED__ = true;
          window.addEventListener('focus', async () => {
            try {
              await updateService.evaluateAndApplyUpdate();
            } catch {}
          });
        }
        // Listen for native dev reset event
        if (isTauri && typeof window !== 'undefined' && !(window as any).__DOWNEX_BASE_RESET_LISTENER__) {
          (window as any).__DOWNEX_BASE_RESET_LISTENER__ = true;
          listen('downex-base-app-reset', () => {
            get().resetToBaseApp(false);
          }).catch(() => {});
        }
      } catch (err) {
        console.warn('[Downex Version] Failed to initialize version:', err);
      }
    },

    checkForUpdates: async (silent = false) => {
      await updateService.checkForUpdates(silent);
    },

    evaluateAndApplyUpdate: async () => {
      await updateService.evaluateAndApplyUpdate();
    },

    downloadUpdate: async () => {
      return await updateService.downloadUpdate();
    },

    downloadAndApplyUpdate: async () => {
      return await updateService.downloadAndApplyUpdate();
    },

    installAndRestart: async () => {
      await updateService.installAndRestart();
    },

    openModal: () => {
      set({ isModalOpen: true });
    },

    closeModal: () => {
      set({ isModalOpen: false });
      if (updateService.getStatus().state === 'up-to-date') {
        updateService.notify({ state: 'idle', isManualCheck: false });
      }
    },
  };
});

// Subscribe to updateService events AFTER store creation so state is always defined
updateService.subscribe((status) => {
  useAppVersionStore.setState((state) => {
    const isNewAvailable = status.state === 'available' && state?.status?.state !== 'available';
    const isNewReady = status.state === 'ready' && state?.status?.state !== 'ready';
    const isDownloadingOrVerifying = status.state === 'downloading' || status.state === 'verifying';
    const shouldShowToast = isNewAvailable || isNewReady || isDownloadingOrVerifying;
    if (shouldShowToast) {
      try {
        sessionStorage.removeItem('downex_toast_dismissed');
      } catch {}
    }

    const nextCurrentVersion = status.currentVersion || state?.currentVersion || APP_BASE_VERSION;
    return {
      status: { ...status },
      currentVersion: nextCurrentVersion,
      formattedVersion: formatVersion(nextCurrentVersion),
      isToastDismissed: shouldShowToast ? false : (state?.isToastDismissed ?? false),
    };
  });

  // Persist update status across refreshes/restarts
  const curVer = useAppVersionStore.getState()?.currentVersion || APP_BASE_VERSION;
  const isTargetNewer = Boolean(status.targetVersion && compareSemver(status.targetVersion, curVer) > 0);

  if ((status.state === 'available' || status.state === 'ready') && status.manifest && isTargetNewer) {
    try {
      localStorage.setItem(
        PERSISTED_UPDATE_KEY,
        JSON.stringify({
          state: status.state,
          manifest: status.manifest,
          targetVersion: status.targetVersion,
          stagedPath: status.stagedPath,
          timestamp: Date.now(),
        })
      );
    } catch {}
  } else if (status.state === 'up-to-date' || status.state === 'idle' || !isTargetNewer) {
    try {
      localStorage.removeItem(PERSISTED_UPDATE_KEY);
    } catch {}
  }
});
