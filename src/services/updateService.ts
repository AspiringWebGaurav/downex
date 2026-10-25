/**
 * Downex — In-Process OTA Update Service
 * Implements reliable release discovery, binary streaming, AES-256-GCM verification,
 * NTFS atomic swap, and rollback recovery.
 */

import { checkUpdates, writeUpdateStagingFile, applyInProcessUpdate, setTrayIcon, verifyUpdateSignature } from './tauriService';
import { unpackOtaPayload } from './otaContainer';
import { ReleaseManifest } from '../types/download';
import { cleanVersion, compareSemver } from '../utils/version';

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
  | 'ready'
  | 'installing'
  | 'restarting'
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
}

export type UpdateStatusListener = (status: UpdateStatus) => void;

class UpdateService {
  private currentVersion = '0.0.0';
  private status: UpdateStatus = {
    state: 'idle',
    currentVersion: '0.0.0',
  };
  private listeners = new Set<UpdateStatusListener>();
  private stagedBinaryPath: string | null = null;
  private isBusy = false;

  public subscribe(listener: UpdateStatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  private notify(updates: Partial<UpdateStatus>) {
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
    this.currentVersion = cleanVersion(ver);
    this.notify({ currentVersion: this.currentVersion });
  }

  /**
   * Check GPHost for the latest release manifest
   */
  public async checkForUpdates(silent = false): Promise<ReleaseManifest | null> {
    if (this.isBusy) return null;

    if (!silent) {
      this.notify({ state: 'checking', errorMessage: undefined });
    }

    try {
      const manifest = await checkUpdates();

      if (manifest && compareSemver(manifest.version, this.currentVersion) > 0) {
        this.notify({
          state: 'available',
          targetVersion: cleanVersion(manifest.version),
          manifest,
          errorMessage: undefined,
        });
        return manifest;
      } else {
        if (!silent) {
          this.notify({
            state: 'up-to-date',
            manifest: null,
            targetVersion: undefined,
            errorMessage: undefined,
          });
          setTimeout(() => {
            if (this.status.state === 'up-to-date') {
              this.notify({ state: 'idle' });
            }
          }, 3500);
        } else {
          this.notify({ state: 'idle', manifest: null });
        }
        return null;
      }
    } catch (err: any) {
      console.warn('[Downex OTA] Update check failed:', err);
      if (!silent) {
        this.notify({
          state: 'error',
          errorMessage: err?.message || 'Check failed',
        });
        setTimeout(() => {
          if (this.status.state === 'error') {
            this.notify({ state: 'idle', errorMessage: undefined });
          }
        }, 4000);
      }
      return null;
    }
  }

  /**
   * Asynchronously download, authenticate, and stage the update package
   */
  public async downloadUpdate(): Promise<boolean> {
    const { manifest, targetVersion } = this.status;
    if (!manifest || !manifest.url || !targetVersion) {
      this.notify({ state: 'error', errorMessage: 'No update manifest available to download' });
      return false;
    }

    this.isBusy = true;
    this.notify({
      state: 'downloading',
      progress: { downloadedBytes: 0, totalBytes: manifest.size || 0, percentage: 0 },
      errorMessage: undefined,
    });

    try {
      // 1. Stream download container from GPHost Cloudflare R2
      const response = await fetch(manifest.url, {
        headers: { 'Cache-Control': 'no-cache' },
      });

      if (!response.ok) {
        throw new Error(`Failed to download update container: HTTP ${response.status}`);
      }

      const contentLength = Number(response.headers.get('Content-Length')) || manifest.size || 0;
      const reader = response.body?.getReader();

      if (!reader) {
        // Fallback buffer
        const buffer = await response.arrayBuffer();
        return await this.verifyAndStage(buffer, targetVersion);
      }

      let receivedBytes = 0;
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedBytes += value.length;

        const percentage = contentLength > 0 ? Math.min(100, Math.round((receivedBytes / contentLength) * 100)) : 50;
        this.notify({
          state: 'downloading',
          progress: {
            downloadedBytes: receivedBytes,
            totalBytes: contentLength,
            percentage,
          },
        });
      }

      // Concatenate chunks
      const fullBuffer = new Uint8Array(receivedBytes);
      let offset = 0;
      for (const chunk of chunks) {
        fullBuffer.set(chunk, offset);
        offset += chunk.length;
      }

      return await this.verifyAndStage(fullBuffer.buffer as ArrayBuffer, targetVersion);
    } catch (err: any) {
      console.error('[Downex OTA] Download failed:', err);
      this.isBusy = false;
      this.notify({
        state: 'error',
        errorMessage: err?.message || 'Download error',
      });
      return false;
    }
  }

  /**
   * Decrypt container and stage verified binary
   */
  private async verifyAndStage(rawBuffer: ArrayBuffer, targetVersion: string): Promise<boolean> {
    this.notify({ state: 'verifying' });

    try {
      // 1. Minisign Ed25519 cryptographic signature verification
      const signature = this.status.manifest?.signature;
      if (signature && signature.trim().length > 0) {
        const rawBytes = new Uint8Array(rawBuffer);
        const valid = await verifyUpdateSignature(rawBytes, signature.trim());
        if (!valid) {
          throw new Error('Ed25519 signature verification failed! Update rejected for security.');
        }
      }

      // 2. Decrypt and authenticate payload using WebCrypto AES-GCM
      const unpacked = await unpackOtaPayload(rawBuffer);

      // 3. Write verified executable into temporary staging directory
      const stagingFilename = `downex-v${targetVersion}.staged.exe`;
      const stagedPath = await writeUpdateStagingFile(stagingFilename, unpacked.payload);

      this.stagedBinaryPath = stagedPath;
      this.isBusy = false;

      this.notify({
        state: 'ready',
        stagedPath,
        errorMessage: undefined,
      });

      return true;
    } catch (err: any) {
      console.error('[Downex OTA] Verification failed:', err);
      this.isBusy = false;
      this.notify({
        state: 'error',
        errorMessage: err?.message || 'Verification failed',
      });
      return false;
    }
  }

  /**
   * Perform in-process NTFS atomic swap and restart
   * Requires explicit user approval
   */
  public async installAndRestart(): Promise<void> {
    const { targetVersion } = this.status;
    if (!this.stagedBinaryPath || !targetVersion) {
      this.notify({ state: 'error', errorMessage: 'No verified staged update available' });
      return;
    }

    this.notify({ state: 'installing' });

    try {
      await applyInProcessUpdate({
        stagingPath: this.stagedBinaryPath,
        targetVersion,
        signature: this.status.manifest?.signature || undefined,
      });

      this.notify({ state: 'restarting' });
    } catch (err: any) {
      console.error('[Downex OTA] In-process atomic swap failed:', err);
      this.notify({
        state: 'error',
        errorMessage: `Installation failed: ${err?.message || err}`,
      });
    }
  }
}

export const updateService = new UpdateService();
