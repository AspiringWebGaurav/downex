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
  notifyDownloadsCompletedNative,
  setDownloadSpeedLimit,
  getRuntimeSessionState,
  setRuntimeSessionTab,
} from '../services/tauriService';

export const SESSION_VIEW_STORAGE_KEY = 'downex_session_selected_view';
export const SESSION_BOOT_STORAGE_KEY = 'downex_session_boot_id';
export const LEGACY_DEV_VIEW_STORAGE_KEY = 'downex_dev_selected_view';

export const VALID_VIEWS = new Set([
  'all',
  'queues',
  'telemetry',
  'settings',
  'speedtest',
  'trash',
  'active',
  'completed',
]);

// Track explicit tab switches in the current mount so async runtime boot check never overrides user clicks.
let hasExplicitTabChangeInMount = false;

export function purgeLegacyHardTabPersistence(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(LEGACY_DEV_VIEW_STORAGE_KEY);
      window.localStorage.removeItem('downex_selected_view');
    }
  } catch {}
}

export function getInitialSelectedView(): string {
  purgeLegacyHardTabPersistence();
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const saved = window.sessionStorage.getItem(SESSION_VIEW_STORAGE_KEY);
      if (saved && VALID_VIEWS.has(saved)) {
        return saved;
      }
    }
  } catch (err) {
    console.warn('Failed to read session tab view:', err);
  }
  return 'all';
}

export function persistSessionSelectedView(view: string): void {
  if (!VALID_VIEWS.has(view)) return;
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(SESSION_VIEW_STORAGE_KEY, view);
    }
  } catch (err) {
    console.warn('Failed to persist session tab view:', err);
  }
  setRuntimeSessionTab(view).catch(() => {});
}

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
  telemetryEpoch: number;
  triggerTelemetryRefresh: () => void;
  showTelemetryOnHome: boolean;
  setShowTelemetryOnHome: (val: boolean) => void;

  isQueueRunning: boolean;
  activeQueueTaskId: string | null;
  setActiveQueueTaskId: (id: string | null) => void;
  startQueue: () => Promise<void>;
  pauseQueue: () => Promise<void>;
  queueDownload: (id: string) => Promise<void>;
  unqueueDownload: (id: string) => Promise<void>;
  loadItems: () => Promise<void>;
  initLifetimeStats: () => Promise<void>;
  syncLifetimeStatsToDb: () => Promise<void>;
  addNewDownload: (url: string, folder?: string, queue?: string, headers?: Record<string, string>, startImmediately?: boolean, customFilename?: string) => Promise<void>;
  changeFolderAndRetry: (id: string, newFolder: string) => Promise<void>;
  togglePause: (id: string) => Promise<void>;
  resumeWithLifecycle: (id: string) => Promise<void>;
  restartFromBeginning: (id: string) => Promise<void>;
  setSpeedLimit: (id: string, limitMbps: number | null) => Promise<void>;
  removeDownload: (id: string, deleteFile?: boolean) => Promise<void>;
  removeAllDownloads: (ids: string[], deleteFile?: boolean) => Promise<void>;
  pauseAllDownloads: () => Promise<void>;
  resumeAllDownloads: () => Promise<void>;
  queueAllDownloads: () => Promise<void>;
  unqueueAllDownloads: () => Promise<void>;
  setSelectedView: (view: string) => void;
  reconcileRuntimeSessionView: () => Promise<void>;
  settingsSubView: 'settings';
  openSettingsSubView: (subView?: 'settings') => void;
  setSearchQuery: (query: string) => void;
  setNewModalOpen: (open: boolean) => void;
  isQueueGuideOpen: boolean;
  setQueueGuideOpen: (open: boolean) => void;
  initListener: () => () => void;
}

export const useDownloadStore = create<DownloadStore>((set, get) => ({
  items: [],
  selectedView: getInitialSelectedView(),
  searchQuery: '',
  isNewModalOpen: false,
  isQueueGuideOpen: false,
  setQueueGuideOpen: (open: boolean) => set({ isQueueGuideOpen: open }),
  isStandaloneModal: false,
  setIsStandaloneModal: (val: boolean) => set({ isStandaloneModal: val }),
  totalSpeed: 0,
  speedHistory: Array(20).fill(0),
  peakSpeed: (() => {
    try {
      const v = localStorage.getItem('downex_peak_speed');
      return v ? Number(v) : 0;
    } catch {
      return 0;
    }
  })(),
  lifetimeDownloadedBytes: 0,
  sessionDownloadedBytes: 0,
  telemetryEpoch: 0,
  triggerTelemetryRefresh: () => set((state) => ({ telemetryEpoch: state.telemetryEpoch + 1 })),
  isQueueRunning: false,
  activeQueueTaskId: null,
  setActiveQueueTaskId: (id: string | null) => set({ activeQueueTaskId: id }),
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
          // If the user recently paused or queued, retain that state even if the DB read hasn't settled yet
          const isUserPaused = existing?.status === 'paused';
          // Database status is absolute authority for terminal/settled states
          const isTerminalState = dbItem.status === 'completed' || dbItem.status === 'paused' || dbItem.status === 'failed' || isUserPaused;
          const isDownloading = !isTerminalState && !isUserPaused && (dbItem.status === 'downloading' || existing?.status === 'downloading');
          const speed = isDownloading
            ? Math.max(existing?.speed_bytes_sec || 0, dbItem.speed_bytes_sec || 0)
            : 0;

          let eta = isDownloading ? existing?.eta_seconds : null;
          if (!eta && isDownloading && speed > 0 && dbItem.total_bytes && dbItem.total_bytes > dbItem.downloaded_bytes) {
            eta = Math.max(1, Math.round((dbItem.total_bytes - dbItem.downloaded_bytes) / speed));
          }

          return {
            ...dbItem,
            status: isTerminalState ? (isUserPaused ? 'paused' : dbItem.status) : (isDownloading ? 'downloading' : dbItem.status),
            // Preserve live in-memory segments and active download metrics only while downloading
            segments: isDownloading && existing?.segments && existing.segments.length > 0 ? existing.segments : dbItem.segments,
            speed_bytes_sec: speed,
            eta_seconds: eta,
          };
        });
        let currentActiveQueueId = get().activeQueueTaskId;
        if (queueRunning && !currentActiveQueueId) {
          const dlItem = merged.find((i) => i.status === 'downloading');
          currentActiveQueueId = dlItem ? dlItem.id : null;
        } else if (!queueRunning) {
          currentActiveQueueId = null;
        }
        return { items: merged, isQueueRunning: queueRunning, activeQueueTaskId: currentActiveQueueId };
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
      const queued = get().items.filter((i) => i.status === 'queued');
      const firstQueuedId = queued.length > 0 ? queued[0].id : null;
      await startQueue();
      set({ isQueueRunning: true, activeQueueTaskId: firstQueuedId });
      await get().loadItems();
    } catch (e) {
      console.warn('Failed to start queue:', e);
    }
  },

  pauseQueue: async () => {
    try {
      await pauseQueue();
      set({ isQueueRunning: false, activeQueueTaskId: null });
      await get().loadItems();
    } catch (e) {
      console.warn('Failed to pause queue:', e);
    }
  },

  queueDownload: async (id: string) => {
    try {
      set((state) => ({
        items: state.items.map((i) =>
          i.id === id ? { ...i, status: 'queued', speed_bytes_sec: 0 } : i
        ),
      }));
      await queueDownload(id);
      await get().loadItems();
    } catch (e) {
      console.warn('Failed to queue download:', e);
    }
  },

  unqueueDownload: async (id: string) => {
    try {
      await pauseDownload(id);
      set((state) => ({
        items: state.items.map((i) => (i.id === id ? { ...i, status: 'paused', speed_bytes_sec: 0 } : i)),
      }));
      await get().loadItems();
    } catch (e) {
      console.warn('Failed to unqueue download:', e);
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
      // 0ms instant optimistic UI update so button immediately flips to RESUME and enables DELETE
      set((state) => ({
        items: state.items.map((i) => (i.id === id ? { ...i, status: 'paused', speed_bytes_sec: 0 } : i)),
      }));
      try {
        await pauseDownload(id);
      } catch (e) {
        console.warn('Failed to pause download backend:', e);
      }
    } else {
      // 0ms instant optimistic UI update for resuming
      set((state) => ({
        items: state.items.map((i) => (i.id === id ? { ...i, status: 'downloading', error_message: null } : i)),
      }));
      try {
        await resumeDownload(id);
      } catch (e) {
        console.warn('Failed to resume download:', e);
      }
    }
  },

  resumeWithLifecycle: async (id: string) => {
    await get().togglePause(id);
  },

  restartFromBeginning: async (id: string) => {
    const item = get().items.find((i) => i.id === id);
    if (!item) return;

    set((state) => ({
      items: state.items.map((i) =>
        i.id === id
          ? {
              ...i,
              status: 'probing',
              downloaded_bytes: 0,
              error_message: null,
              speed_bytes_sec: 0,
            }
          : i
      ),
    }));

    try {
      await resumeDownload(id);
      set((state) => ({
        items: state.items.map((i) =>
          i.id === id
            ? {
                ...i,
                status: 'downloading',
                downloaded_bytes: 0,
                error_message: null,
              }
            : i
        ),
      }));
    } catch (e: any) {
      set((state) => ({
        items: state.items.map((i) =>
          i.id === id
            ? {
                ...i,
                status: 'error',
                error_message: String(e?.message || e || 'Failed to restart download'),
                speed_bytes_sec: 0,
              }
            : i
        ),
      }));
    }
  },

  setSpeedLimit: async (id: string, limitMbps: number | null) => {
    // Layer 3: Optimistic state update & LocalStorage persistence
    try {
      const raw = localStorage.getItem('downex_task_speed_limits');
      const map: Record<string, number> = raw ? JSON.parse(raw) : {};
      if (limitMbps && limitMbps > 0) {
        map[id] = limitMbps;
      } else {
        delete map[id];
      }
      localStorage.setItem('downex_task_speed_limits', JSON.stringify(map));
    } catch {}

    set((state) => ({
      items: state.items.map((i) => {
        if (i.id === id) {
          const updated = { ...i, speed_limit_mbps: limitMbps };
          if (i.id.startsWith('mock-') && i.status === 'downloading') {
            if (limitMbps && limitMbps > 0) {
              updated.speed_bytes_sec = Math.round((limitMbps * 1_000_000) / 8);
            } else {
              updated.speed_bytes_sec = 12500000;
            }
          }
          return updated;
        }
        return i;
      }),
    }));

    // Layer 2: Native IPC backend limiter & SQLite database persistence
    try {
      await setDownloadSpeedLimit(id, limitMbps);
    } catch (e) {
      console.error('Failed to set speed limit in backend:', e);
    }
  },

  removeDownload: async (id: string, deleteFile = false) => {
    // Instant optimistic removal from UI state - 0ms UI lag
    set((state) => ({ items: state.items.filter((i) => i.id !== id) }));
    try {
      await cancelDownload(id, deleteFile);
    } catch (e) {
      console.error('Failed to cancel download in backend:', e);
    }
  },

  removeAllDownloads: async (ids: string[], deleteFile = false) => {
    if (ids.length === 0) return;
    const targetSet = new Set(ids);
    set((state) => ({ items: state.items.filter((i) => !targetSet.has(i.id)) }));
    try {
      await Promise.allSettled(ids.map((id) => cancelDownload(id, deleteFile)));
    } catch (e) {
      console.error('Failed to cancel downloads in backend:', e);
    }
  },

  pauseAllDownloads: async () => {
    const downloading = get().items.filter(
      (i) => i.status === 'downloading' || i.status === 'probing'
    );
    if (downloading.length === 0) return;
    set((state) => ({
      items: state.items.map((i) =>
        i.status === 'downloading' || i.status === 'probing'
          ? { ...i, status: 'paused', speed_bytes_sec: 0 }
          : i
      ),
    }));
    await Promise.allSettled(downloading.map((i) => pauseDownload(i.id)));
  },

  resumeAllDownloads: async () => {
    const paused = get().items.filter(
      (i) => i.status === 'paused' || i.status === 'failed' || i.status === 'error'
    );
    if (paused.length === 0) return;
    set((state) => ({
      items: state.items.map((i) =>
        i.status === 'paused' || i.status === 'failed' || i.status === 'error'
          ? { ...i, status: 'downloading', error_message: null }
          : i
      ),
    }));
    await Promise.allSettled(paused.map((i) => resumeDownload(i.id)));
  },

  queueAllDownloads: async () => {
    const unqueued = get().items.filter(
      (i) => i.status !== 'completed' && i.status !== 'queued'
    );
    if (unqueued.length === 0) return;
    set((state) => ({
      items: state.items.map((i) =>
        i.status !== 'completed' && i.status !== 'queued'
          ? { ...i, status: 'queued', speed_bytes_sec: 0 }
          : i
      ),
    }));
    await Promise.allSettled(unqueued.map((i) => get().queueDownload(i.id)));
  },

  unqueueAllDownloads: async () => {
    const queueTargets = get().items.filter(
      (i) => i.status === 'queued' || (i.status === 'downloading' && i.queue_id && i.queue_id !== '')
    );
    if (queueTargets.length === 0) return;
    set((state) => ({
      items: state.items.map((i) =>
        i.status === 'queued' || (i.status === 'downloading' && i.queue_id && i.queue_id !== '')
          ? { ...i, status: 'paused', speed_bytes_sec: 0 }
          : i
      ),
    }));
    await Promise.allSettled(queueTargets.map((i) => get().unqueueDownload(i.id)));
  },

  setSelectedView: (view: string) => {
    hasExplicitTabChangeInMount = true;
    persistSessionSelectedView(view);
    if (view === 'telemetry') {
      set((state) => ({ selectedView: view, telemetryEpoch: state.telemetryEpoch + 1 }));
    } else {
      set({ selectedView: view });
    }
  },
  reconcileRuntimeSessionView: async () => {
    purgeLegacyHardTabPersistence();
    const runtime = await getRuntimeSessionState();
    if (!runtime || !runtime.boot_id) return;

    let savedBootId: string | null = null;
    try {
      savedBootId = typeof window !== 'undefined' && window.sessionStorage
        ? window.sessionStorage.getItem(SESSION_BOOT_STORAGE_KEY)
        : null;
    } catch {}

    const isFreshAppOrSystemBoot = savedBootId !== runtime.boot_id;
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.setItem(SESSION_BOOT_STORAGE_KEY, runtime.boot_id);
      }
    } catch {}

    if (isFreshAppOrSystemBoot) {
      if (!hasExplicitTabChangeInMount) {
        try {
          if (typeof window !== 'undefined' && window.sessionStorage) {
            window.sessionStorage.removeItem(SESSION_VIEW_STORAGE_KEY);
          }
        } catch {}
        set({ selectedView: 'all' });
        setRuntimeSessionTab('all').catch(() => {});
      }
      return;
    }

    // Same running app process: restore active tab if WebView recreated while tray stayed alive
    if (!hasExplicitTabChangeInMount && runtime.active_tab && VALID_VIEWS.has(runtime.active_tab)) {
      try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.setItem(SESSION_VIEW_STORAGE_KEY, runtime.active_tab);
        }
      } catch {}
      if (get().selectedView !== runtime.active_tab) {
        set({ selectedView: runtime.active_tab });
      }
    }
  },
  settingsSubView: 'settings',
  openSettingsSubView: (_subView?: 'settings') => {
    hasExplicitTabChangeInMount = true;
    persistSessionSelectedView('settings');
    set({ selectedView: 'settings', settingsSubView: 'settings' });
  },
  setSearchQuery: (query: string) => set({ searchQuery: query }),
  setNewModalOpen: (open: boolean) =>
    set({
      isNewModalOpen: open,
      initialModalData: undefined,
      isStandaloneModal: false,
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

            // Forward monotonic persistence:
            // Downloaded bytes must never decrement during active downloading or completed state
            const incomingBytes = event.downloaded_bytes || 0;
            const existingBytes = item.downloaded_bytes || 0;
            const isRestart = item.status !== 'downloading' && event.status === 'downloading' && incomingBytes === 0;

            const monotonicDownloaded = isRestart
              ? 0
              : (isDownloading || isCompleted || event.status === 'paused')
              ? Math.max(existingBytes, incomingBytes)
              : (incomingBytes > 0 ? incomingBytes : existingBytes);

            return {
              ...item,
              supports_ranges: event.supports_ranges !== undefined ? event.supports_ranges : item.supports_ranges,
              downloaded_bytes: isCompleted && total ? total : monotonicDownloaded,
              total_bytes: total,
              speed_bytes_sec: isCompleted ? 0 : effectiveSpeed,
              eta_seconds: isCompleted ? 0 : effectiveEta,
              status: event.status as any,
              updated_at: isCompleted ? Date.now() : item.updated_at,
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
          if (get().isQueueRunning && event?.task_id && get().activeQueueTaskId === event.task_id) {
            const nextQueued = get().items.find((i) => i.status === 'queued' && i.id !== event.task_id);
            set({ activeQueueTaskId: nextQueued ? nextQueued.id : null });
          }
          setTimeout(() => {
            get().loadItems();
            const stillActive = get().items.some(
              (i) => i.status === 'downloading' || i.status === 'probing'
            );
            const hasQueuedInRunningQueue = get().isQueueRunning && get().items.some((i) => i.status === 'queued');
            if (!stillActive && !hasQueuedInRunningQueue) {
              notifyDownloadsCompletedNative().catch(() => {});
              import('./appVersionStore').then(({ useAppVersionStore }) => {
                useAppVersionStore.getState().onDownloadsCompleted();
              });
            }
          }, 300);
        }

        const newHistory = [...state.speedHistory.slice(1), currentTotalSpeed];
        const newPeak = Math.max(state.peakSpeed, currentTotalSpeed);
        if (newPeak > state.peakSpeed) {
          try {
            localStorage.setItem('downex_peak_speed', String(newPeak));
          } catch {}
        }
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

// Automatically synchronize any state changes to selectedView with session persistence
useDownloadStore.subscribe((state, prevState) => {
  if (state.selectedView !== prevState.selectedView) {
    persistSessionSelectedView(state.selectedView);
  }
});

if (typeof window !== 'undefined' && (import.meta as any).env?.DEV) {
  (window as any).useDownloadStore = useDownloadStore;
}
