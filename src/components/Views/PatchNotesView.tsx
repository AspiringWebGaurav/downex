import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Edit2,
  Plus,
  RefreshCw,
  Search,
  Layers,
} from 'lucide-react';
import { patchNotesService } from '../../services/patchNotesService';
import { DynamicPatchNotes } from '../../data/patchNotes';
import { cleanVersion, formatVersion } from '../../utils/version';
import { useAppVersionStore } from '../../stores/appVersionStore';
import { PatchNoteEditorModal } from '../Modals/PatchNoteEditorModal';

interface PatchNotesViewProps {
  onBack: () => void;
}

export const PatchNotesView: React.FC<PatchNotesViewProps> = ({ onBack }) => {
  const formattedVersion = useAppVersionStore((state) => state.formattedVersion);
  const currentRunningVersion = cleanVersion(formattedVersion);

  const [notes, setNotes] = useState<DynamicPatchNotes[]>(() =>
    patchNotesService.getLocalPatchNotes()
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<number>(() =>
    patchNotesService.getLastSyncedAt()
  );
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<DynamicPatchNotes | null>(null);

  // Subscribe to patchNotesService updates
  useEffect(() => {
    const unsubscribe = patchNotesService.subscribe((updatedNotes) => {
      setNotes(updatedNotes);
    });
    return unsubscribe;
  }, []);

  // Hydrate from SQLite & trigger on-mount cloud check
  useEffect(() => {
    patchNotesService.initializeFromDb().then((loaded) => {
      setNotes(loaded);
      // Auto-sync latest cloud patch notes in background
      patchNotesService.fetchCloudPatchNotes().catch(() => {});
    });
  }, []);

  const handleCloudSync = async () => {
    setIsSyncing(true);
    setSyncStatusMsg(null);
    try {
      const res = await patchNotesService.fetchCloudPatchNotes();
      setNotes(res.notes);
      setLastSyncTime(res.lastSyncedAt);
      if (res.fromCloud) {
        setSyncStatusMsg('Synced latest releases from cloud');
      } else if (res.error) {
        setSyncStatusMsg(res.error);
      } else {
        setSyncStatusMsg('All release changelogs up to date');
      }
    } catch {
      setSyncStatusMsg('Offline mode — using local database history');
    } finally {
      setIsSyncing(false);
    }
  };

  const toggleExpand = (ver: string) => {
    setExpandedNotes((prev) => ({ ...prev, [ver]: !prev[ver] }));
  };

  const toggleAll = (expand: boolean) => {
    const next: Record<string, boolean> = {};
    for (const item of notes) {
      next[cleanVersion(item.version)] = expand;
    }
    setExpandedNotes(next);
  };

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) => {
      const v = cleanVersion(n.version).toLowerCase();
      const t = (n.title || '').toLowerCase();
      const h = (n.highlights || []).join(' ').toLowerCase();
      const r = (n.rawNotes || '').toLowerCase();
      return v.includes(q) || t.includes(q) || h.includes(q) || r.includes(q);
    });
  }, [notes, searchQuery]);

  const formatSyncTime = (ts: number) => {
    if (!ts) return 'Local Cache';
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const openNewEditor = () => {
    setEditingNote(null);
    setIsEditorOpen(true);
  };

  const openEditNote = (note: DynamicPatchNotes) => {
    setEditingNote(note);
    setIsEditorOpen(true);
  };

  return (
    <div className="flex-1 h-full overflow-y-auto px-6 py-5 select-none bg-white dark:bg-zinc-950 font-sans transition-colors duration-150">
      <div className="max-w-4xl mx-auto space-y-5 pb-12">
        {/* Navigation Breadcrumb & Header */}
        <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer"
              title="Return to Settings"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400 dark:text-zinc-500 font-mono">Settings /</span>
                <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  Release Notes & Changelogs
                </h2>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Detailed version history and feature changelogs across all published releases.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={openNewEditor}
              className="px-3 py-1.5 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-xs font-semibold hover:opacity-90 flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Author Note</span>
            </button>
          </div>
        </div>

        {/* Action & Filter Bar */}
        <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-3.5 bg-zinc-50/60 dark:bg-zinc-900/40 flex items-center justify-between gap-3 flex-wrap">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search changelogs or versions... (e.g. 0.0.8)"
              className="w-full px-3 py-1.5 pl-8 text-xs font-mono rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 focus:outline-none focus:border-emerald-500 text-zinc-900 dark:text-zinc-100"
            />
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Expand / Collapse All */}
            <div className="flex items-center border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden text-[11px] font-mono">
              <button
                type="button"
                onClick={() => toggleAll(true)}
                className="px-2.5 py-1 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                Expand All
              </button>
              <div className="w-[1px] h-4 bg-zinc-200 dark:bg-zinc-800" />
              <button
                type="button"
                onClick={() => toggleAll(false)}
                className="px-2.5 py-1 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                Collapse
              </button>
            </div>

            {/* Sync from Cloud */}
            <button
              type="button"
              onClick={handleCloudSync}
              disabled={isSyncing}
              className="px-3 py-1 text-xs font-medium border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50 shadow-xs"
            >
              <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin text-emerald-500' : ''}`} />
              <span>{isSyncing ? 'Syncing...' : 'Sync Cloud'}</span>
            </button>
          </div>
        </div>

        {/* Status Feedback Notice */}
        {syncStatusMsg && (
          <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-xs font-mono text-emerald-700 dark:text-emerald-300 flex items-center justify-between">
            <span>{syncStatusMsg}</span>
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
              {formatSyncTime(lastSyncTime)}
            </span>
          </div>
        )}

        {/* Release Timeline Header */}
        <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 px-1 pt-1">
          <div className="flex items-center gap-1.5 font-semibold text-zinc-800 dark:text-zinc-200">
            <Layers className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Version History Timeline ({filteredNotes.length} releases)</span>
          </div>
          <span className="text-[11px] font-mono text-zinc-400 dark:text-zinc-500">
            Latest releases first • In-app persistence active
          </span>
        </div>

        {/* Timeline Cards Container */}
        <div className="space-y-4">
          {filteredNotes.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                No patch notes found matching "{searchQuery}".
              </p>
            </div>
          ) : (
            filteredNotes.map((item, idx) => {
              const itemCleanVer = cleanVersion(item.version);
              const isCurrentRunning = itemCleanVer === currentRunningVersion;
              const isLatest = idx === 0 && itemCleanVer !== '0.0.0';
              const isExpanded = !!expandedNotes[itemCleanVer];

              return (
                <div
                  key={itemCleanVer}
                  className={`border rounded-xl p-5 bg-white dark:bg-zinc-900 transition-all shadow-xs ${
                    isCurrentRunning
                      ? 'border-emerald-500/80 ring-1 ring-emerald-500/20'
                      : 'border-zinc-200/90 dark:border-zinc-800/90'
                  }`}
                >
                  {/* Top Header Row */}
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="text-base font-bold font-mono tracking-tight text-zinc-900 dark:text-zinc-100">
                        {formatVersion(item.version)}
                      </span>

                      {isCurrentRunning && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                          CURRENT RUNNING BUILD
                        </span>
                      )}

                      {isLatest && !isCurrentRunning && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300 border border-violet-300 dark:border-violet-800">
                          LATEST OTA RELEASE
                        </span>
                      )}

                      {itemCleanVer === '0.0.0' && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                          LIFETIME BASE ANCHOR
                        </span>
                      )}

                      {item.isCustom && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-300 border border-cyan-300 dark:border-cyan-800">
                          IN-APP AUTHORED
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      {item.releaseDate && (
                        <div className="flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500 font-mono">
                          <Calendar className="w-3.5 h-3.5" />
                          <span>{item.releaseDate}</span>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => openEditNote(item)}
                        className="p-1 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                        title="Edit Release Note"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Title */}
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mt-2">
                    {item.title}
                  </h4>

                  {/* Highlights Bullet List */}
                  <div className="mt-3.5 pt-3.5 border-t border-zinc-100 dark:border-zinc-800/80 flex flex-col gap-2">
                    {item.highlights && item.highlights.length > 0 ? (
                      item.highlights.map((h, hIdx) => (
                        <div key={hIdx} className="flex items-start gap-2.5 text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
                          <div className="w-4 h-4 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5 border border-emerald-200 dark:border-emerald-800/60">
                            <Check className="w-2.5 h-2.5 stroke-[3]" />
                          </div>
                          <span>{h}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-zinc-400">Performance enhancements and maintenance updates.</p>
                    )}
                  </div>

                  {/* Expandable Manifest Raw Notes */}
                  {item.rawNotes && (
                    <div className="mt-4 pt-3 border-t border-dashed border-zinc-100 dark:border-zinc-800">
                      <button
                        type="button"
                        onClick={() => toggleExpand(itemCleanVer)}
                        className="inline-flex items-center gap-1.5 text-[11px] font-mono text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors cursor-pointer select-none"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                        <span>{isExpanded ? 'Hide release manifest' : 'View release manifest note'}</span>
                      </button>

                      {isExpanded && (
                        <div className="mt-2 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200/70 dark:border-zinc-800/70 font-mono text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed break-words whitespace-pre-wrap select-text animate-in fade-in duration-150">
                          {item.rawNotes}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* In-App Editor Modal */}
      <PatchNoteEditorModal
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        initialNote={editingNote}
      />
    </div>
  );
};
