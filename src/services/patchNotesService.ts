/**
 * Downex Dynamic In-App Patch Notes Service
 * 
 * Multi-tier patch notes synchronization and management engine:
 * 1. Seed fallback: Built-in baseline changelogs for v0.0.0 through v0.0.8.
 * 2. SQLite WAL persistence: Stored in downex.db table patch_notes via Rust IPC.
 * 3. On-demand cloud sync: Live GPHost release manifest inspection.
 * 4. In-App Authoring: Create and edit patch notes without touching codebase or rebuilding binaries.
 */

import { BASELINE_PATCH_NOTES, DynamicPatchNotes, parseNotesToHighlights } from '../data/patchNotes';
import { cleanVersion, compareSemver, formatVersion } from '../utils/version';
import { getDbPatchNotes, saveDbPatchNote, deleteDbPatchNote, DbPatchNoteRecord } from './tauriService';

export interface PatchNotesSyncResult {
  notes: DynamicPatchNotes[];
  fromCloud: boolean;
  lastSyncedAt: number;
  error?: string;
}

export type PatchNotesListener = (notes: DynamicPatchNotes[]) => void;

const SYNC_TIMESTAMP_KEY = 'downex_patch_notes_last_synced';

class PatchNotesService {
  private inMemoryNotes: DynamicPatchNotes[] = [];
  private lastSyncedAt: number = 0;
  private isFetching = false;
  private isInitialized = false;
  private listeners = new Set<PatchNotesListener>();

  constructor() {
    this.loadInitialBaseline();
    this.initializeFromDb().catch(() => {});
  }

  /**
   * 1. Pre-load synchronously with baseline catalog so UI has zero blank flicker
   */
  private loadInitialBaseline() {
    const map = new Map<string, DynamicPatchNotes>();
    for (const [v, item] of Object.entries(BASELINE_PATCH_NOTES)) {
      const cv = cleanVersion(v);
      map.set(cv, { ...item, version: cv });
    }

    try {
      const ts = localStorage.getItem(SYNC_TIMESTAMP_KEY);
      if (ts) this.lastSyncedAt = parseInt(ts, 10) || 0;
    } catch {}

    this.inMemoryNotes = this.sortNotes(Array.from(map.values()));
  }

  /**
   * 2. Asynchronously hydrate from persistent SQLite database
   */
  public async initializeFromDb(): Promise<DynamicPatchNotes[]> {
    try {
      const dbRecords = await getDbPatchNotes();
      const map = new Map<string, DynamicPatchNotes>();

      // Add baseline seed notes
      for (const [v, item] of Object.entries(BASELINE_PATCH_NOTES)) {
        const cv = cleanVersion(v);
        map.set(cv, { ...item, version: cv });
      }

      // Merge DB records over baseline
      for (const rec of dbRecords) {
        const cv = cleanVersion(rec.version);
        let highlights: string[] = [];
        try {
          highlights = JSON.parse(rec.highlights_json);
        } catch {
          highlights = parseNotesToHighlights(rec.raw_notes || '');
        }

        map.set(cv, {
          version: cv,
          title: rec.title,
          releaseDate: rec.release_date,
          highlights: highlights.length > 0 ? highlights : parseNotesToHighlights(rec.title),
          rawNotes: rec.raw_notes || undefined,
          isCustom: rec.is_custom,
          updatedAt: rec.updated_at,
        });
      }

      this.inMemoryNotes = this.sortNotes(Array.from(map.values()));
      this.isInitialized = true;
      this.notify();
    } catch (err) {
      console.warn('[PatchNotesService] Failed to hydrate from SQLite:', err);
    }
    return this.inMemoryNotes;
  }

  private sortNotes(notes: DynamicPatchNotes[]): DynamicPatchNotes[] {
    // Sort descending: highest semver first (e.g. 0.0.8 -> 0.0.7 -> ... -> 0.0.0)
    return [...notes].sort((a, b) => compareSemver(b.version, a.version));
  }

  public getLocalPatchNotes(): DynamicPatchNotes[] {
    return this.inMemoryNotes;
  }

  public getLastSyncedAt(): number {
    return this.lastSyncedAt;
  }

  public getIsInitialized(): boolean {
    return this.isInitialized;
  }

  public getIsFetching(): boolean {
    return this.isFetching;
  }

  public subscribe(listener: PatchNotesListener): () => void {
    this.listeners.add(listener);
    try {
      listener(this.inMemoryNotes);
    } catch {}
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.inMemoryNotes);
      } catch (err) {
        console.error('[PatchNotesService] Listener error:', err);
      }
    }
  }

  /**
   * On-demand cloud fetch from live GPHost release endpoint (zero background polling).
   * Extracts release notes from the active OTA manifest and automatically records into SQLite.
   */
  public async fetchCloudPatchNotes(): Promise<PatchNotesSyncResult> {
    if (this.isFetching) {
      return {
        notes: this.inMemoryNotes,
        fromCloud: false,
        lastSyncedAt: this.lastSyncedAt,
      };
    }

    this.isFetching = true;
    let fetchedFromCloud = false;
    let fetchError: string | undefined = undefined;

    const map = new Map<string, DynamicPatchNotes>();
    for (const item of this.inMemoryNotes) {
      map.set(cleanVersion(item.version), item);
    }

    try {
      const manifestUrl = `https://gphost.eu.cc/api/v1/releases/downex/latest?target=windows-x86_64&arch=x86_64&_t=${Date.now()}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(manifestUrl, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timeout);

      if (res.ok) {
        const manifest = await res.json();
        if (manifest && manifest.version) {
          const v = cleanVersion(manifest.version);
          const rawNotes = manifest.notes || '';
          const highlights = parseNotesToHighlights(rawNotes);
          const dateStr = manifest.pub_date
            ? new Date(manifest.pub_date).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })
            : 'Recent';

          const noteItem: DynamicPatchNotes = {
            version: v,
            title: `Release ${formatVersion(v)}`,
            releaseDate: dateStr,
            highlights: highlights.length > 0 ? highlights : parseNotesToHighlights(rawNotes),
            rawNotes,
            isCustom: false,
            updatedAt: Date.now(),
          };

          map.set(v, noteItem);
          fetchedFromCloud = true;

          // Save newly harvested cloud note to SQLite DB
          await this.persistNoteToDb(noteItem).catch(() => {});
        }
      }
    } catch (err: any) {
      console.warn('[PatchNotesService] Cloud manifest fetch error:', err);
      fetchError = 'Could not contact update server. Showing local history.';
    } finally {
      this.isFetching = false;
    }

    this.lastSyncedAt = Date.now();
    try {
      localStorage.setItem(SYNC_TIMESTAMP_KEY, String(this.lastSyncedAt));
    } catch {}

    this.inMemoryNotes = this.sortNotes(Array.from(map.values()));
    this.notify();

    return {
      notes: this.inMemoryNotes,
      fromCloud: fetchedFromCloud,
      lastSyncedAt: this.lastSyncedAt,
      error: fetchError,
    };
  }

  /**
   * In-App authoring / editing: saves a patch note permanently to SQLite
   */
  public async savePatchNote(note: DynamicPatchNotes): Promise<void> {
    const cv = cleanVersion(note.version);
    const cleanNote: DynamicPatchNotes = {
      ...note,
      version: cv,
      isCustom: true,
      updatedAt: Date.now(),
    };

    // 1. Persist to SQLite
    await this.persistNoteToDb(cleanNote);

    // 2. Update memory state
    const map = new Map<string, DynamicPatchNotes>();
    for (const item of this.inMemoryNotes) {
      map.set(cleanVersion(item.version), item);
    }
    map.set(cv, cleanNote);

    this.inMemoryNotes = this.sortNotes(Array.from(map.values()));
    this.notify();
  }

  /**
   * Delete an in-app authored patch note from SQLite
   */
  public async deletePatchNote(version: string): Promise<void> {
    const cv = cleanVersion(version);
    await deleteDbPatchNote(cv);

    // Remove from in-memory (or restore baseline if baseline exists)
    const baseline = BASELINE_PATCH_NOTES[cv];
    if (baseline) {
      this.inMemoryNotes = this.sortNotes(
        this.inMemoryNotes.map((n) => (n.version === cv ? { ...baseline, version: cv } : n))
      );
    } else {
      this.inMemoryNotes = this.sortNotes(this.inMemoryNotes.filter((n) => n.version !== cv));
    }

    this.notify();
  }

  private async persistNoteToDb(note: DynamicPatchNotes): Promise<void> {
    const record: DbPatchNoteRecord = {
      version: cleanVersion(note.version),
      title: note.title,
      release_date: note.releaseDate,
      highlights_json: JSON.stringify(note.highlights || []),
      raw_notes: note.rawNotes || null,
      is_custom: Boolean(note.isCustom),
      updated_at: note.updatedAt || Date.now(),
    };
    await saveDbPatchNote(record);
  }
}

export const patchNotesService = new PatchNotesService();
