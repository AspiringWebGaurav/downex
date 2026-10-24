import React, { useEffect, useState } from 'react';
import { X, Download, Link2, Folder, Clock, Film, Music, Terminal, FileText, FolderArchive } from 'lucide-react';
import { useDownloadStore } from '../stores/downloadStore';
import { getDefaultDownloadDir, openFolderPicker, probeUrl, restoreManagerWindow, hideMainWindow } from '../services/tauriService';

export type FileCategory = 'Compressed' | 'Video' | 'Music' | 'Programs' | 'Documents' | 'General';

const CATEGORY_MAP: Record<FileCategory, string[]> = {
  Compressed: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'iso', 'pkg', 'dmg', 'tgz'],
  Video: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv', 'm4v', 'ts', 'm3u8', 'mpd'],
  Music: ['mp3', 'm4a', 'flac', 'wav', 'aac', 'ogg', 'opus', 'wma', 'mid'],
  Programs: ['exe', 'msi', 'apk', 'app', 'bat', 'cmd', 'sh', 'deb', 'rpm'],
  Documents: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'epub'],
  General: [],
};

function detectCategoryFromFilename(filename: string): FileCategory {
  const ext = filename.split('?')[0].split('.').pop()?.toLowerCase() || '';
  for (const [cat, exts] of Object.entries(CATEGORY_MAP)) {
    if (exts.includes(ext)) {
      return cat as FileCategory;
    }
  }
  return 'General';
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return 'Unknown size';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

export const NewDownloadModal: React.FC<{ isStandalone?: boolean }> = ({ isStandalone = false }) => {
  const isNewModalOpen = useDownloadStore((state) => state.isNewModalOpen);
  const setNewModalOpen = useDownloadStore((state) => state.setNewModalOpen);
  const setIsStandaloneModal = useDownloadStore((state) => state.setIsStandaloneModal);
  const initialModalData = useDownloadStore((state) => state.initialModalData);
  const addNewDownload = useDownloadStore((state) => state.addNewDownload);

  const [url, setUrl] = useState('');
  const [filename, setFilename] = useState('');
  const [category, setCategory] = useState<FileCategory>('General');
  const [baseDownloadDir, setBaseDownloadDir] = useState('');
  const [savePath, setSavePath] = useState('');
  const [rememberPath, setRememberPath] = useState(true);
  const [description, setDescription] = useState('');
  const [totalBytes, setTotalBytes] = useState<number | undefined>();
  const [supportsRanges, setSupportsRanges] = useState(true);
  const [isProbing, setIsProbing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Initialize modal state on open
  useEffect(() => {
    if (isNewModalOpen) {
      getDefaultDownloadDir().then((dir) => {
        setBaseDownloadDir(dir);
        setSavePath(dir);
      });

      // IDM Pattern: If intercepted from browser extension, prefill probed filename, size, and category directly!
      if (initialModalData && initialModalData.url) {
        setUrl(initialModalData.url);
        const name = initialModalData.filename || initialModalData.url.split('?')[0].split('/').pop() || 'download.bin';
        setFilename(name);
        setCategory(detectCategoryFromFilename(name));
        if (initialModalData.total_bytes) {
          setTotalBytes(initialModalData.total_bytes);
        }
        setSupportsRanges(initialModalData.supports_ranges ?? true);
        setIsProbing(false);
      } else {
        // IDM auto-paste pattern from clipboard
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.readText) {
          navigator.clipboard
            .readText()
            .then((clip) => {
              const trimmed = (clip || '').trim();
              if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                setUrl(trimmed);
              }
            })
            .catch(() => {});
        }
      }
    } else {
      setUrl('');
      setFilename('');
      setCategory('General');
      setDescription('');
      setTotalBytes(undefined);
    }
  }, [isNewModalOpen, initialModalData]);

  // When URL changes, probe server to get real filename, Content-Length, and category
  useEffect(() => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl || (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://'))) {
      return;
    }

    // Skip probing if this URL and filename were already resolved by the backend bridge
    if (initialModalData && initialModalData.url === trimmedUrl && initialModalData.filename) {
      return;
    }

    // Quick initial guess from URL
    const urlGuess = trimmedUrl.split('?')[0].split('/').pop() || 'download.bin';
    setFilename(urlGuess);
    const catGuess = detectCategoryFromFilename(urlGuess);
    setCategory(catGuess);

    let cancelled = false;
    setIsProbing(true);

    const timer = setTimeout(async () => {
      try {
        const result = await probeUrl(trimmedUrl);
        if (cancelled || !result) return;

        if (result.filename) {
          setFilename(result.filename);
          const detected = detectCategoryFromFilename(result.filename);
          setCategory(detected);
        }
        if (result.total_bytes) {
          setTotalBytes(result.total_bytes);
        }
        setSupportsRanges(result.supports_ranges);
      } catch (e) {
        console.warn('Probe notice:', e);
      } finally {
        if (!cancelled) setIsProbing(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [url, initialModalData]);

  // Always save directly in unified Downex download folder (no category subfolders)
  useEffect(() => {
    if (!baseDownloadDir) return;
    setSavePath(baseDownloadDir);
  }, [baseDownloadDir]);

  if (!isNewModalOpen) return null;

  const handleBrowseFolder = async () => {
    try {
      const selected = await openFolderPicker();
      if (selected) {
        setSavePath(selected);
      }
    } catch (e) {
      console.warn('Folder picker error:', e);
    }
  };

  const handleCloseModal = async () => {
    if (isStandalone) {
      await hideMainWindow();
      setIsStandaloneModal(false);
    }
    setNewModalOpen(false);
  };

  const handleCreateDownload = async (startImmediately: boolean) => {
    if (!url.trim()) return;

    setSubmitting(true);
    try {
      const customHeaders: Record<string, string> = {};
      if (initialModalData) {
        if (initialModalData.cookies) customHeaders['Cookie'] = initialModalData.cookies;
        if (initialModalData.referer) customHeaders['Referer'] = initialModalData.referer;
        if (initialModalData.user_agent) customHeaders['User-Agent'] = initialModalData.user_agent;
      }
      const headersOpt = Object.keys(customHeaders).length > 0 ? customHeaders : undefined;

      await addNewDownload(
        url.trim(),
        savePath.trim() || undefined,
        undefined,
        headersOpt,
        startImmediately
      );

      if (isStandalone) {
        if (startImmediately) {
          await restoreManagerWindow();
        } else {
          await hideMainWindow();
        }
        setIsStandaloneModal(false);
      }
      setNewModalOpen(false);
    } catch (err) {
      alert('Failed to initiate download: ' + err);
    } finally {
      setSubmitting(false);
    }
  };

  const dialogCard = (
    <div className={`flex flex-col bg-white dark:bg-zinc-900 overflow-hidden ${
      isStandalone 
        ? 'w-full h-full' 
        : 'w-[530px] rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xl animate-in fade-in zoom-in-95 duration-150'
    }`}>
      {/* Title Bar - Drag region enabled for standalone modal */}
      <div 
        {...(isStandalone ? { 'data-tauri-drag-region': true } : {})}
        className="px-5 py-3 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/30 select-none cursor-move"
      >
        <div {...(isStandalone ? { 'data-tauri-drag-region': true } : {})} className="flex items-center gap-2">
          <img src="/icon.png" alt="Downex" className="w-4.5 h-4.5 rounded-xs pointer-events-none" />
          <span {...(isStandalone ? { 'data-tauri-drag-region': true } : {})} className="font-semibold text-xs tracking-wide text-zinc-900 dark:text-zinc-100">
            Download File Info
          </span>
          {isProbing && (
            <span className="text-[10px] text-zinc-400 font-mono animate-pulse">
              Probing server...
            </span>
          )}
        </div>
        <button
          onClick={handleCloseModal}
          className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

        {/* Form Body */}
        <div className="p-5 space-y-3.5">
          {/* URL Row */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                URL
              </label>
              {totalBytes !== undefined && totalBytes > 0 && (
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  {formatBytes(totalBytes)} {supportsRanges ? '• Multi-Stream' : ''}
                </span>
              )}
            </div>
            <div className="relative">
              <input
                type="url"
                required
                placeholder="https://example.com/package.zip"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoFocus
                className="w-full px-3 py-2 pl-8.5 rounded-lg bg-zinc-50 dark:bg-zinc-950/80 border border-zinc-300 dark:border-zinc-800 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              />
              <Link2 className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            </div>
          </div>

          {/* Main Grid: Category, Save As, and IDM-Style File Visual Badge */}
          <div className="grid grid-cols-[1fr_88px] gap-3 items-start">
            <div className="space-y-3">
              {/* Category Dropdown */}
              <div>
                <label className="block text-[11px] font-mono text-zinc-500 dark:text-zinc-400 mb-1 uppercase tracking-wider">
                  Category
                </label>
                <div className="flex items-center gap-1.5">
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as FileCategory)}
                    className="flex-1 px-3 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-950/80 border border-zinc-300 dark:border-zinc-800 text-xs font-medium text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 cursor-pointer"
                  >
                    <option value="Compressed">📦 Compressed (ZIP, RAR, 7Z, ISO)</option>
                    <option value="Video">🎬 Video (MP4, MKV, WEBM, TS)</option>
                    <option value="Music">🎵 Music (MP3, M4A, FLAC, WAV)</option>
                    <option value="Programs">⚡ Programs (EXE, MSI, APK)</option>
                    <option value="Documents">📄 Documents (PDF, DOCX, TXT)</option>
                    <option value="General">📁 General Downloads</option>
                  </select>
                </div>
              </div>

              {/* Save As (Path & Filename) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    Save As
                  </label>
                  <span className="text-[10px] text-zinc-400 truncate max-w-[200px]" title={filename}>
                    {filename}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={savePath}
                      onChange={(e) => setSavePath(e.target.value)}
                      placeholder="Save destination path..."
                      className="w-full px-2.5 py-1.5 pl-7.5 rounded-lg bg-zinc-50 dark:bg-zinc-950/80 border border-zinc-300 dark:border-zinc-800 text-xs font-mono text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                    />
                    <Folder className="w-3.5 h-3.5 text-zinc-400 absolute left-2 top-1/2 -translate-y-1/2" />
                  </div>
                  <button
                    type="button"
                    onClick={handleBrowseFolder}
                    title="Browse Download Folder..."
                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 transition-colors cursor-pointer shrink-0"
                  >
                    ...
                  </button>
                </div>
              </div>
            </div>

            {/* Right-Hand Visual File Type Badge (IDM WinRAR / Media Tribute Elevated to Modern 3D) */}
            <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-zinc-100/70 dark:bg-zinc-950/60 border border-zinc-200/80 dark:border-zinc-800/80 self-stretch">
              <FileTypeVisualBadge category={category} filename={filename} />
              <span className="mt-2 text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 text-center">
                {category}
              </span>
            </div>
          </div>

          {/* Remember path checkbox (IDM pattern) */}
          <div className="flex items-center gap-2 pt-0.5">
            <input
              type="checkbox"
              id="remember-category-path"
              checked={rememberPath}
              onChange={(e) => setRememberPath(e.target.checked)}
              className="w-3.5 h-3.5 rounded text-emerald-600 dark:text-emerald-500 accent-emerald-500 cursor-pointer"
            />
            <label
              htmlFor="remember-category-path"
              className="text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer select-none"
            >
              Remember this path for &ldquo;{category}&rdquo; category
            </label>
          </div>

          {/* Description Field */}
          <div>
            <label className="block text-[11px] font-mono text-zinc-500 dark:text-zinc-400 mb-1 uppercase tracking-wider">
              Description (Optional)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Web series episode, SDK installer, dataset..."
              className="w-full px-3 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-950/80 border border-zinc-300 dark:border-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
          </div>
        </div>

        {/* Bottom Actions matching IDM (Download Later | Start Download | Cancel) */}
        <div className="px-5 py-3.5 bg-zinc-50/70 dark:bg-zinc-950/60 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <button
            type="button"
            onClick={handleCloseModal}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            {/* Download Later Button (Queued in Paused State) */}
            <button
              type="button"
              disabled={submitting || !url.trim()}
              onClick={() => handleCreateDownload(false)}
              title="Add to queue in paused state without starting immediately"
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-zinc-200/70 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
            >
              <Clock className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
              <span>Download Later</span>
            </button>

            {/* Start Download Button (Primary Emerald) */}
            <button
              type="button"
              disabled={submitting || !url.trim()}
              onClick={() => handleCreateDownload(true)}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>{submitting ? 'Connecting...' : 'Start Download'}</span>
            </button>
          </div>
        </div>
      </div>
  );

  if (isStandalone) {
    return dialogCard;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs select-none p-4">
      {dialogCard}
    </div>
  );
};

// Modern 3D / SVG tribute to IDM's category icons
const FileTypeVisualBadge: React.FC<{ category: FileCategory; filename: string }> = ({ category }) => {
  switch (category) {
    case 'Compressed':
      // WinRAR tribute: 3 stacked colorful books with leather belt buckle
      return (
        <div className="relative w-12 h-12 flex flex-col items-center justify-center">
          <div className="w-10 h-3 rounded-xs bg-violet-600 shadow-xs mb-0.5 transform -skew-x-3" />
          <div className="w-11 h-3 rounded-xs bg-sky-600 shadow-xs mb-0.5" />
          <div className="w-10 h-3 rounded-xs bg-emerald-600 shadow-xs transform skew-x-3" />
          {/* Golden belt buckle */}
          <div className="absolute w-2.5 h-7.5 bg-amber-400 rounded-xs border border-amber-600 shadow-xs flex items-center justify-center">
            <div className="w-1 h-2 bg-amber-600 rounded-xs" />
          </div>
        </div>
      );
    case 'Video':
      return (
        <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-violet-600 to-fuchsia-500 shadow-md flex items-center justify-center text-white">
          <Film className="w-5.5 h-5.5 stroke-[2]" />
        </div>
      );
    case 'Music':
      return (
        <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-rose-500 to-amber-500 shadow-md flex items-center justify-center text-white">
          <Music className="w-5.5 h-5.5 stroke-[2]" />
        </div>
      );
    case 'Programs':
      return (
        <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-blue-600 to-cyan-500 shadow-md flex items-center justify-center text-white">
          <Terminal className="w-5.5 h-5.5 stroke-[2]" />
        </div>
      );
    case 'Documents':
      return (
        <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 shadow-md flex items-center justify-center text-white">
          <FileText className="w-5.5 h-5.5 stroke-[2]" />
        </div>
      );
    default:
      return (
        <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-zinc-600 to-zinc-500 shadow-md flex items-center justify-center text-white">
          <FolderArchive className="w-5.5 h-5.5 stroke-[2]" />
        </div>
      );
  }
};
