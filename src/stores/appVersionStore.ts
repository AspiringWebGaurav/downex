import { create } from 'zustand';
import { getResolvedVersion, syncWindowsInstalledVersion } from '../services/tauriService';
import { updateService, UpdateStatus } from '../services/updateService';
import { cleanVersion, formatVersion, compareSemver } from '../utils/version';

const PERSISTED_UPDATE_KEY = 'downex_persisted_update_status';

interface AppVersionStore {
  currentVersion: string;
  formattedVersion: string;
  status: UpdateStatus;
  isModalOpen: boolean;
  initVersion: () => Promise<void>;
  checkForUpdates: (silent?: boolean) => Promise<void>;
  downloadUpdate: () => Promise<boolean>;
  installAndRestart: () => Promise<void>;
  openModal: () => void;
  closeModal: () => void;
}

export const useAppVersionStore = create<AppVersionStore>((set, get) => {
  // Subscribe to updateService events
  updateService.subscribe((status) => {
    set({ status: { ...status } });

    // Persist available status across restarts
    if (status.state === 'available' && status.manifest) {
      try {
        localStorage.setItem(PERSISTED_UPDATE_KEY, JSON.stringify(status.manifest));
      } catch {}
    } else if (status.state === 'up-to-date' || status.state === 'idle') {
      try {
        localStorage.removeItem(PERSISTED_UPDATE_KEY);
      } catch {}
    }
  });

  return {
    currentVersion: '0.0.0',
    formattedVersion: 'v0.0.0',
    status: updateService.getStatus(),
    isModalOpen: false,

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

        // Restore persisted manifest if newer than running version
        try {
          const saved = localStorage.getItem(PERSISTED_UPDATE_KEY);
          if (saved) {
            const manifest = JSON.parse(saved);
            if (manifest && compareSemver(manifest.version, cleaned) > 0) {
              updateService['notify']({
                state: 'available',
                manifest,
                targetVersion: cleanVersion(manifest.version),
              });
            } else {
              localStorage.removeItem(PERSISTED_UPDATE_KEY);
            }
          }
        } catch {}

        // Silent background check 2.5s after boot
        setTimeout(() => {
          get().checkForUpdates(true).catch(() => {});
        }, 2500);
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
    },
  };
});
