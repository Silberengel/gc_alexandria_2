import { writable } from 'svelte/store';
import type { ReadingQueueEntry } from '$lib/reading-queue';

const STORAGE_KEY = 'alexandria-reading-queue-local';

function load(): ReadingQueueEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: ReadingQueueEntry[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Partial<ReadingQueueEntry>;
      if (typeof r.a !== 'string' || !r.a) continue;
      const pos = Number(r.pos);
      const total = Number(r.total);
      if (!Number.isFinite(pos) || !Number.isFinite(total) || total < 1) continue;
      out.push({
        a: r.a,
        pos: Math.max(0, Math.floor(pos)),
        total: Math.max(1, Math.floor(total)),
        sectionId: typeof r.sectionId === 'string' && r.sectionId ? r.sectionId : undefined,
        updated:
          typeof r.updated === 'number' && Number.isFinite(r.updated) && r.updated > 0
            ? Math.floor(r.updated)
            : undefined
      });
    }
    return out;
  } catch {
    return [];
  }
}

function createLocalReadingQueueStore() {
  const initial = typeof localStorage !== 'undefined' ? load() : [];
  const { subscribe, set, update } = writable<ReadingQueueEntry[]>(initial);

  function persist(entries: ReadingQueueEntry[]): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    }
  }

  return {
    subscribe,
    /** Replace the whole local queue (Track / Stop / progress / finish). */
    replace(entries: ReadingQueueEntry[]): void {
      persist(entries);
      set(entries);
    },
    /** Seed once when enabling local-only and the store is empty. */
    seedIfEmpty(entries: ReadingQueueEntry[]): void {
      update((cur) => {
        if (cur.length > 0) return cur;
        if (entries.length === 0) return cur;
        persist(entries);
        return entries;
      });
    },
    clear(): void {
      persist([]);
      set([]);
    }
  };
}

export const localReadingQueue = createLocalReadingQueueStore();
