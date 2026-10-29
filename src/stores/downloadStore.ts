import { create } from 'zustand';
import { DownloadItem, DownloadProgressEvent } from '../types/download';
import { 
  addDownload, 
  cancelDownload, 
  changeDownloadDestination, 
  getDownloads, 
  onDownloadProgress, 
  pauseDownload, 
  resumeDownload,
  startQueue,
  pauseQueue,
  isQueueRunning,
  queueDownload,
  onRefreshDownloads,
  DownloadInfoModalPayload,
  getLifetimeDownloadedBytes,
  setLifetimeDownloadedBytes,
} from '../services/tauriService';

interface DownloadStore {
  items: DownloadItem[];
  selectedView: string;
  searchQuery: string;
  isNewModalOpen: boolean;
  isStandaloneModal: boolean;
  setIsStandaloneModal: (val: boolean) => void;
  initialModalData?: DownloadInfoModalPayload;
  openNewModalWithData: (data: DownloadInfoModalPayload) => void;
  totalSpeed: number;
  speedHistory: number[];
  peakSpeed: number;
  lifetimeDownloadedBytes: number;
  sessionDownloadedBytes: number;
  showTelemetryOnHome: boolean;
  setShowTelemetryOnHome: (val: boolean) => void;

  isQueueRunning: boolean;
  startQueue: () => Promise<void>;
  pauseQueue: () => Promise<void>;
  queueDownload: (id: string) => Promise<void>;
  loadItems: () => Promise<void>;
  initLifetimeStats: () => Promise<void>;
  syncLifetimeStatsToDb: () => Promise<void>;
  addNewDownload: (url: string, folder?: string, queue?: string, headers?: Record<string, string>, startImmediately?: boolean, customFilename?: string) => Promise<void>;
  changeFolderAndRetry: (id: string, newFolder: string) => Promise<void>;
  togglePause: (id: string) => Promise<void>;
  removeDownload: (id: string, deleteFile?: boolean) => Promise<void>;
  setSelectedView: (view: string) => void;
  setSearchQuery: (query: string) => void;
  setNewModalOpen: (open: boolean) => void;
  initListener: () => () => void;
}

export const useDownloadStore = create<DownloadStore>((set, get) => ({
  items: [],
  selectedView: 'all',
  searchQuery: '',
  isNewModalOpen: false,
  isStandaloneModal: false,
  setIsStandaloneModal: (val: boolean) => set({ isStandaloneModal: val }),
  totalSpeed: 0,
  speedHistory: Array(20).fill(0),
  peakSpeed: 0,
  lifetimeDownloadedBytes: 0,
  sessionDownloadedBytes: 0,
  isQueueRunning: false,
  showTelemetryOnHome: (() => {
    try {
      return localStorage.getItem('downex_show_telemetry_on_home') === 'true';
    } catch {
      return false;
    }
  })(),
  setShowTelemetryOnHome: (val: boolean) => {
    try {
      localStorage.setItem('downex_show_telemetry_on_home', String(val));
    } catch (e) {
      console.warn('Failed to save telemetry setting to localStorage:', e);
    }
    set({ showTelemetryOnHome: val });
  },

  loadItems: async () => {
    try {
      const [dbItems, queueRunning] = await Promise.all([
        getDownloads(),
        isQueueRunning(),
      ]);
      set((state) => {
        const merged = dbItems.map((dbItem) => {
          const existing = state.items.find((i) => i.id === dbItem.id);
          // Database status is absolute authority for terminal/settled states
          const isTerminalState = dbItem.status === 'completed' || dbItem.status === 'paused' || dbItem.status === 'failed';
          const isDownloading = !isTerminalState && (dbItem.status === 'downloading' || existing?.status === 'downloading');
          const speed = isDownloading
            ? Math.max(existing?.speed_bytes_sec || 0, dbItem.speed_bytes_sec || 0)
            : 0;

          let eta = isDownloading ? existing?.eta_seconds : null;
          if (!eta && isDownloading && speed > 0 && dbItem.total_bytes && dbItem.total_bytes > dbItem.downloaded_bytes) {
            eta = Math.max(1, Math.round((dbItem.total_bytes - dbItem.downloaded_bytes) / speed));
          }

          return {
            ...dbItem,
            status: isTerminalState ? dbItem.status : (isDownloading ? 'downloading' : dbItem.status),
            // Preserve live in-memory segments and active download metrics only while downloading
            segments: isDownloading && existing?.segments && existing.segments.length > 0 ? existing.segments : dbItem.segments,
            speed_bytes_sec: speed,
            eta_seconds: eta,
          };
        });
        return { items: merged, isQueueRunning: queueRunning };
      });
      // Ensure lifetime stats baseline is synchronized with loaded items
      const itemsSum = get().items.reduce((acc, i) => acc + (i.downloaded_bytes || 0), 0);
      if (itemsSum > get().lifetimeDownloadedBytes) {
        set({ lifetimeDownloadedBytes: itemsSum });
      }
    } catch (e) {
      console.warn('Failed to load downloads:', e);
    }
  },

  initLifetimeStats: async () => {
    try {
      const dbBytes = await getLifetimeDownloadedBytes();
      const itemsSum = get().items.reduce((acc, i) => acc + (i.downloaded_bytes || 0), 0);
      const initial = Math.max(dbBytes, itemsSum);
      set({ lifetimeDownloadedBytes: initial });
    } catch (e) {
      console.warn('Failed to initialize lifetime downloaded bytes:', e);
    }
  },

  syncLifetimeStatsToDb: async () => {
    try {
      const current = get().lifetimeDownloadedBytes;
      if (current > 0) {
        await setLifetimeDownloadedBytes(current);
      }
    } catch (e) {
      console.warn('Failed to sync lifetime stats to db:', e);
    }
  },

  startQueue: async () => {
    try {
      await startQueue();
      set({ isQueueRunning: true });
      await get().loadItems();
    } catch (e) {
      console.warn('Failed to start queue:', e);
    }
  },

  pauseQueue: async () => {
    try {
      await pauseQueue();
      set({ isQueueRunning: false });
      await get().loadItems();
    } catch (e) {
      console.warn('Failed to pause queue:', e);
    }
  },

  queueDownload: async (id: string) => {
    try {
      await queueDownload(id);
      await get().loadItems();
    } catch (e) {
      console.warn('Failed to queue download:', e);
    }
  },

  addNewDownload: async (url: string, folder?: string, queue?: string, headers?: Record<string, string>, startImmediately = true, customFilename?: string) => {
    const item = await addDownload(url, folder, queue, headers, startImmediately, customFilename);
    set((state) => ({ items: [item, ...state.items] }));
  },

  changeFolderAndRetry: async (id: string, newFolder: string) => {
    try {
      await changeDownloadDestination(id, newFolder);
      await get().loadItems();
    } catch (err) {
      console.error('Failed to change download destination:', err);
    }
  },

  togglePause: async (id: string) => {
    const item = get().items.find((i) => i.id === id);
    if (!item) return;

    if (item.status === 'downloading' || item.status === 'probing') {
      await pauseDownload(id);
      set((state) => ({
        items: state.items.map((i) => (i.id === id ? { ...i, status: 'paused', speed_bytes_sec: 0 } : i)),
      }));
    } else {
      await resumeDownload(id);
      set((state) => ({
        items: state.items.map((i) => (i.id === id ? { ...i, status: 'downloading' } : i)),
      }));
    }
  },

  removeDownload: async (id: string, deleteFile = false) => {
    await cancelDownload(id, deleteFile);
    set((state) => ({ items: state.items.filter((i) => i.id !== id) }));
  },

  setSelectedView: (view: string) => set({ selectedView: view }),
  setSearchQuery: (query: string) => set({ searchQuery: query }),
  setNewModalOpen: (open: boolean) =>
    set({
      isNewModalOpen: open,
      initialModalData: open ? get().initialModalData : undefined,
      isStandaloneModal: open ? get().isStandaloneModal : false,
    }),
  openNewModalWithData: (data: DownloadInfoModalPayload) =>
    set({
      isNewModalOpen: true,
      initialModalData: data,
      isStandaloneModal: !!data.standalone_modal,
    }),

  initListener: () => {
    // 0. Initialize persistent lifetime counter from SQLite DB
    get().initLifetimeStats().catch(() => {});

    // In-memory delta tracker per task ID for zero-overhead, byte-accurate accumulation
    const taskDownloadedCache = new Map<string, number>();
    let isLifetimeDirty = false;

    // 1. High-frequency push event listener from Tauri Rust backend
    const unlistenProgress = onDownloadProgress((event: DownloadProgressEvent) => {
      set((state) => {
        let currentTotalSpeed = 0;
        let taskFinished = false;
        let itemFound = false;

        // Byte-accurate accumulation without disk I/O thrashing
        const prevBytes = taskDownloadedCache.get(event.task_id) ?? 0;
        const currentBytes = event.downloaded_bytes || 0;
        let lifetimeIncrement = 0;
        if (currentBytes > prevBytes) {
          lifetimeIncrement = currentBytes - prevBytes;
          taskDownloadedCache.set(event.task_id, currentBytes);
          isLifetimeDirty = true;
        }

        const newLifetime = state.lifetimeDownloadedBytes + lifetimeIncrement;
        const newSession = state.sessionDownloadedBytes + lifetimeIncrement;

        const updated = state.items.map((item) => {
          if (item.id === event.task_id) {
            itemFound = true;
            const isCompleted = event.status === 'completed';
            const isTerminal = isCompleted || event.status === 'failed' || event.status === 'error' || event.status === 'paused';
            if (item.status !== event.status && isTerminal) {
              taskFinished = true;
            }
            const isDownloading = !isTerminal && (event.status === 'downloading' || item.status === 'downloading');
            const effectiveSpeed = isDownloading
              ? (event.speed_bytes_sec > 0 ? event.speed_bytes_sec : (item.speed_bytes_sec || 0))
              : 0;

            const total = event.total_bytes ?? item.total_bytes;
            let effectiveEta = isDownloading ? (event.eta_seconds ?? item.eta_seconds) : null;
            if (effectiveEta === null && isDownloading && total && total > event.downloaded_bytes && effectiveSpeed > 0) {
              effectiveEta = Math.max(1, Math.round((total - event.downloaded_bytes) / effectiveSpeed));
            }

            if (isDownloading) {
              currentTotalSpeed += effectiveSpeed;
            }

            return {
              ...item,
              downloaded_bytes: isCompleted && total ? total : event.downloaded_bytes,
              total_bytes: total,
              speed_bytes_sec: effectiveSpeed,
              eta_seconds: effectiveEta,
              status: event.status as any,
              segments: isDownloading && event.segments && event.segments.length > 0 ? event.segments : item.segments,
            };
          }
          if (item.status === 'downloading') {
            currentTotalSpeed += (item.speed_bytes_sec || 0);
          }
          return item;
        });

        // If the task was added externally (e.g. extension), fetch it into store
        if (!itemFound) {
          get().loadItems();
        }

        if (taskFinished) {
          setTimeout(() => {
            get().loadItems();
          }, 300);
        }

        const newHistory = [...state.speedHistory.slice(1), currentTotalSpeed];
        const newPeak = Math.max(state.peakSpeed, currentTotalSpeed);
        return { 
          items: updated, 
          totalSpeed: currentTotalSpeed, 
          speedHistory: newHistory,
          peakSpeed: newPeak,
          lifetimeDownloadedBytes: newLifetime,
          sessionDownloadedBytes: newSession,
        };
      });
    });

    // 2. Refresh listener triggered when downloads are started from dialog/tray
    const unlistenRefresh = onRefreshDownloads(() => {
      get().loadItems();
      get().setSelectedView('all');
    });

    // 3. Periodic debounced synchronization: Flush accumulated bytes to SQLite every 10s ONLY if dirty
    const syncIntervalId = setInterval(() => {
      if (isLifetimeDirty) {
        isLifetimeDirty = false;
        get().syncLifetimeStatsToDb().catch(() => {});
      }
    }, 10000);

    // 4. Safety heartbeat polling: Sync with SQLite every 1000ms while any task is active
    const intervalId = setInterval(() => {
      const hasActive = get().items.some((i) => i.status === 'downloading' || i.status === 'probing');
      if (hasActive) {
        get().loadItems();
      }
    }, 1000);

    // 5. Lifecycle termination guard: Flush immediately before window unloads
    const handleBeforeUnload = () => {
      if (isLifetimeDirty) {
        isLifetimeDirty = false;
        get().syncLifetimeStatsToDb().catch(() => {});
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', handleBeforeUnload);
    }

    return () => {
      if (isLifetimeDirty) {
        isLifetimeDirty = false;
        get().syncLifetimeStatsToDb().catch(() => {});
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      }
      unlistenProgress();
      unlistenRefresh();
      clearInterval(intervalId);
      clearInterval(syncIntervalId);
    };
  },
}));
