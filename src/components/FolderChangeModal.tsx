import React, { useState, useEffect } from 'react';
import { X, Folder, HardDrive, Check, FolderOpen, ClipboardPaste } from 'lucide-react';
import { getDiskFreeSpace, getClipboardText, openFolderPicker } from '../services/tauriService';
import { formatBytes } from '../utils/format';

export interface FolderChangeModalProps {
  isOpen: boolean;
  initialPath: string;
  onClose: () => void;
  onSelect: (selectedPath: string) => void;
  title?: string;
  subtitle?: string;
}

export const FolderChangeModal: React.FC<FolderChangeModalProps> = ({
  isOpen,
  initialPath,
  onClose,
  onSelect,
  title = 'CHANGE DOWNLOAD FOLDER',
  subtitle = 'STORAGE LOCATION',
}) => {
  const [currentPath, setCurrentPath] = useState<string>(initialPath || 'C:\\Downloads\\Downex');
  const [freeSpaceBytes, setFreeSpaceBytes] = useState<number | null>(null);
  const [isBrowsingNative, setIsBrowsingNative] = useState(false);

  // Sync initial path and disk space whenever modal opens
  useEffect(() => {
    if (isOpen) {
      const startPath = initialPath || 'C:\\Downloads\\Downex';
      setCurrentPath(startPath);
      getDiskFreeSpace(startPath).then((bytes) => setFreeSpaceBytes(bytes));
    }
  }, [isOpen, initialPath]);

  // Handle ESC key to dismiss modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handlePathChange = (val: string) => {
    setCurrentPath(val);
    if (val.trim()) {
      getDiskFreeSpace(val.trim()).then((bytes) => setFreeSpaceBytes(bytes));
    } else {
      setFreeSpaceBytes(null);
    }
  };

  const handlePastePath = async () => {
    try {
      let text = await getClipboardText();
      if (!text && navigator.clipboard) {
        text = await navigator.clipboard.readText();
      }
      if (text && text.trim()) {
        const cleaned = text.trim().replace(/^["']|["']$/g, '');
        handlePathChange(cleaned);
      }
    } catch (e) {
      console.warn('Failed to paste path:', e);
    }
  };

  const handleNativeBrowse = async () => {
    setIsBrowsingNative(true);
    try {
      const selected = await openFolderPicker();
      if (selected && selected.trim()) {
        handlePathChange(selected.trim());
      }
    } catch (e) {
      console.warn('Native folder browse notice:', e);
    } finally {
      setIsBrowsingNative(false);
    }
  };

  const handleConfirm = () => {
    const trimmed = currentPath.trim();
    if (trimmed) {
      onSelect(trimmed);
      onClose();
    }
  };

  // Derive base user folder for fast, intelligent quick-pick shortcuts
  const userProfile = (() => {
    const match = currentPath.match(/^([A-Za-z]:\\Users\\[^\\]+)/i);
    if (match) return match[1];
    const initMatch = (initialPath || '').match(/^([A-Za-z]:\\Users\\[^\\]+)/i);
    if (initMatch) return initMatch[1];
    return 'C:\\Users\\User';
  })();

  const drive = (() => {
    const match = currentPath.match(/^([A-Za-z]:)/);
    return match ? match[1].toUpperCase() : 'C:';
  })();

  const folderName = (() => {
    const trimmed = currentPath.replace(/[\\/]+$/, '');
    const lastSlash = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
    return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
  })();

  const shortcuts = [
    { label: 'Downex', path: `${userProfile}\\Downloads\\Downex`, desc: 'Standard App Folder' },
    { label: 'Downloads', path: `${userProfile}\\Downloads`, desc: 'User Downloads' },
    { label: 'Documents', path: `${userProfile}\\Documents\\Downex`, desc: 'Documents Store' },
    { label: 'Desktop', path: `${userProfile}\\Desktop`, desc: 'Desktop Folder' },
    { label: 'C:\\Root', path: 'C:\\Downloads\\Downex', desc: 'Direct C: Volume' },
    { label: 'D:\\Root', path: 'D:\\Downloads\\Downex', desc: 'Secondary Volume' },
  ];

  return (
    <div
      data-testid="folder-change-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] select-none p-4 transition-opacity duration-150"
      onClick={onClose}
    >
      <div
        className="w-[450px] max-w-[94vw] bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden select-none border border-zinc-200 dark:border-zinc-800 shadow-2xl modal-enter-instant flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title Bar Strip (1:1 with NewDownloadModal & DeleteConfirmModal) */}
        <div className="h-8 px-3.5 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 select-none cursor-move shrink-0">
          <div className="flex items-center gap-2">
            <Folder className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 stroke-[2]" />
            <span className="font-mono-tabular text-[10.5px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400 font-semibold">
              {title}
            </span>
            <span className="text-[10px] font-mono-tabular text-zinc-400">
              {subtitle}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer focus:outline-none"
          >
            <X className="w-3.5 h-3.5 stroke-[1.8]" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-3.5 space-y-2.5">
          {/* Row 1: Editable Folder Path with Live Free Space & Paste Action */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-semibold text-zinc-900 dark:text-zinc-100">
                Destination Folder
              </label>
              <div className="flex items-center gap-2">
                {freeSpaceBytes !== null && (
                  <span className="text-[10px] font-mono-tabular flex items-center gap-1 text-zinc-400">
                    <HardDrive className="w-3 h-3" />
                    <span>{formatBytes(freeSpaceBytes)} free</span>
                  </span>
                )}
                <button
                  type="button"
                  onClick={handlePastePath}
                  className="text-[10px] font-mono-tabular font-semibold text-emerald-600 dark:text-emerald-400 hover:underline transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <ClipboardPaste className="w-3 h-3" />
                  <span>PASTE</span>
                </button>
              </div>
            </div>

            <div className="relative flex items-center">
              <input
                type="text"
                data-testid="folder-change-input"
                value={currentPath}
                onChange={(e) => handlePathChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleConfirm();
                  }
                }}
                placeholder="e.g. C:\Users\YourName\Downloads\Downex"
                className="w-full px-2.5 py-1.5 pl-8 border border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-950/50 text-[11px] font-mono-tabular text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-black dark:focus:border-white transition-colors"
              />
              <Folder className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {/* Row 2: Telemetry 2x2 Grid (Volume, Free Space, Folder Name, Status) */}
          <div className="grid grid-cols-2 gap-2 text-[11px] font-mono-tabular">
            <div className="p-2 border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
              <div className="text-[9.5px] uppercase tracking-wider text-zinc-400 mb-0.5">
                Target Volume
              </div>
              <div className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center justify-between">
                <span>{drive}\ Drive</span>
                <span className="text-[9.5px] text-emerald-600 dark:text-emerald-400 font-bold">READY</span>
              </div>
            </div>

            <div className="p-2 border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
              <div className="text-[9.5px] uppercase tracking-wider text-zinc-400 mb-0.5">
                Available Disk Space
              </div>
              <div className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <HardDrive className="w-3 h-3 text-emerald-500" />
                <span>{freeSpaceBytes !== null ? formatBytes(freeSpaceBytes) : 'Calculating...'}</span>
              </div>
            </div>

            <div className="p-2 border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
              <div className="text-[9.5px] uppercase tracking-wider text-zinc-400 mb-0.5">
                Target Folder
              </div>
              <div className="font-semibold text-zinc-900 dark:text-zinc-100 truncate" title={folderName}>
                {folderName || 'Root'}
              </div>
            </div>

            <div className="p-2 border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
              <div className="text-[9.5px] uppercase tracking-wider text-zinc-400 mb-0.5">
                Storage State
              </div>
              <div className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <Check className="w-3 h-3" />
                <span>VALID DIRECTORY</span>
              </div>
            </div>
          </div>

          {/* Row 3: Quick System Locations (One-Click Chips) */}
          <div>
            <div className="text-[10px] font-mono-tabular uppercase tracking-wider text-zinc-400 mb-1.5 flex items-center justify-between">
              <span>Quick Shortcuts</span>
              <span>1-CLICK SELECT</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {shortcuts.map((sc) => {
                const isSelected = currentPath.toLowerCase() === sc.path.toLowerCase();
                return (
                  <button
                    key={sc.label}
                    type="button"
                    data-testid={`folder-shortcut-${sc.label.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
                    onClick={() => handlePathChange(sc.path)}
                    title={sc.path}
                    className={`px-2 py-1.5 border text-left rounded-none font-mono-tabular transition-colors cursor-pointer flex flex-col justify-between ${
                      isSelected
                        ? 'border-emerald-500/80 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-bold'
                        : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10.5px] font-semibold">{sc.label}</span>
                      {isSelected && <Check className="w-2.5 h-2.5 text-emerald-500" />}
                    </div>
                    <span className="text-[9px] text-zinc-400 truncate mt-0.5">{sc.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Row 4: Optional Native Windows Explorer Picker */}
          <button
            type="button"
            data-testid="folder-change-native-btn"
            onClick={handleNativeBrowse}
            disabled={isBrowsingNative}
            className="w-full h-7 border border-dashed border-zinc-300 dark:border-zinc-700 hover:border-emerald-500/60 hover:bg-emerald-50/20 dark:hover:bg-emerald-950/20 text-zinc-600 dark:text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 flex items-center justify-center gap-1.5 text-[10.5px] font-mono-tabular transition-colors cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>{isBrowsingNative ? 'Opening Explorer...' : 'Browse in Windows Explorer...'}</span>
          </button>
        </div>

        {/* Footer Actions */}
        <div className="p-3.5 pt-0 flex items-center gap-2 border-t border-zinc-100 dark:border-zinc-800/60">
          <button
            type="button"
            data-testid="folder-change-cancel-btn"
            onClick={onClose}
            className="w-[84px] h-8 border border-zinc-300 dark:border-zinc-700 bg-transparent text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-mono-tabular text-[11px] font-medium transition-colors cursor-pointer"
          >
            CANCEL
          </button>
          <button
            type="button"
            data-testid="folder-change-confirm-btn"
            onClick={handleConfirm}
            disabled={!currentPath.trim()}
            className="flex-1 h-8 bg-black dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200 font-mono-tabular text-[11px] font-bold tracking-wider uppercase transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Check className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>SELECT FOLDER</span>
          </button>
        </div>
      </div>
    </div>
  );
};
