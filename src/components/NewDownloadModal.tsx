import React, { useEffect, useState, useRef } from 'react';
import {
  X,
  Folder,
  FileBox,
  HardDrive,
  Copy,
  Check,
  Link2,
  ClipboardPaste,
  FileText,
  Shield,
  Mail,
  Lock,
  ArrowRight,
  RotateCcw
} from 'lucide-react';
import { useDownloadStore } from '../stores/downloadStore';
import { useHardwareBanStore } from '../stores/hardwareBanStore';
import {
  getDefaultDownloadDir,
  getSystemDefaultDownloadDir,
  normalizePathForCompare,
  setDefaultDownloadDir,
  getDiskFreeSpace,
  probeUrl,
  restoreManagerWindow,
  hideMainWindow,
  getClipboardText,
  extractSizeFromUrl,
  openExternalUrl,
  getDownexWebBaseUrl,
  SEQUENTIAL_QUEUE_ID
} from '../services/tauriService';
import {
  getCachedDownloadDir,
  setCachedDownloadDir,
  getCachedDiskFreeSpace,
  setCachedDiskFreeSpace
} from '../services/modalPreload';
import { FolderChangeModal } from './FolderChangeModal';
import { MarqueeFileName } from './MarqueeFileName';

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

function splitFilenameAndExt(fullName: string): { base: string; ext: string } {
  const clean = fullName.trim();
  if (!clean) return { base: '', ext: '' };
  const lastDot = clean.lastIndexOf('.');
  if (lastDot > 0 && lastDot < clean.length - 1) {
    return {
      base: clean.substring(0, lastDot),
      ext: clean.substring(lastDot),
    };
  }
  return { base: clean, ext: '' };
}

export const NewDownloadModal: React.FC<{ isStandalone?: boolean }> = ({ isStandalone = false }) => {
  const isNewModalOpen = useDownloadStore((state) => state.isNewModalOpen);
  const setNewModalOpen = useDownloadStore((state) => state.setNewModalOpen);
  const setIsStandaloneModal = useDownloadStore((state) => state.setIsStandaloneModal);
  const initialModalData = useDownloadStore((state) => state.initialModalData);
  const addNewDownload = useDownloadStore((state) => state.addNewDownload);
  const setSelectedView = useDownloadStore((state) => state.setSelectedView);

  // Reactive hardware ban state from Zustand
  const isBanned = useHardwareBanStore((state) => state.isBanned);
  const hwid = useHardwareBanStore((state) => state.hwid);
  const banReason = useHardwareBanStore((state) => state.banReason);

  const [url, setUrl] = useState('');
  const [fileBaseName, setFileBaseName] = useState('');
  const [fileExtension, setFileExtension] = useState('');
  const [savePath, setSavePath] = useState<string>(getCachedDownloadDir);
  const [systemDefaultDir, setSystemDefaultDir] = useState<string>('');
  const [freeSpaceBytes, setFreeSpaceBytes] = useState<number | null>(getCachedDiskFreeSpace);
  const [rememberPath, setRememberPath] = useState(false);
  const [totalBytes, setTotalBytes] = useState<number | undefined>();
  const [supportsRanges, setSupportsRanges] = useState(true);
  const [isProbing, setIsProbing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);

  const handlePasteUrl = async () => {
    try {
      const clip = await getClipboardText();
      const text = (clip || '').trim();
      if (text) {
        setUrl(text);
        return;
      }
    } catch { }
    try {
      if (navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text) setUrl(text.trim());
      }
    } catch (e) {
      console.warn('Clipboard read error:', e);
    }
  };

  // Auto-focus URL input when modal opens with empty URL
  useEffect(() => {
    if (isNewModalOpen && !url) {
      const timer = setTimeout(() => {
        urlInputRef.current?.focus();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [isNewModalOpen, url]);

  const applyFilename = (fullName: string) => {
    if (!fullName || !fullName.trim()) {
      setFileBaseName('');
      setFileExtension('');
      return;
    }
    const { base, ext } = splitFilenameAndExt(fullName);
    setFileBaseName(base);
    setFileExtension(ext);
  };

  // Disk space check (updates synchronous cache)
  useEffect(() => {
    if (!savePath) return;
    let cancelled = false;
    getDiskFreeSpace(savePath).then((bytes) => {
      if (!cancelled && bytes > 0) {
        setFreeSpaceBytes(bytes);
        setCachedDiskFreeSpace(bytes);
      }
    });
    return () => { cancelled = true; };
  }, [savePath]);

  // Initialize modal state on open
  useEffect(() => {
    if (isNewModalOpen) {
      setRememberPath(false);
      getSystemDefaultDownloadDir()
        .then((dir) => {
          if (dir && dir.trim()) {
            setSystemDefaultDir(dir.trim());
          }
        })
        .catch(() => {});

      getDefaultDownloadDir().then((dir) => {
        if (dir && dir.trim()) {
          setSavePath(dir.trim());
          setCachedDownloadDir(dir.trim());
        }
      });

      if (initialModalData && initialModalData.url && initialModalData.url.trim()) {
        const trimmed = initialModalData.url.trim();
        setUrl(trimmed);
        const name = initialModalData.filename || trimmed.split('?')[0].split('/').pop() || '';
        if (name && name !== 'download.bin') {
          applyFilename(name);
        } else {
          setFileBaseName('');
          setFileExtension('');
        }
        if (initialModalData.total_bytes) {
          setTotalBytes(initialModalData.total_bytes);
        }
        setSupportsRanges(initialModalData.supports_ranges ?? true);
        setIsProbing(false);
      } else {
        // Pristine dynamic empty state when opening without prefilled link
        setUrl('');
        setFileBaseName('');
        setFileExtension('');
        setTotalBytes(undefined);
        setIsProbing(false);

        const isClipboardWatchEnabled = (() => {
          try {
            return localStorage.getItem('downex_clipboard_watch') !== 'false';
          } catch {
            return true;
          }
        })();

        if (isClipboardWatchEnabled) {
          getClipboardText()
            .then((clip) => {
              const trimmed = (clip || '').trim();
              if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                setUrl(trimmed);
                const guess = trimmed.split('?')[0].split('/').pop() || '';
                if (guess && guess !== 'download.bin') {
                  applyFilename(guess);
                }
              }
            })
            .catch(() => { });
        }
      }
    } else {
      setUrl('');
      setFileBaseName('');
      setFileExtension('');
      setTotalBytes(undefined);
      setIsProbing(false);
    }
  }, [isNewModalOpen, initialModalData]);

  // When URL changes, probe server to get real filename and Content-Length
  useEffect(() => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      // Dynamic Empty State: If link is not pasted or was cleared, wipe out name, extension & size!
      setFileBaseName('');
      setFileExtension('');
      setTotalBytes(undefined);
      setIsProbing(false);
      return;
    }

    setSubmitError(null);
    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      setTotalBytes(undefined);
      setIsProbing(false);
      return;
    }

    // Immediately detect size from URL parameters (e.g. Google Video / googleusercontent clen=2985392814)
    const preExtracted = extractSizeFromUrl(trimmedUrl);
    if (preExtracted && preExtracted > 0) {
      setTotalBytes(preExtracted);
    }

    if (initialModalData && (initialModalData.url === trimmedUrl || initialModalData.url?.trim() === trimmedUrl)) {
      if (initialModalData.filename) {
        applyFilename(initialModalData.filename);
      }
      if (initialModalData.total_bytes && initialModalData.total_bytes > 0) {
        setTotalBytes(initialModalData.total_bytes);
        setIsProbing(false);
        return;
      }
      setSupportsRanges(initialModalData.supports_ranges ?? true);
      if (preExtracted) {
        setIsProbing(false);
        return;
      }
    }

    const rawGuess = trimmedUrl.split('?')[0].split('/').pop() || '';
    if (rawGuess && rawGuess !== 'download.bin') {
      applyFilename(rawGuess);
    }

    let cancelled = false;
    setIsProbing(true);

    const timer = setTimeout(async () => {
      try {
        const result = await probeUrl(trimmedUrl);
        if (cancelled) return;

        if (result) {
          if (result.filename) {
            applyFilename(result.filename);
          }
          if (result.total_bytes && result.total_bytes > 0) {
            setTotalBytes(result.total_bytes);
          }
          if (result.supports_ranges !== undefined) {
            setSupportsRanges(result.supports_ranges);
          }
        }
      } catch (e) {
        console.warn('Probe notice:', e);
      } finally {
        if (!cancelled) {
          setIsProbing(false);
          setTotalBytes((current) => current || extractSizeFromUrl(trimmedUrl));
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [url, initialModalData]);

  const handleBrowseFolder = () => {
    setIsFolderModalOpen(true);
  };

  const handleFolderSelected = (chosenPath: string) => {
    setSavePath(chosenPath);
    setIsFolderModalOpen(false);
    getDiskFreeSpace(chosenPath).then((bytes) => setFreeSpaceBytes(bytes));
  };

  const handleCloseModal = async () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    if (isStandalone) {
      await hideMainWindow();
      setIsStandaloneModal(false);
    }
    setNewModalOpen(false);
  };

  // Keyboard navigation: Enter starts download, Escape closes modal
  useEffect(() => {
    if (!isNewModalOpen || isFolderModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCloseModal();
      } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
        if (isBanned) {
          e.preventDefault();
          handleCloseModal();
          return;
        }
        const tag = document.activeElement?.tagName;
        if (tag === 'BUTTON' || tag === 'A') return;
        if (url.trim() && !submitting) {
          e.preventDefault();
          handleCreateDownload(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isNewModalOpen, isFolderModalOpen, submitting, isStandalone, isBanned, url, fileBaseName, fileExtension, savePath, rememberPath, initialModalData]);

  const handleCreateDownload = async (startImmediately: boolean) => {
    if (isBanned || submitting || !url.trim()) return;
    setSubmitError(null);
    try {
      const parsed = new URL(url.trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        setSubmitError('Only http:// and https:// download URLs are supported.');
        return;
      }
    } catch {
      setSubmitError('Please enter a valid http:// or https:// download URL.');
      return;
    }

    setSubmitting(true);
    try {
      const customHeaders: Record<string, string> = {};
      if (initialModalData && initialModalData.url?.trim() === url.trim()) {
        if (initialModalData.cookies) customHeaders['Cookie'] = initialModalData.cookies;
        if (initialModalData.referer) customHeaders['Referer'] = initialModalData.referer;
        if (initialModalData.user_agent) customHeaders['User-Agent'] = initialModalData.user_agent;
      }
      const headersOpt = Object.keys(customHeaders).length > 0 ? customHeaders : undefined;
      const sanitizedRawName = (fileBaseName.trim() + fileExtension.trim())
        .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
        .trim();
      const fullFilename = sanitizedRawName || undefined;

      // Persist chosen directory ONLY when the user explicitly checks Remember folder
      if (rememberPath && savePath.trim()) {
        try {
          const savedDir = await setDefaultDownloadDir(savePath.trim());
          setCachedDownloadDir((savedDir || savePath).trim());
        } catch (e) {
          console.warn('Could not save default download directory:', e);
        }
      }

      await addNewDownload(
        url.trim(),
        savePath.trim() || undefined,
        startImmediately ? undefined : SEQUENTIAL_QUEUE_ID,
        headersOpt,
        startImmediately,
        fullFilename
      );

      setRememberPath(false);

      if (isStandalone) {
        if (startImmediately) {
          await restoreManagerWindow('all');
        } else {
          await restoreManagerWindow('queues');
          await hideMainWindow();
        }
        setIsStandaloneModal(false);
      } else {
        setSelectedView(startImmediately ? 'all' : 'queues');
      }
      setNewModalOpen(false);
    } catch (err) {
      setSubmitError(`Failed to initiate download: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyUrl = () => {
    if (!url) return;
    navigator.clipboard?.writeText?.(url)?.catch((err) => {
      console.warn('Clipboard write notice:', err);
    });
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 1500);
  };

  const isLowSpace = totalBytes && freeSpaceBytes && freeSpaceBytes < totalBytes;

  const baseUrl = getDownexWebBaseUrl();
  const termsUrl = `${baseUrl}/terms#dos-and-donts`;
  const policiesUrl = `${baseUrl}/privacy`;
  const hardwarePatchUrl = `${baseUrl}/terms#hardware-enforcement`;

  const handleOpenTerms = (e: React.MouseEvent) => {
    e.preventDefault();
    openExternalUrl(termsUrl);
  };

  const handleOpenPolicies = (e: React.MouseEvent) => {
    e.preventDefault();
    openExternalUrl(policiesUrl);
  };

  const handleOpenHardwarePatch = (e: React.MouseEvent) => {
    e.preventDefault();
    openExternalUrl(hardwarePatchUrl);
  };

  const [copiedId, setCopiedId] = useState(false);
  const handleCopyId = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!hwid) return;
    try {
      await navigator.clipboard.writeText(hwid);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = hwid;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  const handleOpenManager = async () => {
    try {
      await restoreManagerWindow();
    } catch {}
    handleCloseModal();
  };

  const banSubtitle =
    banReason &&
    banReason !== 'Administrative hardware ban enforced.' &&
    banReason !== 'You have been banned from App Owner' &&
    banReason !== 'You have been banned from ADMIN'
      ? banReason
      : 'This is hardware patched. Formatting System and reinstalling App will not bypass this.';

  if (!isNewModalOpen) return null;

  // Mini Banned Dialog Card (Shown when device is hardware banned - matches OG modal size & layout)
  const bannedDialogCard = (
    <div
      className={`flex flex-col justify-between bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans overflow-hidden select-none border border-zinc-200 dark:border-zinc-800 shadow-2xl ${
        isStandalone ? 'w-full h-full' : 'w-[540px] min-h-[346px] max-w-[94vw] modal-enter-instant'
      }`}
    >
      {/* Title Bar Strip */}
      <div
        {...(isStandalone ? { 'data-tauri-drag-region': true } : {})}
        className="h-8 px-3.5 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 select-none cursor-move shrink-0"
      >
        <div {...(isStandalone ? { 'data-tauri-drag-region': true } : {})} className="flex items-center gap-2">
          <span
            {...(isStandalone ? { 'data-tauri-drag-region': true } : {})}
            className="font-mono-tabular text-[10.5px] uppercase tracking-wider text-red-500 dark:text-red-400 font-semibold"
          >
            DOWNLOAD RESTRICTED
          </span>
        </div>
        <button
          onClick={handleCloseModal}
          title="Close (Esc)"
          className="p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer focus:outline-none"
        >
          <X className="w-3.5 h-3.5 stroke-[1.8]" />
        </button>
      </div>

      {/* Subtle & Symmetric Banned Body (Evenly spaced, inspired by Download Manager Banned UI) */}
      <div className="px-5 py-1 flex flex-col items-center justify-evenly text-center flex-1 overflow-hidden">
        {/* Top Group: BAN! + Heading + Highlighted Readable Subtitle with Read more */}
        <div className="flex flex-col items-center gap-1.5 max-w-[440px]">
          <span className="inline-flex items-center px-5 py-1 bg-red-500 text-white font-mono-tabular text-[11px] font-black uppercase tracking-widest rounded-xs select-none mb-0.5">
            BAN!
          </span>
          <h2 className="text-[15px] font-bold text-zinc-950 dark:text-zinc-50 tracking-tight font-sans">
            You have been banned from ADMIN
          </h2>
          <p className="text-[12px] text-zinc-800 dark:text-zinc-200 font-medium leading-[1.5] max-w-[385px]">
            {banSubtitle === 'This is hardware patched. Formatting System and reinstalling App will not bypass this.' ? (
              <>
                <span className="font-semibold text-zinc-950 dark:text-white">This is hardware patched.</span>{' '}
                Formatting System and reinstalling App will not bypass this.
              </>
            ) : (
              <span>{banSubtitle}</span>
            )}{' '}
            <a
              href={hardwarePatchUrl}
              onClick={handleOpenHardwarePatch}
              className="text-zinc-950 dark:text-white hover:text-red-600 dark:hover:text-red-400 font-semibold underline underline-offset-2 cursor-pointer font-mono-tabular text-[11px] inline-flex items-center gap-0.5 transition-colors whitespace-nowrap"
              title="Learn why formatting will not bypass this ban"
            >
              <span>Read more</span>
              <ArrowRight className="w-2.5 h-2.5 stroke-[2.2]" />
            </a>
          </p>
        </div>

        {/* Full-Width Intercepted File Preview */}
        {(fileBaseName.trim() || url.trim()) && (
          <div
            className="w-full max-w-[450px] px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-800 text-[11px] font-mono-tabular flex items-center justify-start gap-2.5 rounded-xs text-left overflow-hidden"
            style={{ textAlign: 'left' }}
          >
            <Lock className="w-3.5 h-3.5 text-red-500 dark:text-red-400 shrink-0" />
            <MarqueeFileName name={(fileBaseName.trim() + fileExtension.trim()) || url.trim()} />
            <span className="text-[9.5px] uppercase font-bold text-red-500 dark:text-red-400 px-1.5 py-0.5 bg-red-500/10 rounded-xs shrink-0 font-mono-tabular">
              Blocked
            </span>
          </div>
        )}

        {/* Terms & Policies Pill Buttons */}
        <div className="flex items-center justify-center gap-2">
          <a
            href={termsUrl}
            onClick={handleOpenTerms}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xs bg-zinc-100 hover:bg-zinc-200/80 dark:bg-zinc-800/60 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-zinc-50 transition-colors cursor-pointer border border-zinc-200/80 dark:border-zinc-700/60 text-[10.5px] font-mono-tabular font-medium"
          >
            <FileText className="w-3 h-3" />
            <span>Terms</span>
          </a>
          <span className="text-zinc-300 dark:text-zinc-700 text-xs">&bull;</span>
          <a
            href={policiesUrl}
            onClick={handleOpenPolicies}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xs bg-zinc-100 hover:bg-zinc-200/80 dark:bg-zinc-800/60 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-zinc-50 transition-colors cursor-pointer border border-zinc-200/80 dark:border-zinc-700/60 text-[10.5px] font-mono-tabular font-medium"
          >
            <Shield className="w-3 h-3" />
            <span>Policies</span>
          </a>
        </div>

        {/* Owner Contact (Evenly spaced independently) */}
        <div className="text-[10.5px] font-mono-tabular text-zinc-600 dark:text-zinc-400 flex items-center justify-center gap-1.5">
          <Mail className="w-3 h-3 text-zinc-400 dark:text-zinc-500" />
          <span>Owner Contact:</span>
          <a
            href="mailto:hello@gauravpatil.site"
            className="text-zinc-950 dark:text-zinc-100 hover:text-red-600 dark:hover:text-red-400 hover:underline font-semibold transition-colors"
          >
            hello@gauravpatil.site
          </a>
        </div>

        {/* ID Footer Row (Evenly spaced above bottom bar) */}
        {hwid && (
          <div className="inline-flex items-center gap-1.5 text-[10px] font-mono-tabular text-zinc-500 dark:text-zinc-400 select-text">
            <span className="text-zinc-400 dark:text-zinc-500 text-[9px] uppercase tracking-wider font-semibold">ID:</span>
            <span className="text-zinc-800 dark:text-zinc-200 font-medium">{hwid}</span>
            <button
              type="button"
              onClick={handleCopyId}
              title={copiedId ? 'Copied to clipboard!' : 'Copy ID'}
              className="p-0.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer transition-colors"
            >
              {copiedId ? <Check className="w-2.5 h-2.5 text-emerald-500" /> : <Copy className="w-2.5 h-2.5" />}
            </button>
          </div>
        )}
      </div>

      {/* Bottom Bar Strip */}
      <div className="px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5 text-[10.5px] font-mono-tabular text-zinc-500 dark:text-zinc-400">
          <Lock className="w-3 h-3 text-red-500 dark:text-red-400" />
          <span>Download disabled</span>
        </div>
        <button
          type="button"
          onClick={handleOpenManager}
          className="h-7.5 px-3.5 font-mono-tabular text-[10.5px] uppercase tracking-wider font-semibold cursor-pointer bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-200 dark:text-zinc-950 dark:hover:bg-white rounded-xs transition-colors flex items-center gap-1.5"
        >
          <span>Open Download Manager</span>
          <ArrowRight className="w-3 h-3 stroke-[2]" />
        </button>
      </div>
    </div>
  );

  const dialogCard = (
    <div className={`flex flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden select-none border border-zinc-200 dark:border-zinc-800 shadow-2xl ${isStandalone
      ? 'w-full h-full'
      : 'w-[540px] max-w-[94vw] modal-enter-instant'
      }`}>
      {/* Title Bar */}
      <div
        {...(isStandalone ? { 'data-tauri-drag-region': true } : {})}
        className="h-8 px-3.5 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 select-none cursor-move shrink-0"
      >
        <div {...(isStandalone ? { 'data-tauri-drag-region': true } : {})} className="flex items-center gap-2">
          <span {...(isStandalone ? { 'data-tauri-drag-region': true } : {})} className="font-mono-tabular text-[10.5px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400 font-semibold">
            NEW DOWNLOAD
          </span>
          {isProbing && !!url.trim() && (
            <span className="text-[10px] font-mono-tabular text-zinc-400 ml-1 animate-pulse">
              Checking size...
            </span>
          )}
        </div>
        <button
          onClick={handleCloseModal}
          title="Close (Esc)"
          className="p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer focus:outline-none"
        >
          <X className="w-3.5 h-3.5 stroke-[1.8]" />
        </button>
      </div>

      {submitError && (
        <div
          role="alert"
          className="px-3.5 py-2 bg-rose-50 dark:bg-rose-950/40 border-b border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-[11px] font-medium flex items-center justify-between gap-2"
        >
          <span>{submitError}</span>
          <button
            type="button"
            onClick={() => setSubmitError(null)}
            className="text-rose-500 hover:text-rose-700 dark:hover:text-rose-200 cursor-pointer shrink-0"
            aria-label="Dismiss error"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Form Body */}
      <div className="p-3.5 space-y-2.5 flex-1">
        {/* Row 1: Editable File Name */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-semibold text-zinc-900 dark:text-zinc-100">
              File Name
            </label>
            <span className="text-[10px] font-mono-tabular text-zinc-400">
              RENAME IF NEEDED
            </span>
          </div>
          <div className="flex items-center border border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50 focus-within:border-black dark:focus-within:border-white transition-colors">
            <div className="pl-2.5 pr-1.5 text-zinc-400 dark:text-zinc-500">
              <FileBox className="w-3.5 h-3.5" />
            </div>
            <input
              type="text"
              required={!!url.trim()}
              placeholder={url.trim() ? "Filename" : "Enter or paste download link below..."}
              value={fileBaseName}
              onChange={(e) => setFileBaseName(e.target.value)}
              className="flex-1 py-1.5 text-[12px] font-mono-tabular font-medium text-zinc-900 dark:text-zinc-100 bg-transparent focus:outline-none placeholder:text-zinc-400/80"
            />
            {fileExtension && (!!url.trim() || !!fileBaseName.trim()) && (
              <span className="px-1.5 py-0.5 mr-2 text-[10px] font-mono-tabular font-semibold bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 uppercase shrink-0">
                .{fileExtension.replace(/^\./, '')}
              </span>
            )}
          </div>
        </div>

        {/* Row 2: Streamlined Info Strip */}
        <div className="grid grid-cols-2 gap-2">
          <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-950/40 px-2.5 py-1.5 flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-[9.5px] uppercase font-mono-tabular text-zinc-400 leading-tight">File Size</div>
              <div className="font-mono-tabular text-[12.5px] font-bold text-zinc-900 dark:text-zinc-100 leading-snug truncate">
                {url.trim() ? (isProbing ? 'Checking...' : formatBytes(totalBytes)) : '—'}
              </div>
            </div>
            {url.trim() ? (
              <span className={`text-[9.5px] font-mono-tabular px-1.5 py-0.5 border shrink-0 ${supportsRanges
                ? 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5'
                : 'border-zinc-300 dark:border-zinc-700 text-zinc-500'
                }`}>
                {supportsRanges ? 'RESUME OK' : 'SINGLE'}
              </span>
            ) : (
              <span className="text-[9.5px] font-mono-tabular px-1.5 py-0.5 border border-zinc-200 dark:border-zinc-800 text-zinc-400 shrink-0">
                WAITING
              </span>
            )}
          </div>

          <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-950/40 px-2.5 py-1.5 flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-[9.5px] uppercase font-mono-tabular text-zinc-400 leading-tight">Connections</div>
              <div className="font-mono-tabular text-[12.5px] font-bold text-zinc-900 dark:text-zinc-100 leading-snug truncate">
                {url.trim() ? (supportsRanges ? '32 Threads' : '1 Stream') : '32 Threads'}
              </div>
            </div>
            <span className="text-[9.5px] font-mono-tabular text-zinc-400 uppercase shrink-0">
              {url.trim() ? 'PARALLEL' : 'DEFAULT'}
            </span>
          </div>
        </div>

        {/* Row 3: Destination Folder + Live Disk Free Space */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-semibold text-zinc-900 dark:text-zinc-100">
              Save To
            </label>
            {freeSpaceBytes !== null && (
              <span className={`text-[10px] font-mono-tabular flex items-center gap-1 ${isLowSpace
                ? 'text-rose-500 font-bold animate-pulse'
                : 'text-zinc-400'
                }`}>
                <HardDrive className="w-3 h-3" />
                <span>{formatBytes(freeSpaceBytes)} free</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <input
                type="text"
                value={savePath}
                onChange={(e) => setSavePath(e.target.value)}
                placeholder="Destination folder path"
                className="w-full px-2.5 py-1.5 pl-8 border border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-950/50 text-[11px] font-mono-tabular text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-black dark:focus:border-white transition-colors"
              />
              <Folder className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            {(() => {
              const isAtSystemDefault = Boolean(systemDefaultDir) &&
                normalizePathForCompare(savePath) === normalizePathForCompare(systemDefaultDir);
              return (
                <button
                  type="button"
                  data-testid="use-default-folder-btn"
                  onClick={async () => {
                    try {
                      const resolved = await setDefaultDownloadDir('');
                      const clean = (resolved || systemDefaultDir || 'C:\\Downloads\\Downex').trim();
                      setSavePath(clean);
                      setCachedDownloadDir(clean);
                      setRememberPath(false);
                      setSystemDefaultDir((prev) => prev || clean);
                    } catch {
                      const fallback = (systemDefaultDir || 'C:\\Downloads\\Downex').trim();
                      setSavePath(fallback);
                      setCachedDownloadDir(fallback);
                      setRememberPath(false);
                    }
                  }}
                  disabled={isAtSystemDefault}
                  title={systemDefaultDir ? `Use default folder (${systemDefaultDir})` : 'Reset to default Downloads\\Downex folder'}
                  className={`h-7.5 px-2.5 border font-mono-tabular text-[10px] uppercase tracking-wider shrink-0 flex items-center gap-1 transition-colors ${
                    isAtSystemDefault
                      ? 'border-zinc-200 dark:border-zinc-800 text-zinc-400 dark:text-zinc-600 cursor-default'
                      : 'border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer'
                  }`}
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Default</span>
                </button>
              );
            })()}
            <button
              type="button"
              onClick={handleBrowseFolder}
              className="h-7.5 px-3 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-mono-tabular text-[10px] uppercase tracking-wider shrink-0 cursor-pointer"
            >
              Browse
            </button>
          </div>
        </div>

        {/* Row 4: Source URL (Interactive input with Paste & Copy actions) */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-semibold text-zinc-900 dark:text-zinc-100">
              Source URL
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePasteUrl}
                className="text-[10px] font-mono-tabular font-semibold text-emerald-600 dark:text-emerald-400 hover:underline transition-colors flex items-center gap-1 cursor-pointer"
              >
                <ClipboardPaste className="w-3 h-3" />
                <span>PASTE</span>
              </button>
              {url && (
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="text-[10px] font-mono-tabular text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors flex items-center gap-1 cursor-pointer"
                >
                  {copiedUrl ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedUrl ? 'COPIED' : 'COPY'}</span>
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center border border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-950/50 focus-within:border-black dark:focus-within:border-white transition-colors px-2.5 py-1">
            <Link2 className="w-3.5 h-3.5 text-zinc-400 mr-2 shrink-0" />
            <input
              ref={urlInputRef}
              type="text"
              required
              autoFocus={!url}
              placeholder="Paste download link (https://...)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex-1 text-[11px] font-mono-tabular text-zinc-900 dark:text-zinc-100 bg-transparent focus:outline-none placeholder:text-zinc-400"
            />
            {url && (
              <button
                type="button"
                onClick={() => setUrl('')}
                className="p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer ml-1"
                title="Clear URL"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Actions */}
      <div className="px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between shrink-0 mt-auto">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={rememberPath}
            onChange={(e) => setRememberPath(e.target.checked)}
            className="w-3.5 h-3.5 rounded-none border-zinc-300 accent-black dark:accent-white cursor-pointer"
          />
          <span className="text-[11px] text-zinc-600 dark:text-zinc-400 font-mono-tabular">
            Remember folder
          </span>
        </label>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCloseModal}
            className="h-7.5 px-3 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-mono-tabular text-[11px] uppercase tracking-wider hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={!url.trim()}
            onClick={() => handleCreateDownload(false)}
            className="h-7.5 px-3 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-mono-tabular text-[11px] uppercase tracking-wider hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
            title="Add to queue in paused state"
          >
            Later
          </button>

          <button
            type="button"
            disabled={!url.trim() || submitting}
            onClick={() => handleCreateDownload(true)}
            className={`h-7.5 px-3.5 font-mono-tabular text-[11px] uppercase tracking-wider font-semibold cursor-pointer border disabled:opacity-50 ${submitting
              ? 'bg-zinc-400 text-white border-zinc-400'
              : 'bg-black text-white border-black hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:border-white dark:hover:bg-zinc-200'
              }`}
          >
            {submitting ? 'Starting...' : 'Start Download'}
          </button>
        </div>
      </div>
    </div>
  );

  const folderChangeModal = (
    <FolderChangeModal
      isOpen={isFolderModalOpen}
      initialPath={savePath}
      onClose={() => setIsFolderModalOpen(false)}
      onSelect={handleFolderSelected}
      title="SAVE DESTINATION"
      subtitle="CHOOSE DOWNLOAD FOLDER"
    />
  );

  const activeCard = isBanned ? bannedDialogCard : dialogCard;

  if (isStandalone) {
    return (
      <>
        {activeCard}
        {!isBanned && folderChangeModal}
      </>
    );
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-100"
        onClick={(e) => {
          if (e.target === e.currentTarget) handleCloseModal();
        }}
      >
        {activeCard}
      </div>
      {!isBanned && folderChangeModal}
    </>
  );
};
