import { invoke, isTauri as coreIsTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { DownloadItem, DownloadProgressEvent, ReleaseManifest } from '../types/download';
import { cleanVersion, compareSemver } from '../utils/version';
import { getLatestCodebaseVersion } from '../data/patchNotes';

export function isTauriEnv(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    (window as any).isTauri ||
    (typeof coreIsTauri === 'function' && coreIsTauri()) ||
    '__TAURI_INTERNALS__' in window ||
    '__TAURI__' in window ||
    (window.location && window.location.origin && window.location.origin.includes('tauri.localhost'))
  );
}

export const isTauri = isTauriEnv();

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
// Local browser mock state for browser preview / Playwright testing
let mockDownloads: DownloadItem[] = [];
let mockQueueRunning = false;

function loadMockDownloads(): DownloadItem[] {
  if (typeof window === 'undefined') return mockDownloads;
  try {
    const raw = sessionStorage.getItem('downex_mock_downloads');
    if (raw) {
      mockDownloads = JSON.parse(raw);
    }
  } catch {}
  return mockDownloads;
}

function saveMockDownloads(items: DownloadItem[]) {
  mockDownloads = items;
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(items));
    } catch {}
  }
}

export function injectMockDownloadItem(item: DownloadItem): void {
  const current = loadMockDownloads().filter((i) => i.id !== item.id && i.filename !== item.filename);
  saveMockDownloads([item, ...current]);
}

export function clearMockDownloads(): void {
  saveMockDownloads([]);
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
    // Mock browser preview with persistent local storage
    const name = customFilename || url.split('/').pop()?.split('?')[0] || 'file.bin';
    const folder = destinationFolder || (typeof localStorage !== 'undefined' ? localStorage.getItem('downex_default_dir') : null) || 'C:\\Downloads\\Downex';
    const dest = folder.endsWith('\\') ? folder + name : `${folder}\\${name}`;
    const newItem: DownloadItem = {
      id: 'mock-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
      url,
      filename: name,
      destination_path: dest,
      total_bytes: 104857600,
      downloaded_bytes: startImmediately ? 26214400 : 0,
      status: startImmediately ? 'downloading' : 'queued',
      queue_id: queueId || 'default',
      speed_bytes_sec: startImmediately ? 15728640 : 0,
      eta_seconds: startImmediately ? 5 : null,
      created_at: Date.now(),
      updated_at: Date.now(),
      segments: [
        { index: 0, start: 0, end: 26214400, downloaded: 13107200, speed_bytes_sec: 3932160, is_active: startImmediately },
        { index: 1, start: 26214400, end: 52428800, downloaded: 6553600, speed_bytes_sec: 3932160, is_active: startImmediately },
        { index: 2, start: 52428800, end: 78643200, downloaded: 3276800, speed_bytes_sec: 3932160, is_active: startImmediately },
        { index: 3, start: 78643200, end: 104857600, downloaded: 3276800, speed_bytes_sec: 3932160, is_active: startImmediately },
      ],
    };
    const current = loadMockDownloads();
    saveMockDownloads([newItem, ...current]);
    return newItem;
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
  if (!isTauri) {
    const list = loadMockDownloads().map((item) =>
      item.id === id ? { ...item, status: 'paused' as const, speed_bytes_sec: 0 } : item
    );
    saveMockDownloads(list);
    return true;
  }
  return await invoke('cmd_pause_download', { id });
}

export async function resumeDownload(id: string): Promise<boolean> {
  if (!isTauri) {
    const list = loadMockDownloads().map((item) =>
      item.id === id ? { ...item, status: 'downloading' as const, speed_bytes_sec: 10485760 } : item
    );
    saveMockDownloads(list);
    return true;
  }
  return await invoke('cmd_resume_download', { id });
}

export async function cancelDownload(id: string, deleteFile = false): Promise<boolean> {
  if (!isTauri) {
    const list = loadMockDownloads().filter((item) => item.id !== id);
    saveMockDownloads(list);
    return true;
  }
  return await invoke('cmd_cancel_download', { id, deleteFile });
}

export async function startQueue(): Promise<number> {
  if (!isTauri) {
    mockQueueRunning = true;
    const list = loadMockDownloads().map((item) =>
      item.status === 'queued' ? { ...item, status: 'downloading' as const, speed_bytes_sec: 12582912 } : item
    );
    saveMockDownloads(list);
    return 1;
  }
  return await invoke<number>('cmd_start_queue');
}

export async function pauseQueue(): Promise<boolean> {
  if (!isTauri) {
    mockQueueRunning = false;
    return true;
  }
  return await invoke<boolean>('cmd_pause_queue');
}

export async function isQueueRunning(): Promise<boolean> {
  if (!isTauri) return mockQueueRunning;
  return await invoke<boolean>('cmd_is_queue_running');
}

export async function queueDownload(id: string): Promise<boolean> {
  if (!isTauri) {
    const list = loadMockDownloads().map((item) =>
      item.id === id ? { ...item, status: 'queued' as const, speed_bytes_sec: 0 } : item
    );
    saveMockDownloads(list);
    return true;
  }
  return await invoke<boolean>('cmd_queue_download', { id });
}

export async function getDownloads(): Promise<DownloadItem[]> {
  if (!isTauri) return loadMockDownloads();
  return await invoke('cmd_get_downloads');
}

export async function getDefaultDownloadDir(): Promise<string> {
  if (!isTauri) {
    try {
      return localStorage.getItem('downex_default_dir') || 'C:\\Downloads\\Downex';
    } catch {
      return 'C:\\Downloads\\Downex';
    }
  }
  return await invoke<string>('cmd_get_default_download_dir');
}

export async function setDefaultDownloadDir(newDir: string): Promise<string> {
  if (!isTauri) {
    const target = newDir.trim() || 'C:\\Downloads\\Downex';
    try {
      localStorage.setItem('downex_default_dir', target);
    } catch {}
    return target;
  }
  return await invoke<string>('cmd_set_default_download_dir', { newDir });
}

export async function getMaxSegments(): Promise<number> {
  if (!isTauri) {
    try {
      const v = localStorage.getItem('downex_max_segments');
      return v ? parseInt(v, 10) : 32;
    } catch {
      return 32;
    }
  }
  return await invoke<number>('cmd_get_max_segments');
}

export async function setMaxSegments(count: number): Promise<number> {
  if (!isTauri) {
    try {
      localStorage.setItem('downex_max_segments', String(count));
    } catch {}
    return count;
  }
  return await invoke<number>('cmd_set_max_segments', { count });
}

export async function getLifetimeDownloadedBytes(): Promise<number> {
  if (!isTauri) {
    try {
      const v = localStorage.getItem('downex_lifetime_downloaded_bytes');
      return v ? parseInt(v, 10) || 0 : 0;
    } catch {
      return 0;
    }
  }
  try {
    return await invoke<number>('cmd_get_lifetime_downloaded_bytes');
  } catch (err) {
    console.warn('[Downex DB] Failed to get lifetime downloaded bytes:', err);
    return 0;
  }
}

export async function setLifetimeDownloadedBytes(bytes: number): Promise<number> {
  if (!isTauri) {
    try {
      localStorage.setItem('downex_lifetime_downloaded_bytes', String(bytes));
    } catch {}
    return bytes;
  }
  try {
    return await invoke<number>('cmd_set_lifetime_downloaded_bytes', { bytes });
  } catch (err) {
    console.warn('[Downex DB] Failed to set lifetime downloaded bytes:', err);
    return bytes;
  }
}

export async function isAutostartEnabled(): Promise<boolean> {
  if (!isTauri) {
    try {
      const v = localStorage.getItem('downex_autostart_enabled');
      return v !== 'false'; // Default to true
    } catch {
      return true;
    }
  }
  try {
    return await invoke<boolean>('cmd_is_autostart_enabled');
  } catch (e) {
    console.warn('[Downex Autostart] Error checking status:', e);
    return false;
  }
}

export async function setAutostartEnabled(enabled: boolean): Promise<boolean> {
  if (!isTauri) {
    try {
      localStorage.setItem('downex_autostart_enabled', String(enabled));
    } catch {}
    return enabled;
  }
  return await invoke<boolean>('cmd_set_autostart', { enabled });
}


export async function changeDownloadDestination(id: string, newFolder: string): Promise<boolean> {
  if (!isTauri) {
    const list = loadMockDownloads().map((item) => {
      if (item.id === id) {
        const dest = newFolder.endsWith('\\') ? newFolder + item.filename : `${newFolder}\\${item.filename}`;
        return { ...item, destination_path: dest };
      }
      return item;
    });
    saveMockDownloads(list);
    return true;
  }
  return await invoke<boolean>('cmd_change_download_destination', { id, newFolder });
}

export async function openFolderPicker(): Promise<string | null> {
  if (!isTauri) return 'D:\\Downloads\\CustomDownexFolder';
  return await invoke<string | null>('cmd_open_folder_picker');
}

export async function fetchUpdateManifest(url: string): Promise<string> {
  // Always try native Rust command first if in Tauri or invoke is available
  try {
    return await invoke<string>('cmd_fetch_update_manifest', { url });
  } catch (nativeErr) {
    console.warn('[Downex OTA] Native cmd_fetch_update_manifest notice:', nativeErr);
    // Secondary native fallback: try cmd_check_updates
    try {
      const manifestObj = await invoke<any>('cmd_check_updates');
      if (manifestObj) {
        return JSON.stringify(manifestObj);
      }
      return JSON.stringify({ no_release: true });
    } catch {}

    // Fallback for browser preview / mock mode: try Vite proxy first
    try {
      const fetchUrl = url.startsWith('https://gphost.eu.cc')
        ? url.replace('https://gphost.eu.cc', '')
        : url;
      const res = await fetch(fetchUrl);
      if (res.ok) return await res.text();
      if (res.status === 404 || res.status === 204) return JSON.stringify({ no_release: true });
    } catch {}

    // Secondary fallback: direct URL
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
      if (res.status === 404 || res.status === 204) return JSON.stringify({ no_release: true });
    } catch {}

    return JSON.stringify({ no_release: true });
  }
}

export async function downloadUpdateBinary(url: string): Promise<Uint8Array> {
  // 1. Primary: Native Rust reqwest client with standard browser User-Agent and stream chunks
  if (isTauri) {
    try {
      const bytes = await invoke<number[]>('cmd_download_update_binary', { url });
      return new Uint8Array(bytes);
    } catch (nativeErr: any) {
      console.warn('[Downex OTA] Native download binary notice:', nativeErr);
      try {
        const bytes = await invoke<number[]>('cmd_download_update_container', { url });
        return new Uint8Array(bytes);
      } catch (containerErr: any) {
        console.warn('[Downex OTA] Native download container notice:', containerErr);
      }
    }
  }

  // 2. Secondary fallback: Web fetch with absolute URL (NEVER strip domain or hit local SPA server)
  const fullUrl = url.startsWith('http') ? url : `https://gphost.eu.cc${url}`;
  const res = await fetch(fullUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Accept': 'application/octet-stream, application/binary, */*',
    },
  });

  if (!res.ok) {
    throw new Error(`Update binary download failed: HTTP ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/html') || contentType.includes('application/xml') || contentType.includes('text/xml')) {
    throw new Error(`Invalid update response: Expected binary stream but server returned ${contentType} (HTTP ${res.status})`);
  }

  const buf = await res.arrayBuffer();
  if (buf.byteLength < 100_000) {
    throw new Error(`Update package truncated or invalid: received ${buf.byteLength} bytes (expected >= 100 KB)`);
  }

  return new Uint8Array(buf);
}

export async function getClipboardText(): Promise<string> {
  if (isTauriEnv() || isTauri) {
    try {
      return await invoke<string>('cmd_get_clipboard_text');
    } catch {
      return '';
    }
  }
  // In pure browser dev preview outside Tauri: never prompt for clipboard unless in normal browser
  if (typeof window !== 'undefined' && window.location && !window.location.origin.includes('tauri.localhost')) {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.readText) {
      try {
        return await navigator.clipboard.readText();
      } catch {
        return '';
      }
    }
  }
  return '';
}

export async function checkUpdates(): Promise<ReleaseManifest | null> {
  if (!isTauri) return null;
  return await invoke('cmd_check_updates');
}

export async function getResolvedVersion(): Promise<string> {
  const latestCodebase = getLatestCodebaseVersion();

  // In browser preview, web demo, or local Vite development server:
  // Dynamically resolve to the active codebase version so dev always runs the latest
  if (!isTauri || (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV)) {
    try {
      const persisted = localStorage.getItem('downex_persisted_version');
      if (persisted && persisted !== '0.0.0') {
        const pClean = cleanVersion(persisted);
        if (compareSemver(pClean, latestCodebase) >= 0) {
          return pClean;
        }
      }
      return latestCodebase;
    } catch {
      return latestCodebase;
    }
  }

  try {
    const nativeVer = await invoke<string>('cmd_get_resolved_version');
    const clean = cleanVersion(nativeVer);
    // If native reports 0.0.0 (e.g. unpatched debug base), fallback dynamically to the codebase version
    if (clean === '0.0.0') {
      return latestCodebase;
    }
    return clean;
  } catch {
    return latestCodebase;
  }
}

export async function syncWindowsInstalledVersion(version?: string): Promise<string> {
  if (version) {
    try {
      localStorage.setItem('downex_persisted_version', version);
    } catch {}
  }
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

export async function getStagedUpdate(targetVersion: string): Promise<string | null> {
  if (!isTauri) return null;
  try {
    return await invoke<string | null>('cmd_get_staged_update', { targetVersion });
  } catch (err) {
    console.warn('[Downex OTA] cmd_get_staged_update notice:', err);
    return null;
  }
}

export function onOtaDownloadProgress(
  callback: (progress: { downloaded: number; total: number; percentage: number }) => void
): () => void {
  if (!isTauri) return () => {};
  let unlistenFn: (() => void) | undefined;
  listen<{ downloaded: number; total: number; percentage: number }>('ota-download-progress', (e) => {
    callback(e.payload);
  }).then((un) => {
    unlistenFn = un;
  });
  return () => {
    if (unlistenFn) unlistenFn();
  };
}

export async function downloadUpdateContainer(url: string): Promise<Uint8Array> {
  if (!isTauri) {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }
  const bytes = await invoke<number[]>('cmd_download_update_container', { url });
  return new Uint8Array(bytes);
}

export async function verifyUpdateSignature(containerBytes: Uint8Array, signature: string): Promise<boolean> {
  if (!isTauri) return true;
  return await invoke<boolean>('cmd_verify_update_signature', {
    containerBytes: Array.from(containerBytes),
    signature,
  });
}

export async function applyInProcessUpdate(options: {
  binaryBytes?: Uint8Array;
  stagingPath?: string;
  targetVersion?: string;
}): Promise<void> {
  if (options.targetVersion) {
    try {
      localStorage.setItem('downex_persisted_version', options.targetVersion);
    } catch {}
  }
  if (!isTauri) {
    console.log(`[Mock Mode] Applied in-process update to ${options.targetVersion}!`);
    return;
  }
  await invoke('cmd_apply_in_process_update', {
    binaryBytes: options.binaryBytes ? Array.from(options.binaryBytes) : null,
    stagingPath: options.stagingPath || null,
    targetVersion: options.targetVersion || null,
  });
}

export async function refreshShellIcons(): Promise<void> {
  if (isTauri) {
    try {
      await invoke('cmd_refresh_shell_icons');
    } catch {}
  }
}

export async function notifyDomReady(): Promise<void> {
  if (isTauri) {
    try {
      await invoke('cmd_notify_dom_ready');
    } catch {}
  }
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

export async function getPendingUpdate(): Promise<ReleaseManifest | null> {
  if (isTauri) {
    try {
      return await invoke<ReleaseManifest | null>('cmd_get_pending_update');
    } catch (e) {
      console.warn('Failed to get pending update:', e);
    }
  }
  return null;
}

export async function getTrayUpdateStatus(): Promise<string> {
  if (isTauri) {
    try {
      return await invoke<string>('cmd_get_tray_update_status');
    } catch (e) {
      console.warn('Failed to get tray update status:', e);
    }
  }
  return 'idle';
}

export async function triggerBackgroundUpdateCheck(): Promise<void> {
  if (isTauri) {
    try {
      await invoke('cmd_trigger_background_update_check');
    } catch (e) {
      console.warn('Failed to trigger background update check:', e);
    }
  }
}

export function onUpdateDetected(callback: (manifest: ReleaseManifest) => void): () => void {
  if (!isTauri) return () => {};
  let isCancelled = false;
  let unlistenFn: (() => void) | null = null;

  listen<ReleaseManifest>('downex-update-detected', (event) => {
    if (!isCancelled && event.payload) {
      callback(event.payload);
    }
  })
    .then((unlisten) => {
      if (isCancelled) {
        unlisten();
      } else {
        unlistenFn = unlisten;
      }
    })
    .catch((err) => {
      console.error('[Downex] Error listening to downex-update-detected:', err);
    });

  return () => {
    isCancelled = true;
    if (unlistenFn) {
      unlistenFn();
    }
  };
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
  if (!isTauri) {
    if (typeof window !== 'undefined' && (window as any).__DOWNEX_MOCK_DIALOG_PAYLOAD__) {
      return (window as any).__DOWNEX_MOCK_DIALOG_PAYLOAD__;
    }
    return null;
  }
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
  if (!isTauri) {
    if (typeof window !== 'undefined') {
      if ((window as any).__DOWNEX_MOCK_COMPLETE_PAYLOAD__) {
        return (window as any).__DOWNEX_MOCK_COMPLETE_PAYLOAD__;
      }
      try {
        const stored = sessionStorage.getItem('downex_mock_complete_payload');
        if (stored) return JSON.parse(stored);
      } catch {}
    }
    return null;
  }
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

export function onOpenDownloadCompleteModal(callback: (payload: DownloadCompletePayload) => void): () => void {
  if (!isTauri) return () => {};
  let isCancelled = false;
  let unlistenFn: (() => void) | null = null;

  listen<DownloadCompletePayload>('open-download-complete-modal', (e) => {
    if (!isCancelled && e.payload) {
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
      console.error('[Downex] Error listening to open-download-complete-modal:', err);
    });

  return () => {
    isCancelled = true;
    if (unlistenFn) {
      unlistenFn();
      unlistenFn = null;
    }
  };
}

export function onNavigate(callback: (view: string) => void): () => void {
  if (!isTauri) return () => {};
  let isCancelled = false;
  let unlistenFn: (() => void) | null = null;

  listen<string>('downex-navigate', (e) => {
    if (!isCancelled && e.payload) {
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
      console.error('[Downex] Error listening to downex-navigate:', err);
    });

  return () => {
    isCancelled = true;
    if (unlistenFn) {
      unlistenFn();
      unlistenFn = null;
    }
  };
}

export function onCheckUpdatesFromTray(callback: () => void): () => void {
  if (!isTauri) return () => {};
  let isCancelled = false;
  let unlistenFn: (() => void) | null = null;

  listen('downex-check-updates', () => {
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
      console.error('[Downex] Error listening to downex-check-updates:', err);
    });

  return () => {
    isCancelled = true;
    if (unlistenFn) {
      unlistenFn();
      unlistenFn = null;
    }
  };
}



export interface DbPatchNoteRecord {
  version: string;
  title: string;
  release_date: string;
  highlights_json: string;
  raw_notes?: string | null;
  is_custom: boolean;
  updated_at: number;
}

export async function getDbPatchNotes(): Promise<DbPatchNoteRecord[]> {
  if (!isTauri) {
    try {
      const stored = localStorage.getItem('downex_mock_patch_notes');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }
  try {
    return await invoke<DbPatchNoteRecord[]>('cmd_get_patch_notes');
  } catch (err) {
    console.warn('[Downex] Failed to get patch notes from DB:', err);
    return [];
  }
}

export async function saveDbPatchNote(note: DbPatchNoteRecord): Promise<void> {
  if (!isTauri) {
    try {
      const existing = await getDbPatchNotes();
      const filtered = existing.filter((n) => n.version !== note.version);
      filtered.unshift(note);
      localStorage.setItem('downex_mock_patch_notes', JSON.stringify(filtered));
    } catch {}
    return;
  }
  try {
    await invoke('cmd_save_patch_note', { note });
  } catch (err) {
    console.error('[Downex] Failed to save patch note to DB:', err);
    throw err;
  }
}

export async function deleteDbPatchNote(version: string): Promise<void> {
  if (!isTauri) {
    try {
      const existing = await getDbPatchNotes();
      const filtered = existing.filter((n) => n.version !== version);
      localStorage.setItem('downex_mock_patch_notes', JSON.stringify(filtered));
    } catch {}
    return;
  }
  try {
    await invoke('cmd_delete_patch_note', { version });
  } catch (err) {
    console.error('[Downex] Failed to delete patch note from DB:', err);
    throw err;
  }
}

export async function triggerUninstall(): Promise<void> {
  if (!isTauri) {
    alert('[Dev Mode] Native uninstaller triggered');
    return;
  }
  await invoke('cmd_trigger_uninstall');
}

export async function repairApplication(): Promise<void> {
  if (!isTauri) {
    alert('[Dev Mode] Self-healing repair triggered');
    return;
  }
  await invoke('cmd_repair_application');
}

export async function resetToBaseVersion(): Promise<string> {
  if (!isTauri) {
    alert('[Dev Mode] Reset to Base 0.0.0 triggered');
    return 'Base reset complete (Dev Mode)';
  }
  return await invoke<string>('cmd_reset_to_base_version');
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!isTauri) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export function onOtaRollbackRecovered(callback: (payload: { version: string }) => void): () => void {
  if (!isTauri) return () => {};
  let isCancelled = false;
  let unlistenFn: (() => void) | null = null;

  listen<{ version: string }>('ota-rollback-recovered', (e) => {
    if (!isCancelled && e.payload) {
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
      console.error('[Downex] Error listening to ota-rollback-recovered:', err);
    });

  return () => {
    isCancelled = true;
    if (unlistenFn) {
      unlistenFn();
      unlistenFn = null;
    }
  };
}
