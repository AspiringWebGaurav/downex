import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { DownloadItem, DownloadProgressEvent, ReleaseManifest } from '../types/download';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface ProbeResult {
  url: string;
  filename: string;
  total_bytes?: number;
  supports_ranges: boolean;
  etag?: string;
  last_modified?: string;
}

export async function probeUrl(url: string, headers?: Record<string, string>): Promise<ProbeResult | null> {
  if (!isTauri) {
    const filename = url.split('/').pop()?.split('?')[0] || 'download.bin';
    return {
      url,
      filename,
      total_bytes: 524288000,
      supports_ranges: true,
    };
  }
  try {
    return await invoke<ProbeResult>('cmd_probe_url', { url, headers });
  } catch (e) {
    console.warn('Probe URL failed:', e);
    return null;
  }
}

export async function addDownload(
  url: string,
  destinationFolder?: string,
  queueId?: string,
  headers?: Record<string, string>,
  startImmediately = true,
  customFilename?: string,
): Promise<DownloadItem> {
  if (!isTauri) {
    // Mock browser preview
    const name = customFilename || url.split('/').pop() || 'file.bin';
    return {
      id: 'mock-' + Date.now(),
      url,
      filename: name,
      destination_path: 'C:\\Downloads\\' + name,
      total_bytes: 104857600,
      downloaded_bytes: 0,
      status: startImmediately ? 'downloading' : 'paused',
      queue_id: 'default',
      speed_bytes_sec: 15728640,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
  }
  return await invoke('cmd_add_download', {
    url,
    destinationFolder,
    queueId,
    headers,
    startImmediately,
    customFilename,
  });
}

export async function pauseDownload(id: string): Promise<boolean> {
  if (!isTauri) return true;
  return await invoke('cmd_pause_download', { id });
}

export async function resumeDownload(id: string): Promise<boolean> {
  if (!isTauri) return true;
  return await invoke('cmd_resume_download', { id });
}

export async function cancelDownload(id: string, deleteFile = false): Promise<boolean> {
  if (!isTauri) return true;
  return await invoke('cmd_cancel_download', { id, deleteFile });
}

export async function startQueue(): Promise<number> {
  if (!isTauri) return 0;
  return await invoke<number>('cmd_start_queue');
}

export async function pauseQueue(): Promise<boolean> {
  if (!isTauri) return true;
  return await invoke<boolean>('cmd_pause_queue');
}

export async function isQueueRunning(): Promise<boolean> {
  if (!isTauri) return false;
  return await invoke<boolean>('cmd_is_queue_running');
}

export async function queueDownload(id: string): Promise<boolean> {
  if (!isTauri) return true;
  return await invoke<boolean>('cmd_queue_download', { id });
}

export async function getDownloads(): Promise<DownloadItem[]> {
  if (!isTauri) return [];
  return await invoke('cmd_get_downloads');
}

export async function getDefaultDownloadDir(): Promise<string> {
  if (!isTauri) return 'C:\\Downloads\\Downex';
  return await invoke<string>('cmd_get_default_download_dir');
}

export async function setDefaultDownloadDir(newDir: string): Promise<string> {
  if (!isTauri) return newDir;
  return await invoke<string>('cmd_set_default_download_dir', { newDir });
}

export async function getMaxSegments(): Promise<number> {
  if (!isTauri) return 32;
  return await invoke<number>('cmd_get_max_segments');
}

export async function setMaxSegments(count: number): Promise<number> {
  if (!isTauri) return count;
  return await invoke<number>('cmd_set_max_segments', { count });
}

export async function changeDownloadDestination(id: string, newFolder: string): Promise<boolean> {
  if (!isTauri) return true;
  return await invoke<boolean>('cmd_change_download_destination', { id, newFolder });
}

export async function openFolderPicker(): Promise<string | null> {
  if (!isTauri) return null;
  return await invoke<string | null>('cmd_open_folder_picker');
}

export async function checkUpdates(): Promise<ReleaseManifest | null> {
  if (!isTauri) return null;
  return await invoke('cmd_check_updates');
}

export async function getResolvedVersion(): Promise<string> {
  if (!isTauri) return '0.0.0';
  try {
    return await invoke<string>('cmd_get_resolved_version');
  } catch {
    return '0.0.0';
  }
}

export async function syncWindowsInstalledVersion(version?: string): Promise<string> {
  if (!isTauri) return version || '0.0.0';
  return await invoke<string>('cmd_sync_windows_installed_version', { version });
}

export async function writeUpdateStagingFile(fileName: string, bytes: Uint8Array): Promise<string> {
  if (!isTauri) return 'mock/staged/' + fileName;
  return await invoke<string>('cmd_write_update_staging_file', {
    fileName,
    bytes: Array.from(bytes),
  });
}

export async function applyInProcessUpdate(options: {
  binaryBytes?: Uint8Array;
  stagingPath?: string;
  targetVersion?: string;
}): Promise<void> {
  if (!isTauri) {
    alert(`[Mock Mode] Applied in-process update to ${options.targetVersion}!`);
    return;
  }
  await invoke('cmd_apply_in_process_update', {
    binaryBytes: options.binaryBytes ? Array.from(options.binaryBytes) : null,
    stagingPath: options.stagingPath || null,
    targetVersion: options.targetVersion || null,
  });
}

export async function cleanSupersededOldBinaries(): Promise<boolean> {
  if (!isTauri) return false;
  return await invoke<boolean>('cmd_clean_superseded_old_binaries');
}

export async function minimizeToBackground(): Promise<void> {
  if (isTauri) {
    await invoke('cmd_minimize_to_background');
  }
}

export async function quitApp(): Promise<void> {
  if (isTauri) {
    await invoke('cmd_quit_app');
  }
}

export async function setTrayIcon(state: 'idle' | 'update_available' | 'downloading' | 'ready'): Promise<void> {
  if (isTauri) {
    try {
      await invoke('cmd_set_tray_icon', { state });
    } catch (e) {
      console.warn('Failed to set tray icon:', e);
    }
  }
}

export function onDownloadProgress(callback: (event: DownloadProgressEvent) => void): () => void {
  if (!isTauri) return () => {};
  let isCancelled = false;
  let unlistenFn: (() => void) | null = null;

  listen<DownloadProgressEvent>('download-progress', (e) => {
    if (!isCancelled) {
      callback(e.payload);
    }
  })
    .then((fn) => {
      if (isCancelled) {
        fn();
      } else {
        unlistenFn = fn;
      }
    })
    .catch((err) => {
      console.error('[Downex] Error listening to download-progress:', err);
    });

  return () => {
    isCancelled = true;
    if (unlistenFn) {
      unlistenFn();
      unlistenFn = null;
    }
  };
}

export function onOpenNewDownloadModal(callback: () => void): () => void {
  if (!isTauri) return () => {};
  let isCancelled = false;
  let unlistenFn: (() => void) | null = null;

  listen('open-new-download-modal', () => {
    if (!isCancelled) {
      callback();
    }
  })
    .then((fn) => {
      if (isCancelled) {
        fn();
      } else {
        unlistenFn = fn;
      }
    })
    .catch((err) => {
      console.error('[Downex] Error listening to open-new-download-modal:', err);
    });

  return () => {
    isCancelled = true;
    if (unlistenFn) {
      unlistenFn();
      unlistenFn = null;
    }
  };
}

export function onRefreshDownloads(callback: () => void): () => void {
  if (!isTauri) return () => {};
  let isCancelled = false;
  let unlistenFn: (() => void) | null = null;

  listen('refresh-downloads', () => {
    if (!isCancelled) {
      callback();
    }
  })
    .then((fn) => {
      if (isCancelled) {
        fn();
      } else {
        unlistenFn = fn;
      }
    })
    .catch((err) => {
      console.error('[Downex] Error listening to refresh-downloads:', err);
    });

  return () => {
    isCancelled = true;
    if (unlistenFn) {
      unlistenFn();
      unlistenFn = null;
    }
  };
}

export interface DownloadInfoModalPayload {
  url: string;
  filename?: string;
  total_bytes?: number;
  supports_ranges?: boolean;
  cookies?: string;
  referer?: string;
  user_agent?: string;
  standalone_modal?: boolean;
}

export async function restoreManagerWindow(): Promise<void> {
  if (!isTauri) return;
  try {
    await invoke('cmd_restore_manager_window');
  } catch (e) {
    console.warn('Failed to restore manager window:', e);
  }
}

export async function hideMainWindow(): Promise<void> {
  if (!isTauri) return;
  try {
    await invoke('cmd_hide_main_window');
  } catch (e) {
    console.warn('Failed to hide main window:', e);
  }
}

export async function showDownloadDialog(payload?: DownloadInfoModalPayload): Promise<void> {
  if (!isTauri) {
    window.dispatchEvent(new CustomEvent('downex-open-new-download', { detail: payload }));
    return;
  }
  try {
    await invoke('cmd_show_download_dialog', { payload: payload || null });
  } catch (e) {
    console.warn('Failed to show download dialog:', e);
  }
}

export async function closeDownloadDialog(): Promise<void> {
  if (!isTauri) return;
  try {
    await invoke('cmd_close_download_dialog');
  } catch (e) {
    console.warn('Failed to close download dialog:', e);
  }
}

export async function getDownloadDialogPayload(): Promise<DownloadInfoModalPayload | null> {
  if (!isTauri) return null;
  try {
    return await invoke<DownloadInfoModalPayload | null>('cmd_get_download_dialog_payload');
  } catch {
    return null;
  }
}

export async function getDiskFreeSpace(path: string): Promise<number> {
  if (!isTauri) return 142 * 1024 * 1024 * 1024; // Mock 142 GB in browser
  try {
    return await invoke<number>('cmd_get_disk_free_space', { path });
  } catch (e) {
    console.warn('Failed to get disk free space:', e);
    return 0;
  }
}

export function onOpenDownloadInfoModal(callback: (payload: DownloadInfoModalPayload) => void): () => void {
  if (!isTauri) return () => {};
  let isCancelled = false;
  let unlistenFn: (() => void) | null = null;

  listen<DownloadInfoModalPayload>('open-download-info-modal', (event) => {
    if (!isCancelled && event.payload) {
      callback(event.payload);
    }
  })
    .then((fn) => {
      if (isCancelled) {
        fn();
      } else {
        unlistenFn = fn;
      }
    })
    .catch((err) => {
      console.error('[Downex] Error listening to open-download-info-modal:', err);
    });

  return () => {
    isCancelled = true;
    if (unlistenFn) {
      unlistenFn();
      unlistenFn = null;
    }
  };
}

export interface DownloadCompletePayload {
  id: string;
  url: string;
  filename: string;
  destination_path: string;
  total_bytes?: number | null;
  downloaded_bytes?: number | null;
}

export async function openFile(path: string): Promise<void> {
  if (!isTauri) {
    alert(`[Preview Mode] Open file: ${path}`);
    return;
  }
  await invoke('cmd_open_file', { path });
}

export async function openFileWith(path: string): Promise<void> {
  if (!isTauri) {
    alert(`[Preview Mode] Open with...: ${path}`);
    return;
  }
  await invoke('cmd_open_file_with', { path });
}

export async function openFileFolder(path: string): Promise<void> {
  if (!isTauri) {
    alert(`[Preview Mode] Open folder: ${path}`);
    return;
  }
  await invoke('cmd_open_file_folder', { path });
}

export async function showDownloadCompleteDialog(payload?: DownloadCompletePayload): Promise<void> {
  if (isTauri) {
    await invoke('cmd_show_download_complete', { payload: payload || null });
  }
}

export async function closeDownloadCompleteDialog(): Promise<void> {
  if (isTauri) {
    await invoke('cmd_close_download_complete');
  }
}

export async function getDownloadCompletePayload(): Promise<DownloadCompletePayload | null> {
  if (!isTauri) return null;
  return await invoke<DownloadCompletePayload | null>('cmd_get_download_complete_payload');
}

export function onDownloadCompleted(callback: (payload: DownloadCompletePayload) => void): () => void {
  if (!isTauri) return () => {};
  let isCancelled = false;
  let unlistenFn: (() => void) | null = null;

  listen<DownloadCompletePayload>('download-completed', (e) => {
    if (!isCancelled) {
      callback(e.payload);
    }
  })
    .then((fn) => {
      if (isCancelled) {
        fn();
      } else {
        unlistenFn = fn;
      }
    })
    .catch((err) => {
      console.error('[Downex] Error listening to download-completed:', err);
    });

  return () => {
    isCancelled = true;
    if (unlistenFn) {
      unlistenFn();
      unlistenFn = null;
    }
  };
}




