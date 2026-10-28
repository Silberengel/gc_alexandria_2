import { get, writable } from 'svelte/store';

export type DirectorySortCol = 'name' | 'created' | 'objects' | 'kind';
export type DirectorySortDir = 'asc' | 'desc';

export type DirectoryColumnId = 'name' | 'created' | 'objects' | 'kind';

export type DirectoryBrowserPrefs = {
  sortCol: DirectorySortCol;
  sortDir: DirectorySortDir;
  /** Pixel widths for resizable columns. */
  widths: Partial<Record<DirectoryColumnId, number>>;
};

const STORAGE_KEY = 'alexandria-directory-browser';

export const DEFAULT_DIRECTORY_COLUMN_WIDTHS: Record<DirectoryColumnId, number> = {
  name: 280,
  created: 120,
  objects: 148,
  kind: 110
};

export const MIN_DIRECTORY_COLUMN_WIDTH = 48;

const SORT_COLS = new Set<DirectorySortCol>(['name', 'created', 'objects', 'kind']);

export function normalizeDirectoryBrowserPrefs(raw: unknown): DirectoryBrowserPrefs {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const sortCol = SORT_COLS.has(obj.sortCol as DirectorySortCol)
    ? (obj.sortCol as DirectorySortCol)
    : 'name';
  const sortDir: DirectorySortDir = obj.sortDir === 'desc' ? 'desc' : 'asc';
  const widths: Partial<Record<DirectoryColumnId, number>> = {};
  const rawWidths =
    obj.widths && typeof obj.widths === 'object'
      ? (obj.widths as Record<string, unknown>)
      : {};
  for (const id of Object.keys(DEFAULT_DIRECTORY_COLUMN_WIDTHS) as DirectoryColumnId[]) {
    const n = Number(rawWidths[id]);
    if (Number.isFinite(n) && n >= MIN_DIRECTORY_COLUMN_WIDTH) {
      widths[id] = Math.round(n);
    }
  }
  return { sortCol, sortDir, widths };
}

function read(): DirectoryBrowserPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return normalizeDirectoryBrowserPrefs(null);
    return normalizeDirectoryBrowserPrefs(JSON.parse(raw));
  } catch {
    return normalizeDirectoryBrowserPrefs(null);
  }
}

function createDirectoryBrowserPrefsStore() {
  const initial =
    typeof localStorage !== 'undefined'
      ? read()
      : normalizeDirectoryBrowserPrefs(null);
  const store = writable<DirectoryBrowserPrefs>(initial);

  function persist(next: DirectoryBrowserPrefs): void {
    const normalized = normalizeDirectoryBrowserPrefs(next);
    store.set(normalized);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      /* quota / private mode */
    }
  }

  return {
    subscribe: store.subscribe,
    get(): DirectoryBrowserPrefs {
      return get(store);
    },
    setSort(col: DirectorySortCol, dir: DirectorySortDir): void {
      const cur = get(store);
      persist({ ...cur, sortCol: col, sortDir: dir });
    },
    /** Toggle dir when same column; otherwise sort ascending (created defaults desc). */
    toggleSort(col: DirectorySortCol): void {
      const cur = get(store);
      if (cur.sortCol === col) {
        persist({ ...cur, sortDir: cur.sortDir === 'asc' ? 'desc' : 'asc' });
        return;
      }
      persist({
        ...cur,
        sortCol: col,
        sortDir: col === 'created' || col === 'objects' ? 'desc' : 'asc'
      });
    },
    setWidth(col: DirectoryColumnId, px: number): void {
      const cur = get(store);
      const width = Math.max(MIN_DIRECTORY_COLUMN_WIDTH, Math.round(px));
      persist({ ...cur, widths: { ...cur.widths, [col]: width } });
    },
    setWidths(widths: Partial<Record<DirectoryColumnId, number>>): void {
      const cur = get(store);
      persist({ ...cur, widths: { ...cur.widths, ...widths } });
    }
  };
}

export const directoryBrowserPrefs = createDirectoryBrowserPrefsStore();

export function resolvedDirectoryColumnWidth(
  prefs: DirectoryBrowserPrefs,
  col: DirectoryColumnId
): number {
  return prefs.widths[col] ?? DEFAULT_DIRECTORY_COLUMN_WIDTHS[col];
}
