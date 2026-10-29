import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Save, FileText, Calendar, Check, AlertCircle } from 'lucide-react';
import { DynamicPatchNotes } from '../../data/patchNotes';
import { cleanVersion, formatVersion } from '../../utils/version';
import { patchNotesService } from '../../services/patchNotesService';

interface PatchNoteEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialNote?: DynamicPatchNotes | null;
}

export const PatchNoteEditorModal: React.FC<PatchNoteEditorModalProps> = ({
  isOpen,
  onClose,
  initialNote,
}) => {
  const [version, setVersion] = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  const [title, setTitle] = useState('');
  const [highlights, setHighlights] = useState<string[]>(['']);
  const [rawNotes, setRawNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isCloseHovered, setIsCloseHovered] = useState(false);

  useEffect(() => {
    if (initialNote) {
      setVersion(cleanVersion(initialNote.version));
      setReleaseDate(initialNote.releaseDate || '');
      setTitle(initialNote.title || '');
      setHighlights(initialNote.highlights && initialNote.highlights.length > 0 ? initialNote.highlights : ['']);
      setRawNotes(initialNote.rawNotes || '');
    } else {
      // Default to next release suggestion or current date
      setVersion('');
      const today = new Date().toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
      setReleaseDate(today);
      setTitle('');
      setHighlights(['']);
      setRawNotes('');
    }
    setErrorMsg(null);
  }, [initialNote, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleAddHighlight = () => {
    setHighlights((prev) => [...prev, '']);
  };

  const handleHighlightChange = (index: number, val: string) => {
    setHighlights((prev) => {
      const copy = [...prev];
      copy[index] = val;
      return copy;
    });
  };

  const handleRemoveHighlight = (index: number) => {
    setHighlights((prev) => {
      if (prev.length <= 1) return [''];
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanVer = cleanVersion(version);
    if (!cleanVer || cleanVer === '0.0.0' && !initialNote) {
      setErrorMsg('Please specify a valid version number (e.g. 0.0.9)');
      return;
    }
    if (!title.trim()) {
      setErrorMsg('Please provide a release title');
      return;
    }

    const cleanHighlights = highlights.map((h) => h.trim()).filter((h) => h.length > 0);
    if (cleanHighlights.length === 0) {
      setErrorMsg('Please add at least one highlight bullet point');
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);
    try {
      await patchNotesService.savePatchNote({
        version: cleanVer,
        releaseDate: releaseDate.trim() || 'Recent',
        title: title.trim(),
        highlights: cleanHighlights,
        rawNotes: rawNotes.trim() || undefined,
        isCustom: true,
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save patch note to local engine.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!initialNote) return;
    const cv = cleanVersion(initialNote.version);
    if (!confirm(`Are you sure you want to remove in-app notes for ${formatVersion(cv)}?`)) {
      return;
    }
    setIsSaving(true);
    try {
      await patchNotesService.deletePatchNote(cv);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to delete note');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs select-none animate-in fade-in duration-150 p-4">
      <div className="w-[520px] max-w-full max-h-[90vh] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-[#00875a] text-white flex items-center justify-center text-xs font-bold shadow-xs">
              <FileText className="w-3.5 h-3.5" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                {initialNote ? `Edit Patch Note — ${formatVersion(initialNote.version)}` : 'Author New Patch Note'}
              </h3>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                Managed directly in Downex • Zero rebuild required
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            onMouseEnter={() => setIsCloseHovered(true)}
            onMouseLeave={() => setIsCloseHovered(false)}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              isCloseHovered
                ? 'bg-rose-500 text-white'
                : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200'
            }`}
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-5 space-y-4">
          {errorMsg && (
            <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Row: Version & Release Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Version Tag <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="0.0.9"
                required
                className="w-full px-3 py-1.5 text-xs font-mono rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:border-emerald-500 text-zinc-900 dark:text-zinc-100"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Release Date
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={releaseDate}
                  onChange={(e) => setReleaseDate(e.target.value)}
                  placeholder="October 29, 2026"
                  className="w-full px-3 py-1.5 pl-8 text-xs font-mono rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:border-emerald-500 text-zinc-900 dark:text-zinc-100"
                />
                <Calendar className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              </div>
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Release Headline / Title <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enhanced Network Throughput & UI Improvements"
              required
              className="w-full px-3 py-1.5 text-xs rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:border-emerald-500 text-zinc-900 dark:text-zinc-100"
            />
          </div>

          {/* Highlights */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                Key Highlights & Changes <span className="text-rose-500">*</span>
              </label>
              <button
                type="button"
                onClick={handleAddHighlight}
                className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1 hover:underline cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>Add Bullet</span>
              </button>
            </div>

            <div className="space-y-2">
              {highlights.map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-200 dark:border-emerald-800">
                    <Check className="w-2.5 h-2.5 stroke-[3]" />
                  </div>
                  <input
                    type="text"
                    value={h}
                    onChange={(e) => handleHighlightChange(i, e.target.value)}
                    placeholder={`Highlight #${i + 1}`}
                    className="flex-1 px-2.5 py-1 text-xs rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:border-emerald-500 text-zinc-900 dark:text-zinc-100"
                  />
                  {highlights.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveHighlight(i)}
                      className="p-1 rounded text-zinc-400 hover:text-rose-500 cursor-pointer"
                      title="Remove highlight"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Raw / Manifest Notes */}
          <div>
            <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Raw Manifest Notes (Optional)
            </label>
            <textarea
              rows={3}
              value={rawNotes}
              onChange={(e) => setRawNotes(e.target.value)}
              placeholder="Optional markdown or release manifest notes text..."
              className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:border-emerald-500 text-zinc-900 dark:text-zinc-100 resize-none"
            />
          </div>

          {/* Actions Bar */}
          <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
            <div>
              {initialNote && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isSaving}
                  className="px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 text-xs font-medium hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer disabled:opacity-50"
                >
                  Delete
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-4 py-1.5 rounded-lg bg-[#00875a] text-white text-xs font-semibold hover:opacity-90 flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSaving ? 'Saving...' : 'Save Release Note'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

