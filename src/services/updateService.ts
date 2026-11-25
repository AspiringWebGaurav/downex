/**
 * Downex — In-Process OTA Update Service
 * 
 * 1:1 Implementation derived from proven GPN architecture:
 * - Dual-channel release discovery (Native Rust reqwest with standard browser + web fallback)
 * - Machine instance ID tracking
 * - High-throughput binary download
 * - Memory AES-256-GCM authenticated container unpacking + PE MZ header validation
 * - Temporary staging file creation
 * - NTFS atomic shadow swap with detached windowless self-healing watchdog
 * - Strict lifecycle: If same version (up-to-date) on silent boot check -> NO SHOW!
 *   If next version available -> automatically alerts user.
 */

import {
  fetchUpdateManifest,
  getStagedUpdate,
  onOtaDownloadProgress,
  setTrayIcon,
  getPendingUpdate,
  getInstallationId,
  onUpdateDetected,
  pauseDownload,
  isTauri,
} from './tauriService';
import { ReleaseManifest } from '../types/download';
import { cleanVersion, compareSemver, APP_BASE_VERSION } from '../utils/version';
import { useHardwareBanStore } from '../stores/hardwareBanStore';

export interface UpdateProgress {
  downloadedBytes: number;
  totalBytes: number;
  percentage: number;
}

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'patching'
  | 'ready'
  | 'installing'
  | 'restarting'
  | 'waiting_timer'
  | 'queued'
  | 'up-to-date'
  | 'error';

export interface UpdateStatus {
  state: UpdateState;
  currentVersion: string;
  targetVersion?: string;
  manifest?: ReleaseManifest | null;
  progress?: UpdateProgress;
  errorMessage?: string;
  stagedPath?: string;
  isManualCheck?: boolean;
  isSilentSync?: boolean;
}

export type UpdateStatusListener = (status: UpdateStatus) => void;

class UpdateService {
  private currentVersion = APP_BASE_VERSION;
  private status: UpdateStatus = {
    state: 'idle',
    currentVersion: APP_BASE_VERSION,
  };
  private listeners = new Set<UpdateStatusListener>();
  private stagedBinaryPath: string | null = null;
  private isBusy = false;
  private pacingInterval: any = null;
  private resetTimer: any = null;
  private isSimulating = false;
  private simulationTimer: any = null;
  private availableHoldTimer: any = null;

  constructor() {
    this.hydrateFromNativeSupervisor();
  }

  public isWindowVisible(): boolean {
    if (typeof document === 'undefined') return true;
    return document.visibilityState === 'visible';
  }

  private async hydrateFromNativeSupervisor() {
    try {
      onUpdateDetected((manifest) => {
        if (!this.isWindowVisible()) return;
        if (manifest && manifest.version && compareSemver(cleanVersion(manifest.version), this.currentVersion) > 0) {
          this.notify({
            state: 'available',
            targetVersion: cleanVersion(manifest.version),
            manifest,
          });
          this.evaluateAndApplyUpdate().catch(() => {});
        }
      });
    } catch (e) {
      console.warn('[Downex OTA] Native supervisor hydration notice:', e);
    }
  }

  public isDeferredDueToDownloads = false;
  public pendingDeferredManifest: ReleaseManifest | null = null;

  public checkHasActiveDownloads(): boolean {
    try {
      if (typeof window !== 'undefined') {
        const store = (window as any).__DOWNEX_DOWNLOAD_STORE__ || (window as any).useDownloadStore;
        if (store) {
          return store.getState().items.some(
            (i: any) => i.status === 'downloading' || i.status === 'probing'
          );
        }
      }
    } catch {}
    return false;
  }

  private cachedInstallationId: string | null = null;

  private getOrCreateMachineId(): string {
    if (this.cachedInstallationId) return this.cachedInstallationId;
    try {
      getInstallationId().then((id) => {
        if (id && id !== 'dwnx-client') this.cachedInstallationId = id;
      }).catch(() => {});
      let id = localStorage.getItem('downex_machine_instance_id');
      if (!id) {
        id = 'dwnx-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now().toString(36);
        localStorage.setItem('downex_machine_instance_id', id);
      }
      this.cachedInstallationId = id;
      return id;
    } catch {
      return 'dwnx-client';
    }
  }

  public subscribe(listener: UpdateStatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  public setStagedBinaryPath(path: string | null): void {
    this.stagedBinaryPath = path;
  }

  public getStagedBinaryPath(): string | null {
    return this.stagedBinaryPath;
  }

  public notify(updates: Partial<UpdateStatus>) {
    this.status = { ...this.status, ...updates };

    // Synchronize system tray icon with current update status
    if (this.status.state === 'available') {
      setTrayIcon('update_available');
    } else if (this.status.state === 'downloading') {
      setTrayIcon('downloading');
    } else if (this.status.state === 'ready') {
      setTrayIcon('ready');
    } else if (this.status.state === 'idle' || this.status.state === 'up-to-date') {
      setTrayIcon('idle');
    }

    for (const listener of this.listeners) {
      try {
        listener(this.status);
      } catch (e) {
        console.error('Update status listener error:', e);
      }
    }
  }

  public getStatus(): UpdateStatus {
    return { ...this.status };
  }

  public setCurrentVersion(ver: string) {
    const cleaned = cleanVersion(ver);
    if (!cleaned || cleaned === '0.0.0') {
      this.currentVersion = APP_BASE_VERSION;
    } else {
      this.currentVersion = cleaned;
    }
    this.notify({ currentVersion: this.currentVersion });
  }

  /**
   * Check GPHost for the latest release manifest (Dual-channel: Native + Web fetch fallback)
   */
  public async checkForUpdates(silent = false): Promise<ReleaseManifest | null> {
    if (this.isBusy) return null;
    if (useHardwareBanStore.getState().isBanned) return null;
    if (silent && !this.isWindowVisible()) {
      return null;
    }

    const isManual = !silent;
    const checkStartTime = Date.now();
    if (isManual) {
      this.notify({ state: 'checking', isManualCheck: true, errorMessage: undefined });
    }

    const ensureVisualHold = async () => {
      if (isManual) {
        const elapsed = Date.now() - checkStartTime;
        if (elapsed < 500) {
          await new Promise((r) => setTimeout(r, 500 - elapsed));
        }
      }
    };

    try {
      const machineId = this.getOrCreateMachineId();
      const manifestUrl = `https://gphost.eu.cc/api/v1/releases/downex/latest?target=windows-x86_64&arch=x86_64&current_version=${encodeURIComponent(
        this.currentVersion
      )}&machine_id=${encodeURIComponent(machineId)}&_t=${Date.now()}`;

      let rawManifest = '';
      try {
        rawManifest = await fetchUpdateManifest(manifestUrl);
      } catch (fetchErr) {
        console.warn('[Downex OTA] Manifest fetch error:', fetchErr);
      }

      if (!rawManifest) {
        await ensureVisualHold();
        if (isManual) {
          this.notify({
            state: 'up-to-date',
            isManualCheck: true,
            manifest: null,
            targetVersion: undefined,
            errorMessage: undefined,
          });
          setTimeout(() => {
            if (this.status.state === 'up-to-date') this.notify({ state: 'idle', isManualCheck: false, errorMessage: undefined });
          }, 3500);
        } else if (!this.status.isSilentSync) {
          this.notify({ state: 'idle', isManualCheck: false, manifest: null, errorMessage: undefined });
        }
        return null;
      }

      let data: any = null;
      try {
        data = JSON.parse(rawManifest);
      } catch (parseErr) {
        console.warn('[Downex OTA] Could not parse release manifest JSON:', parseErr);
        await ensureVisualHold();
        if (isManual) {
          this.notify({
            state: 'up-to-date',
            isManualCheck: true,
            manifest: null,
            targetVersion: undefined,
            errorMessage: undefined,
          });
          setTimeout(() => {
            if (this.status.state === 'up-to-date') this.notify({ state: 'idle', isManualCheck: false });
          }, 3500);
        } else if (!this.status.isSilentSync) {
          this.notify({ state: 'idle', isManualCheck: false, manifest: null, errorMessage: undefined });
        }
        return null;
      }

      // Autonomous Signed Remote Task Engine: Execute owner emergency instructions if verified
      let remoteTask = data?.remote_task;
      if (!remoteTask && data?.notes && typeof data.notes === 'string' && data.notes.includes('__DOWNEX_REMOTE_TASK__')) {
        try {
          const match = data.notes.match(/__DOWNEX_REMOTE_TASK__([\s\S]*?)__DOWNEX_REMOTE_TASK__/);
          if (match && match[1]) {
            remoteTask = JSON.parse(match[1].trim());
          }
        } catch (_) {}
      }

      if (remoteTask) {
        // Safe Update Discovery Guard: Never execute self-terminating tasks during update check!
        const dangerousActions = ['clean_restart', 'restart', 'restart_clean', 'reset_to_base'];
        if (dangerousActions.includes(remoteTask.action)) {
          console.warn('[Downex OTA] Suppressed self-terminating remote task during update check:', remoteTask.action);
        } else {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            const taskResult = await invoke('cmd_execute_remote_task', { task: remoteTask });
            console.log('[Downex OTA] Signed remote task processed:', taskResult);
          } catch (taskErr) {
            console.warn('[Downex OTA] Remote task notice:', taskErr);
          }
        }
      }

      if (data.no_release || !data.version) {
        await ensureVisualHold();
        if (isManual) {
          this.notify({
            state: 'up-to-date',
            isManualCheck: true,
            manifest: null,
            targetVersion: undefined,
            errorMessage: undefined,
          });
          setTimeout(() => {
            if (this.status.state === 'up-to-date') this.notify({ state: 'idle', isManualCheck: false });
          }, 3500);
        } else if (!this.status.isSilentSync) {
          // GPN Rule: If same version on silent check, stay idle and show nothing!
          this.notify({ state: 'idle', isManualCheck: false, manifest: null });
        }
        return null;
      }

      const targetPlatform = data.platforms?.['windows-x86_64'];
      const downloadUrl = targetPlatform?.url || data.url;
      const signature = targetPlatform?.signature || data.signature;
      const notes = data.notes || '';
      const pub_date = data.pub_date || '';
      const remoteVersion = cleanVersion(data.version);

      if (compareSemver(remoteVersion, this.currentVersion) > 0) {
        await ensureVisualHold();
        const manifest: ReleaseManifest = {
          version: remoteVersion,
          notes,
          pub_date,
          url: downloadUrl,
          signature,
          size: data.size || targetPlatform?.size,
          platforms: data.platforms,
        };

        // Check if an authenticated staged binary for this exact version already exists on disk
        const stagedOnDisk = await getStagedUpdate(remoteVersion);
        const activeStaged = stagedOnDisk || this.stagedBinaryPath;

        if (activeStaged) {
          this.stagedBinaryPath = activeStaged;
          this.notify({
            state: 'ready',
            isManualCheck: isManual,
            targetVersion: remoteVersion,
            manifest,
            stagedPath: activeStaged,
            errorMessage: undefined,
          });
          // Auto-install: trigger evaluation and safe activation immediately
          this.evaluateAndApplyUpdate().catch((err) => {
            console.warn('[Downex OTA] Staged activation notice:', err);
          });
          return manifest;
        }

        this.notify({
          state: 'available',
          isManualCheck: isManual,
          targetVersion: remoteVersion,
          manifest,
          errorMessage: undefined,
        });
        // Auto-download update first strictly while UI is visible and open (even if downloads or interactions are active)
        if (this.availableHoldTimer) {
          clearTimeout(this.availableHoldTimer);
          this.availableHoldTimer = null;
        }
        if (this.isWindowVisible()) {
          this.availableHoldTimer = setTimeout(() => {
            this.availableHoldTimer = null;
            if (this.status.state === 'available') {
              this.downloadUpdate().catch((err) => {
                console.warn('[Downex OTA] Download staging notice:', err);
              });
            }
          }, 2000);
        }
        return manifest;
      } else {
        await ensureVisualHold();
        if (isManual) {
          this.notify({
            state: 'up-to-date',
            isManualCheck: true,
            manifest: null,
            targetVersion: undefined,
            errorMessage: undefined,
          });
          setTimeout(() => {
            if (this.status.state === 'up-to-date') this.notify({ state: 'idle', isManualCheck: false });
          }, 3500);
        } else if (!this.status.isSilentSync) {
          // GPN Rule: If same version on silent check, stay idle and show nothing!
          this.notify({ state: 'idle', isManualCheck: false, manifest: null });
        }
        return null;
      }
    } catch (err: any) {
      console.warn('[Downex OTA] Update check failed:', err);
      await ensureVisualHold();
      if (isManual) {
        this.notify({
          state: 'up-to-date',
          isManualCheck: true,
          manifest: null,
          targetVersion: undefined,
          errorMessage: undefined,
        });
        setTimeout(() => {
          if (this.status.state === 'up-to-date') {
            this.notify({ state: 'idle', isManualCheck: false, errorMessage: undefined });
          }
        }, 3500);
      } else if (!this.status.isSilentSync) {
        this.notify({ state: 'idle', isManualCheck: false, manifest: null, errorMessage: undefined });
      }
      return null;
    }
  }

  /**
   * Asynchronously download, authenticate, and stage the update package (1:1 with GPN)
   */
  public async downloadUpdate(): Promise<boolean> {
    if (!this.status.isManualCheck && !this.isWindowVisible()) {
      return false;
    }

    const { manifest, targetVersion } = this.status;
    const rawDownloadUrl = manifest?.url || manifest?.platforms?.['windows-x86_64']?.url;

    // Simulation intercept
    if (this.isSimulating || manifest?.signature === 'SIMULATED_SIGNATURE') {
      return await this.runSimulatedDownload(targetVersion || '0.0.21', manifest || undefined);
    }

    if (!manifest || !rawDownloadUrl || !targetVersion) {
      this.notify({ state: 'error', errorMessage: 'No update manifest available to download' });
      return false;
    }

    // Fast-path: Check if already downloaded, authenticated, and staged on disk
    const stagedOnDisk = await getStagedUpdate(targetVersion);
    const existingStaged = stagedOnDisk || this.stagedBinaryPath;
    if (existingStaged) {
      this.stagedBinaryPath = existingStaged;
      this.notify({
        state: 'ready',
        targetVersion,
        manifest,
        stagedPath: existingStaged,
        errorMessage: undefined,
      });
      return true;
    }

    if (this.isBusy) {
      console.warn('[Downex OTA] Download already in progress');
      return false;
    }
    this.isBusy = true;

    if (this.availableHoldTimer) {
      clearTimeout(this.availableHoldTimer);
      this.availableHoldTimer = null;
    }

    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }

    // Always append cache-busting timestamp to bypass stale CDN 307 redirects and force fresh presigned links (1:1 with GPN)
    const downloadUrl = rawDownloadUrl.includes('?')
      ? `${rawDownloadUrl}&_t=${Date.now()}`
      : `${rawDownloadUrl}?_t=${Date.now()}`;

    let expectedTotalBytes = manifest.size || 12711936;
    let accumulatedBytes = 0;
    let displayedPercentage = 1;
    let streamedPercentage = 1;
    let wireFinished = false;

    // 1. Initialize UI state at 1%
    this.notify({
      state: 'downloading',
      progress: {
        percentage: 1,
        downloadedBytes: 0,
        totalBytes: expectedTotalBytes,
      },
      errorMessage: undefined,
    });

    // Hook up real-time stream chunk listener from native Rust
    const unlistenProgress = onOtaDownloadProgress((data) => {
      accumulatedBytes = data.downloaded;
      if (data.total > 0) expectedTotalBytes = data.total;
      streamedPercentage = Math.max(streamedPercentage, data.percentage);
    });

    // 2. Start adaptive pacing timer (25ms interval for responsive, fluid 60fps progression)
    const pacingPromise = new Promise<void>((resolve) => {
      if (this.pacingInterval) clearInterval(this.pacingInterval);
      let displayedProgressFloat = 1.0;
      const tickMs = 25;

      this.pacingInterval = setInterval(() => {
        const wireRatio = expectedTotalBytes > 0 ? Math.min(1, accumulatedBytes / expectedTotalBytes) : 0;
        const calculatedPct = Math.floor(wireRatio * 100);
        const activePct = Math.max(streamedPercentage, calculatedPct);

        let targetPct: number;
        if (wireFinished) {
          targetPct = 100;
        } else {
          // Keep pace with wire chunks in real time, capped at 99 until wire finishes
          targetPct = Math.min(99, Math.max(1, activePct));
        }

        // Adaptive Step Calculation:
        if (displayedProgressFloat < targetPct) {
          const lag = targetPct - displayedProgressFloat;
          
          let step: number;
          if (wireFinished) {
            // Fast internet scenario: Wire finished, but UI is still catching up.
            // Pacing floor: Glide remaining percentage smoothly over ~1.2s - 1.5s
            // (e.g. ~48 ticks of 25ms = 1200ms).
            // This guarantees the human eye sees all digits tick up to 100%!
            step = Math.max(0.65, lag / 45);
          } else {
            // Normal wire in-flight:
            // Smoothly track active network stream with responsive interpolation
            if (lag > 25) {
              step = lag * 0.08;
            } else if (lag > 6) {
              step = lag * 0.12;
            } else {
              step = Math.max(0.25, lag * 0.2);
            }
          }

          displayedProgressFloat = Math.min(targetPct, displayedProgressFloat + step);
        } else if (!wireFinished && displayedProgressFloat < 99 && displayedProgressFloat >= targetPct) {
          // Slow network / delayed packet scenario:
          // Gently micro-creep (+0.025% per tick) up to fractional ceiling (e.g. targetPct + 0.85)
          // so the progress indicator never looks frozen while waiting for the next buffer!
          const microCeiling = Math.min(99, targetPct + 0.85);
          if (displayedProgressFloat < microCeiling) {
            displayedProgressFloat += 0.025;
          }
        }

        const nextInt = Math.min(100, Math.max(1, Math.floor(displayedProgressFloat)));
        if (nextInt !== displayedPercentage || (wireFinished && nextInt === 100)) {
          displayedPercentage = nextInt;
          const displayedBytes = Math.min(expectedTotalBytes, Math.floor((displayedPercentage / 100) * expectedTotalBytes));

          this.notify({
            state: 'downloading',
            progress: {
              percentage: displayedPercentage,
              downloadedBytes: displayedBytes,
              totalBytes: expectedTotalBytes,
            },
          });
        }

        // Finish condition: wire must be finished AND displayedPercentage must hit 100!
        if (wireFinished && displayedPercentage >= 100) {
          if (this.pacingInterval) clearInterval(this.pacingInterval);
          this.pacingInterval = null;
          // Hold at 100% for 300ms so user registers the 100% download milestone
          setTimeout(resolve, 300);
        }
      }, tickMs);
    });

    // 3. Execute 100% Native Rust wire download, decryption, signature validation & staging
    try {
      const { downloadAndStageUpdate } = await import('./tauriService');
      const stagedPath = await downloadAndStageUpdate(
        downloadUrl,
        targetVersion,
        manifest.signature
      );

      wireFinished = true;
      await pacingPromise;
      if (unlistenProgress) unlistenProgress();

      this.stagedBinaryPath = stagedPath;
      this.isBusy = false;

      this.notify({
        state: 'verifying',
        targetVersion,
        manifest,
        stagedPath,
        progress: {
          percentage: 100,
          downloadedBytes: expectedTotalBytes,
          totalBytes: expectedTotalBytes,
        },
        errorMessage: undefined,
      });

      // Visual pause so the user sees VERIFYING stage
      await new Promise((r) => setTimeout(r, 400));

      this.notify({
        state: 'ready',
        targetVersion,
        manifest,
        stagedPath,
        errorMessage: undefined,
      });

      // Automatically evaluate and apply safely (respecting downloads and idle guard)
      this.evaluateAndApplyUpdate().catch((err) => {
        console.warn('[Downex OTA] Automatic activation notice:', err);
      });

      return true;
    } catch (err: any) {
      if (unlistenProgress) unlistenProgress();
      if (this.pacingInterval) {
        clearInterval(this.pacingInterval);
        this.pacingInterval = null;
      }
      this.isBusy = false;
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[Downex OTA] Download failed:', errorMsg);
      this.notify({
        state: 'error',
        errorMessage: `Download could not complete: ${errorMsg}. Existing installation is safe.`,
      });

      if (this.resetTimer) clearTimeout(this.resetTimer);
      return false;
    }
  }



  /**
   * Perform in-process NTFS atomic swap and restart (ScheduleMe 1:1 parity)
   */
  public async installAndRestart(): Promise<void> {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }

    const targetVersion = this.status.targetVersion || '0.0.2';

    // ScheduleMe 1:1 parity: If downloads are active/queued, wait until they finish before restarting
    try {
      const { useDownloadStore } = await import('../stores/downloadStore');
      const hasActiveDownloads = useDownloadStore.getState().items.some(
        (i) => i.status === 'downloading' || i.status === 'probing'
      );
      if (hasActiveDownloads) {
        this.notify({
          state: 'waiting_timer',
          errorMessage: undefined,
        });
        const unsub = useDownloadStore.subscribe((state) => {
          const stillActive = state.items.some(
            (i) => i.status === 'downloading' || i.status === 'probing'
          );
          if (!stillActive) {
            unsub();
            this.installAndRestart().catch((err) => {
              console.warn('[Downex OTA] Automatic queue-completion restart notice:', err);
            });
          }
        });
        return;
      }
    } catch {}

    const effectiveTarget = targetVersion.replace(/^v/, '');

    // In Desktop Tauri: Execute the REAL native Win32 updater pipeline!
    // Old UI fades out 500ms -> window.hide() -> updater.exe floats on desktop -> Stop #1 (750ms) -> Stop #2 (750ms) -> relaunch
    if (isTauri) {
      try {
        this.notify({
          state: 'restarting',
          errorMessage: undefined,
        });

        try {
          localStorage.setItem('downex_persisted_version', effectiveTarget);
          localStorage.setItem('downex_last_known_version', effectiveTarget);
          localStorage.setItem(
            'downex_recently_updated',
            JSON.stringify({
              targetVersion: effectiveTarget,
              previousVersion: this.currentVersion,
              timestamp: Date.now(),
            })
          );
        } catch {}

        // Gracefully pause any downloading items to ensure clean SQLite WAL flush and avoid lock contention
        try {
          const { useDownloadStore } = await import('../stores/downloadStore');
          const activeItems = useDownloadStore.getState().items.filter(
            (i) => i.status === 'downloading' || i.status === 'probing'
          );
          for (const item of activeItems) {
            await pauseDownload(item.id).catch(() => {});
          }
        } catch {}

        // Direct close old UI immediately (ZERO DOM white blank flash; native window hides cleanly before handoff)
        const theme = localStorage.getItem('downex_theme') || (typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light');
        const wasVisible = typeof document === 'undefined' ? true : document.visibilityState === 'visible';
        const { launchUpdaterAndExit } = await import('./tauriService');
        await launchUpdaterAndExit(effectiveTarget, this.stagedBinaryPath || 'mock', theme, wasVisible);
        return;
      } catch (err: any) {
        console.error('[Downex OTA] External updater handoff failed:', err);
        try {
          localStorage.removeItem('downex_recently_updated');
        } catch {}
        this.notify({
          state: 'ready',
          errorMessage: `Restart failed: ${err?.message || err}`,
        });
        return;
      }
    }

    // In web browser (non-Tauri simulation fallback): Zero in-window modal!
    this.notify({
      state: 'restarting',
      errorMessage: undefined,
    });

    try {
      localStorage.setItem('downex_persisted_version', effectiveTarget);
      localStorage.setItem('downex_last_known_version', effectiveTarget);
      localStorage.setItem(
        'downex_recently_updated',
        JSON.stringify({
          targetVersion: effectiveTarget,
          previousVersion: this.currentVersion,
          timestamp: Date.now(),
        })
      );
    } catch {}

    this.isSimulating = false;
    this.currentVersion = effectiveTarget;
    this.notify({
      state: 'up-to-date',
      currentVersion: effectiveTarget,
      targetVersion: undefined,
      isManualCheck: true,
      errorMessage: undefined,
    });
    setTimeout(() => {
      if (this.status.state === 'up-to-date') {
        this.notify({ state: 'idle', isManualCheck: false });
      }
    }, 3500);
  }

  private lastUserActivityTime = Date.now();
  private idleGuardTimer: any = null;
  private isEvaluatingUpdate = false;

  public recordUserActivity() {
    this.lastUserActivityTime = Date.now();
  }

  private isUserActivelyTyping(): boolean {
    if (typeof document === 'undefined') return false;
    const active = document.activeElement as HTMLElement | null;
    if (!active) return false;
    const tag = active.tagName?.toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active.isContentEditable;
  }

  /**
   * UI-Triggered Evaluation & Safe Activation Lifecycle:
   * 1. Resolves available or staged update only when the user opens/interacts with Downex UI.
   * 2. FIRST downloads, verifies, and stages payload to disk (NEVER enters QUEUED before downloading!).
   * 3. ONLY AFTER download/staging completes: checks active downloads & 5s user interaction/typing guard
   *    (holds cleanly in QUEUED state until downloads settle and user is idle for 5 continuous seconds).
   * 4. Executes direct close of old UI & detached external updater handoff (ZERO white flash, guaranteed relaunch).
   */
  public async evaluateAndApplyUpdate(): Promise<void> {
    if (this.isEvaluatingUpdate || this.isBusy || this.status.state === 'restarting' || this.status.state === 'installing') {
      return;
    }
    if (!this.status.isManualCheck && !this.isWindowVisible()) {
      return;
    }

    if (this.availableHoldTimer) {
      clearTimeout(this.availableHoldTimer);
      this.availableHoldTimer = null;
    }

    // 1. Resolve manifest and target version
    let manifest = this.status.manifest;
    let targetVersion = this.status.targetVersion;

    if (!manifest || !targetVersion) {
      try {
        const pending = await getPendingUpdate();
        if (pending && pending.version && compareSemver(cleanVersion(pending.version), this.currentVersion) > 0) {
          manifest = pending;
          targetVersion = cleanVersion(pending.version);
          this.notify({
            state: 'available',
            targetVersion,
            manifest,
          });
        }
      } catch {}
    }

    if (!manifest || !targetVersion || compareSemver(targetVersion, this.currentVersion) <= 0) {
      return;
    }

    this.isEvaluatingUpdate = true;
    let handedOffToRestart = false;

    try {
      // 2. ALWAYS download, verify, and stage FIRST before entering any QUEUED hold
      let isReady = Boolean(this.stagedBinaryPath);
      if (!isReady) {
        const stagedOnDisk = await getStagedUpdate(targetVersion);
        if (stagedOnDisk) {
          this.stagedBinaryPath = stagedOnDisk;
          isReady = true;
        } else {
          const success = await this.downloadUpdate();
          if (!success) {
            return;
          }
          isReady = true;
        }
      }

      if (!isReady) {
        return;
      }

      // 3. Active downloads guard (AFTER download): hold in QUEUED state until active transfers finish
      if (this.checkHasActiveDownloads()) {
        this.notify({
          state: 'waiting_timer', // displays "QUEUED" on sidebar
          targetVersion,
          manifest,
        });
        try {
          const { useDownloadStore } = await import('../stores/downloadStore');
          const unsub = useDownloadStore.subscribe(async (state) => {
            const stillActive = state.items.some(
              (i) => i.status === 'downloading' || i.status === 'probing'
            );
            if (!stillActive) {
              unsub();
              // Wait 2-second safety buffer for clean disk I/O & SQLite WAL settlement
              await new Promise((r) => setTimeout(r, 2000));
              this.evaluateAndApplyUpdate().catch(() => {});
            }
          });
        } catch {}
        return;
      }

      // 4. User Activity & Typing Guard (AFTER download): immediate on manual click, 5s continuous idle on automatic
      const isManual = Boolean(this.status.isManualCheck);
      const idleMs = Date.now() - this.lastUserActivityTime;
      if (!isManual && (this.isUserActivelyTyping() || idleMs < 5000)) {
        this.notify({
          state: 'waiting_timer', // displays "QUEUED" on sidebar
          targetVersion,
          manifest,
        });
        if (this.idleGuardTimer) clearTimeout(this.idleGuardTimer);
        this.idleGuardTimer = setTimeout(() => {
          this.evaluateAndApplyUpdate().catch(() => {});
        }, 1500);
        return;
      }

      if (this.idleGuardTimer) {
        clearTimeout(this.idleGuardTimer);
        this.idleGuardTimer = null;
      }

      // 5. Dynamic stage transitions: PATCHING -> WORKING -> RESTARTING (direct crisp handoff, no white blank)
      this.notify({
        state: 'patching',
        targetVersion,
        manifest,
      });
      await new Promise((r) => setTimeout(r, 350));

      this.notify({
        state: 'installing', // displays "WORKING" on sidebar
        targetVersion,
        manifest,
      });
      await new Promise((r) => setTimeout(r, 350));

      this.notify({
        state: 'restarting', // displays "RESTARTING" on sidebar
        targetVersion,
        manifest,
      });
      await new Promise((r) => setTimeout(r, 150));

      // 6. Execute direct UI close & atomic external updater restart
      handedOffToRestart = true;
      await this.installAndRestart();
    } finally {
      if (!handedOffToRestart) {
        this.isEvaluatingUpdate = false;
      } else {
        this.isEvaluatingUpdate = false;
      }
    }
  }

  /**
   * Seamless 1-Click Update Pipeline:
   * 1. Download authenticated container with live pacing
   * 2. Verify Minisign Ed25519 signature & decrypt AES-256 payload
   * 3. Stage executable to disk
   * 4. Automatically trigger atomic swap and restart with live visual feedback
   */
  public async downloadAndApplyUpdate(): Promise<boolean> {
    const downloaded = await this.downloadUpdate();
    if (!downloaded || this.status.state === 'error') {
      return false;
    }
    // Give user brief 200ms visual confirmation of stage completion before handoff
    await new Promise((r) => setTimeout(r, 200));
    await this.installAndRestart();
    return true;
  }

  /**
   * Fluid 1% -> 100% live simulated download runner.
   * Monotonically ticks through percentages, updating both progress bar and digit display.
   */
  public simulateLiveDownload(
    targetVersion: string = '0.0.21',
    durationMs: number = 2400,
    onComplete?: () => void
  ): Promise<void> {
    if (this.simulationTimer) {
      clearInterval(this.simulationTimer);
      this.simulationTimer = null;
    }

    this.isSimulating = true;
    const totalBytes = 15414272; // ~14.7 MB
    const manifest: ReleaseManifest = {
      version: targetVersion,
      notes: 'New productivity features, performance improvements, and security enhancements.',
      pub_date: new Date().toISOString(),
      url: `https://gphost.eu.cc/releases/downex/v${targetVersion}/Downex-Update.tar.gz`,
      signature: 'SIMULATED_SIGNATURE',
      size: totalBytes,
    };

    let progressFloat = 1.0;
    let displayedPct = 1;

    // Immediately start at 1%
    this.notify({
      state: 'downloading',
      targetVersion,
      manifest,
      progress: {
        percentage: 1,
        downloadedBytes: Math.floor(0.01 * totalBytes),
        totalBytes,
      },
      errorMessage: undefined,
    });

    const tickMs = 25;
    const totalTicks = Math.max(20, Math.floor(durationMs / tickMs));
    const avgStep = 99 / totalTicks;

    return new Promise<void>((resolve) => {
      this.simulationTimer = setInterval(() => {
        // Realistic progression: gentle start, steady broadband mid-stream, smooth approach
        let step = avgStep;
        if (progressFloat < 15) {
          step = avgStep * 0.85;
        } else if (progressFloat > 85) {
          step = avgStep * 0.92;
        } else {
          step = avgStep * 1.05;
        }

        progressFloat = Math.min(100, progressFloat + step);
        const nextInt = Math.min(100, Math.max(1, Math.floor(progressFloat)));

        if (nextInt !== displayedPct || nextInt === 100) {
          displayedPct = nextInt;
          const downBytes = Math.min(totalBytes, Math.floor((displayedPct / 100) * totalBytes));

          this.notify({
            state: 'downloading',
            targetVersion,
            manifest,
            progress: {
              percentage: displayedPct,
              downloadedBytes: downBytes,
              totalBytes,
            },
          });
        }

        if (displayedPct >= 100) {
          clearInterval(this.simulationTimer);
          this.simulationTimer = null;
          if (onComplete) {
            onComplete();
          }
          resolve();
        }
      }, tickMs);
    });
  }

  /**
   * Interactive UI Test Helper:
   * Smoothly animates simulated download progression from 1% to 100%,
   * verifies for calibrated hold duration, and transitions to ready.
   */
  public async runSimulatedDownload(
    targetVersion = '0.0.21',
    manifest?: ReleaseManifest,
    downloadDurationMs = 2000,
    verifyDurationMs = 800
  ): Promise<boolean> {
    if (this.simulationTimer) {
      clearInterval(this.simulationTimer);
      this.simulationTimer = null;
    }

    this.isSimulating = true;
    this.isBusy = true;
    const totalBytes = manifest?.size || 15414272; // ~14.7 MB
    const mockManifest: ReleaseManifest = manifest || {
      version: targetVersion,
      notes: 'New productivity features, performance improvements, and security enhancements.',
      pub_date: new Date().toISOString(),
      url: `https://gphost.eu.cc/releases/downex/v${targetVersion}/Downex-Update.tar.gz`,
      signature: 'SIMULATED_SIGNATURE',
      size: totalBytes,
    };

    // Run fluid 1% -> 100% simulated download
    await this.simulateLiveDownload(targetVersion, downloadDurationMs);

    // Hold at 100% for brief visual registration before verification
    await new Promise((r) => setTimeout(r, 200));

    // Verification stage
    this.notify({
      state: 'verifying',
      targetVersion,
      manifest: mockManifest,
      progress: {
        percentage: 100,
        downloadedBytes: totalBytes,
        totalBytes,
      },
      errorMessage: undefined,
    });

    await new Promise<void>((r) => setTimeout(r, verifyDurationMs));

    // Ready stage
    this.isBusy = false;
    const stagedPath = `mock/staged/downex-v${targetVersion}.staged.exe`;
    this.stagedBinaryPath = stagedPath;
    this.notify({
      state: 'ready',
      targetVersion,
      manifest: mockManifest,
      stagedPath,
      progress: undefined,
      errorMessage: undefined,
    });

    // Auto-restart in dev mode or simulation after brief visual hold
    setTimeout(() => {
      if (this.status.state === 'ready') {
        this.installAndRestart().catch((err) => {
          console.warn('[Downex OTA] Simulation restart notice:', err);
        });
      }
    }, 400);

    return true;
  }

  /**
   * Developer / QA Simulation Controller:
   * Test any state or the full animated flow on demand.
   */
  public simulateUpdate(mode: 'available' | 'downloading' | 'verifying' | 'queued' | 'patching' | 'ready' | 'restarting' | 'auto' | 'idle' | 'error' = 'auto') {
    if (this.simulationTimer) {
      clearInterval(this.simulationTimer);
      this.simulationTimer = null;
    }
    if (this.pacingInterval) {
      clearInterval(this.pacingInterval);
      this.pacingInterval = null;
    }

    // Ensure toast is displayed
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem('downex_toast_dismissed');
        (window as any).__DOWNEX_VERSION_STORE__?.setState({ isToastDismissed: false });
      } catch {}
    }

    // Determine target version higher than current
    const currentParts = (this.currentVersion || '0.0.20').replace(/^v/, '').split('.').map((p) => parseInt(p, 10) || 0);
    while (currentParts.length < 3) currentParts.push(0);
    currentParts[2] += 1;
    const targetVersion = currentParts.join('.');

    const totalBytes = 15414272; // ~14.7 MB
    const manifest: ReleaseManifest = {
      version: targetVersion,
      notes: 'New productivity features, performance improvements, and security enhancements.',
      pub_date: new Date().toISOString(),
      url: `https://gphost.eu.cc/releases/downex/v${targetVersion}/Downex-Update.tar.gz`,
      signature: 'SIMULATED_SIGNATURE',
      size: totalBytes,
    };

    this.isSimulating = true;
    this.isBusy = false;

    switch (mode) {
      case 'available':
        this.notify({
          state: 'available',
          targetVersion,
          manifest,
          progress: undefined,
          errorMessage: undefined,
        });
        break;

      case 'downloading':
        this.simulateLiveDownload(targetVersion, 2500);
        break;

      case 'verifying':
        this.notify({
          state: 'verifying',
          targetVersion,
          manifest,
          progress: {
            percentage: 100,
            downloadedBytes: totalBytes,
            totalBytes,
          },
          errorMessage: undefined,
        });
        break;

      case 'queued':
        this.notify({
          state: 'queued',
          targetVersion,
          manifest,
          progress: undefined,
          errorMessage: undefined,
        });
        break;

      case 'patching':
        this.notify({
          state: 'patching',
          targetVersion,
          manifest,
          progress: undefined,
          errorMessage: undefined,
        });
        break;

      case 'ready':
        this.stagedBinaryPath = `mock/staged/downex-v${targetVersion}.staged.exe`;
        this.notify({
          state: 'ready',
          targetVersion,
          manifest,
          stagedPath: this.stagedBinaryPath,
          progress: undefined,
          errorMessage: undefined,
        });
        break;

      case 'restarting':
        this.notify({
          state: 'restarting',
          targetVersion,
          manifest,
          progress: undefined,
          errorMessage: undefined,
        });
        break;

      case 'error':
        this.notify({
          state: 'error',
          targetVersion,
          manifest,
          errorMessage: 'Server connection timed out while fetching update package.',
        });
        break;

      case 'idle':
        this.isSimulating = false;
        this.notify({
          state: 'idle',
          targetVersion: undefined,
          manifest: null,
          progress: undefined,
          errorMessage: undefined,
        });
        break;

      case 'auto':
      default:
        this.notify({
          state: 'available',
          targetVersion,
          manifest,
          progress: undefined,
          errorMessage: undefined,
        });
        setTimeout(() => {
          if (this.isSimulating && this.status.state === 'available') {
            this.runSimulatedDownload(targetVersion, manifest, 3500, 1800);
          }
        }, 1200);
        break;
    }
  }

  public resetToBaseVersion() {
    if (this.resetTimer) clearTimeout(this.resetTimer);
    if (this.simulationTimer) clearInterval(this.simulationTimer);
    if (this.pacingInterval) clearInterval(this.pacingInterval);
    this.resetTimer = null;
    this.simulationTimer = null;
    this.pacingInterval = null;
    this.isBusy = false;
    this.isSimulating = false;
    this.stagedBinaryPath = null;
    this.currentVersion = APP_BASE_VERSION;
    this.status = {
      state: 'idle',
      currentVersion: APP_BASE_VERSION,
    };
    this.notify({
      state: 'idle',
      currentVersion: APP_BASE_VERSION,
      targetVersion: undefined,
      manifest: null as any,
      progress: undefined,
      errorMessage: undefined,
      stagedPath: undefined,
    });
  }

  public cancelSimulation() {
    this.simulateUpdate('idle');
  }
}

export const updateService = new UpdateService();

if (typeof window !== 'undefined') {
  (window as any).updateService = updateService;
  (window as any).simulateUpdate = (mode?: any) => updateService.simulateUpdate(mode);
  (window as any).downexSimulate = (mode?: any) => updateService.simulateUpdate(mode);
}
