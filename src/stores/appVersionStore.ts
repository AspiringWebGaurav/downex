import { create } from 'zustand';
import {
  getResolvedVersion,
  syncWindowsInstalledVersion,
  cleanSupersededOldBinaries,
  getStagedUpdate,
} from '../services/tauriService';
import { updateService, UpdateStatus } from '../services/updateService';
import { cleanVersion, formatVersion, compareSemver } from '../utils/version';
import { getLatestCodebaseVersion } from '../data/patchNotes';

const PERSISTED_UPDATE_KEY = 'downex_persisted_update_status';

export interface PatchNotesInfo {
  version: string;
  previousVersion: string;
  notes: string;
}

interface AppVersionStore {
  currentVersion: string;
  formattedVersion: string;
  status: UpdateStatus;
  isModalOpen: boolean;
  isToastDismissed: boolean;
  patchNotes: PatchNotesInfo | null;
  isPatchNotesOpen: boolean;
  dismissToast: () => void;
  showToast: () => void;
  initVersion: () => Promise<void>;
  checkForUpdates: (silent?: boolean) => Promise<void>;
  downloadUpdate: () => Promise<boolean>;
  installAndRestart: () => Promise<void>;
  openModal: () => void;
  closeModal: () => void;
  openPatchNotes: () => void;
  closePatchNotes: () => void;
}

export const useAppVersionStore = create<AppVersionStore>((set, get) => {
  const initialDismissed = (() => {
    try {
      return sessionStorage.getItem('downex_toast_dismissed') === 'true';
    } catch {
      return false;
    }
  })();

  const initialCodebaseVer = getLatestCodebaseVersion();

  return {
    currentVersion: initialCodebaseVer,
    formattedVersion: formatVersion(initialCodebaseVer),
    status: updateService.getStatus(),
    isModalOpen: false,
    isToastDismissed: initialDismissed,
    patchNotes: null,
    isPatchNotesOpen: false,

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

    openPatchNotes: () => {
      set({ isPatchNotesOpen: true });
    },

    closePatchNotes: () => {
      try {
        localStorage.removeItem('downex_recently_updated');
      } catch {}
      set({ isPatchNotesOpen: false, patchNotes: null });
    },

    initVersion: async () => {
      try {
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
          const recentUpdateRaw = localStorage.getItem('downex_recently_updated');
          let recentUpdateData: any = null;
          if (recentUpdateRaw) {
            try {
              recentUpdateData = JSON.parse(recentUpdateRaw);
            } catch {}
          }

          const hasUpgraded = lastVersion && compareSemver(cleaned, lastVersion) > 0;
          const isTargetAchieved =
            recentUpdateData &&
            recentUpdateData.targetVersion &&
            compareSemver(cleaned, recentUpdateData.previousVersion || '0.0.0') > 0;

          if (hasUpgraded || isTargetAchieved) {
            const targetVer = recentUpdateData?.targetVersion || cleaned;
            const prevVer = recentUpdateData?.previousVersion || lastVersion || '0.0.0';
            const notes = recentUpdateData?.notes || '';

            set({
              patchNotes: {
                version: targetVer,
                previousVersion: prevVer,
                notes: notes,
              },
              isPatchNotesOpen: true,
            });

            localStorage.removeItem(PERSISTED_UPDATE_KEY);
            cleanSupersededOldBinaries().catch(() => {});
          } else if (recentUpdateData && recentUpdateData.targetVersion) {
            // Target was NOT achieved (e.g. rolled back or restart was aborted)
            // Clean up stale recently_updated so patch notes are not erroneously shown later
            localStorage.removeItem('downex_recently_updated');
          }
          localStorage.setItem('downex_last_known_version', cleaned);
          localStorage.setItem('downex_persisted_version', cleaned);
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

        // Silent background check 1.2s after boot (GPN pattern)
        setTimeout(() => {
          get().checkForUpdates(true).catch(() => {});
        }, 1200);
      } catch (err) {
        console.warn('[Downex Version] Failed to initialize version:', err);
      }
    },

    checkForUpdates: async (silent = false) => {
      await updateService.checkForUpdates(silent);
    },

    downloadUpdate: async () => {
      return await updateService.downloadUpdate();
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
    if (isNewAvailable || isNewReady) {
      try {
        sessionStorage.removeItem('downex_toast_dismissed');
      } catch {}
    }

    return {
      status: { ...status },
      isToastDismissed: isNewAvailable || isNewReady ? false : (state?.isToastDismissed ?? false),
    };
  });

  // Persist update status across refreshes/restarts
  const curVer = useAppVersionStore.getState()?.currentVersion || getLatestCodebaseVersion();
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
