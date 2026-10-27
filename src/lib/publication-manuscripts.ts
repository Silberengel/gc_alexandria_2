/**
 * Durable local manuscripts for kind-30040 AsciiDoc split mode.
 * IndexedDB (not sessionStorage) so multi-MB sources survive browser restarts
 * and PWA updates. Meta and body are separate stores so Drafts listing does not
 * load full AsciiDoc.
 *
 * Schema versions:
 * - v1: single store with inline `source`
 * - v2: split `bodies` store (may leave inline `source` if migrate raced)
 * - v3: repair/normalize — move any leftover inline `source`, strip it from meta
 */

export type PublicationIndexDepth = 2 | 3 | 4;

export type PublicationManuscriptMeta = {
  id: string;
  pubkey: string;
  title: string;
  dTag: string;
  maxIndexLevel: PublicationIndexDepth;
  updatedAt: number;
};

export type PublicationManuscript = PublicationManuscriptMeta & {
  source: string;
};

/** Discriminated get result — callers must not purge on `error`. */
export type ManuscriptGetResult =
  | { status: 'ok'; manuscript: PublicationManuscript }
  | { status: 'missing' }
  | { status: 'orphan'; meta: PublicationManuscriptMeta }
  | { status: 'error'; error: Error };

const DB_NAME = 'alexandria-manuscripts';
/** Bump when schema/migration steps change; old clients upgrade via onupgradeneeded. */
export const MANUSCRIPT_DB_VERSION = 3;
const META_STORE = 'manuscripts';
const BODY_STORE = 'bodies';

type BackendGetResult =
  | { status: 'ok'; manuscript: PublicationManuscript }
  | { status: 'missing' }
  | { status: 'orphan'; meta: PublicationManuscriptMeta };

type ManuscriptBackend = {
  listMeta(pubkey: string): Promise<PublicationManuscriptMeta[]>;
  get(id: string): Promise<BackendGetResult>;
  put(m: PublicationManuscript): Promise<void>;
  delete(id: string): Promise<void>;
  deleteForPubkey(pubkey: string): Promise<void>;
};

let backendOverride: ManuscriptBackend | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;
/** Memory-store test hook: drop body while leaving meta (corrupt row). */
let dropBodyForTests: ((id: string) => void) | null = null;
/** Test hook: next `putManuscript` rejects once. */
let failNextPutForTests: Error | null = null;

/** Staged write so pagehide / HMR can flush the latest body. */
let staged: PublicationManuscript | null = null;
let flushListenersInstalled = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let onFlushListeners = new Set<() => void>();
let onPersistErrorListeners = new Set<(err: Error) => void>();

export function newManuscriptId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ms-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function clampManuscriptIndexDepth(n: unknown): PublicationIndexDepth {
  return n === 3 || n === 4 ? n : 2;
}

function normalizeMeta(raw: Partial<PublicationManuscriptMeta>): PublicationManuscriptMeta {
  return {
    id: String(raw.id ?? '').trim(),
    pubkey: String(raw.pubkey ?? '').trim().toLowerCase(),
    title: String(raw.title ?? '').trim() || 'Untitled manuscript',
    dTag: String(raw.dTag ?? '').trim(),
    maxIndexLevel: clampManuscriptIndexDepth(raw.maxIndexLevel),
    updatedAt: Number(raw.updatedAt) || Date.now()
  };
}

function normalizeManuscript(raw: PublicationManuscript): PublicationManuscript {
  return {
    ...normalizeMeta(raw),
    source: String(raw.source ?? '')
  };
}

function asError(err: unknown, fallback: string): Error {
  return err instanceof Error ? err : new Error(fallback);
}

/**
 * Ensure stores exist and move any inline `source` onto `bodies`.
 * Safe to re-run (v1→v3, v2→v3, and future reopen repairs via version bump).
 */
function migrateMetaBodySplit(
  tx: IDBTransaction,
  fail: (err: unknown) => void
): void {
  const metaStore = tx.objectStore(META_STORE);
  const bodyStore = tx.objectStore(BODY_STORE);
  const allReq = metaStore.getAll();
  allReq.onerror = () => fail(allReq.error ?? new Error('migration getAll failed'));
  allReq.onsuccess = () => {
    try {
      const rows = allReq.result as Array<PublicationManuscriptMeta & { source?: string }>;
      for (const row of rows) {
        if (!row?.id) continue;
        if (typeof row.source === 'string') {
          const putBody = bodyStore.put({ id: row.id, source: row.source });
          putBody.onerror = () =>
            fail(putBody.error ?? new Error('migration body put failed'));
        }
        const { source: _s, ...rest } = row;
        const putMeta = metaStore.put(normalizeMeta(rest));
        putMeta.onerror = () =>
          fail(putMeta.error ?? new Error('migration meta put failed'));
      }
    } catch (err) {
      fail(err);
    }
  };
}

function wireDbLifecycle(db: IDBDatabase): void {
  // Let a newer PWA/tab raise the schema: release this connection on versionchange.
  db.onversionchange = () => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    if (dbPromise) dbPromise = null;
  };
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let settled = false;
    const failOpen = (err: unknown) => {
      if (settled) return;
      settled = true;
      dbPromise = null;
      reject(asError(err, 'IndexedDB open failed'));
    };
    const okOpen = (db: IDBDatabase) => {
      if (settled) return;
      settled = true;
      wireDbLifecycle(db);
      resolve(db);
    };

    if (typeof indexedDB === 'undefined') {
      failOpen(new Error('IndexedDB is unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, MANUSCRIPT_DB_VERSION);
    req.onerror = () => failOpen(req.error ?? new Error('IndexedDB open failed'));
    // Another tab/PWA client may hold an older version — wait for onsuccess/onerror.
    req.onblocked = () => {
      /* no-op */
    };
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const tx = req.transaction!;
      const oldVersion = event.oldVersion;
      tx.onabort = () => failOpen(tx.error ?? new Error('IndexedDB upgrade aborted'));

      if (!db.objectStoreNames.contains(META_STORE)) {
        const meta = db.createObjectStore(META_STORE, { keyPath: 'id' });
        meta.createIndex('byPubkey', 'pubkey');
      } else {
        const meta = tx.objectStore(META_STORE);
        if (!meta.indexNames.contains('byPubkey')) {
          meta.createIndex('byPubkey', 'pubkey');
        }
      }

      if (!db.objectStoreNames.contains(BODY_STORE)) {
        db.createObjectStore(BODY_STORE, { keyPath: 'id' });
      }

      // v1 inline source → bodies; v2 leftover source → strip; always normalize meta.
      if (oldVersion < MANUSCRIPT_DB_VERSION) {
        migrateMetaBodySplit(tx, (err) => {
          try {
            tx.abort();
          } catch {
            /* already aborting */
          }
          failOpen(err);
        });
      }
    };
    req.onsuccess = () => okOpen(req.result);
  });
  return dbPromise;
}

function idbBackend(): ManuscriptBackend {
  return {
    async listMeta(pubkey) {
      const pk = pubkey.toLowerCase();
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(META_STORE, 'readonly');
        const index = tx.objectStore(META_STORE).index('byPubkey');
        const req = index.getAll(IDBKeyRange.only(pk));
        req.onsuccess = () => {
          const rows = (req.result as PublicationManuscriptMeta[]).map(normalizeMeta);
          rows.sort((a, b) => b.updatedAt - a.updatedAt);
          resolve(rows);
        };
        req.onerror = () => reject(req.error ?? new Error('listMeta failed'));
      });
    },
    async get(id) {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([META_STORE, BODY_STORE], 'readonly');
        const metaReq = tx.objectStore(META_STORE).get(id);
        const bodyReq = tx.objectStore(BODY_STORE).get(id);
        tx.oncomplete = () => {
          const meta = metaReq.result as PublicationManuscriptMeta | undefined;
          const body = bodyReq.result as { id: string; source: string } | undefined;
          if (!meta) {
            resolve({ status: 'missing' });
            return;
          }
          if (!body || typeof body.source !== 'string') {
            resolve({ status: 'orphan', meta: normalizeMeta(meta) });
            return;
          }
          resolve({
            status: 'ok',
            manuscript: normalizeManuscript({ ...meta, source: body.source })
          });
        };
        tx.onerror = () => reject(tx.error ?? new Error('get failed'));
      });
    },
    async put(m) {
      const row = normalizeManuscript(m);
      if (!row.id) throw new Error('Manuscript id required');
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([META_STORE, BODY_STORE], 'readwrite');
        const { source, ...meta } = row;
        tx.objectStore(META_STORE).put(meta);
        tx.objectStore(BODY_STORE).put({ id: row.id, source });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('put failed'));
      });
    },
    async delete(id) {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([META_STORE, BODY_STORE], 'readwrite');
        tx.objectStore(META_STORE).delete(id);
        tx.objectStore(BODY_STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('delete failed'));
      });
    },
    async deleteForPubkey(pubkey) {
      const metas = await this.listMeta(pubkey);
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([META_STORE, BODY_STORE], 'readwrite');
        const metaStore = tx.objectStore(META_STORE);
        const bodyStore = tx.objectStore(BODY_STORE);
        for (const m of metas) {
          metaStore.delete(m.id);
          bodyStore.delete(m.id);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('deleteForPubkey failed'));
      });
    }
  };
}

function memoryBackend(): ManuscriptBackend {
  const metas = new Map<string, PublicationManuscriptMeta>();
  const bodies = new Map<string, string>();
  dropBodyForTests = (id) => {
    bodies.delete(id);
  };
  return {
    async listMeta(pubkey) {
      const pk = pubkey.toLowerCase();
      return [...metas.values()]
        .filter((m) => m.pubkey === pk)
        .map(normalizeMeta)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async get(id) {
      const meta = metas.get(id);
      if (!meta) return { status: 'missing' };
      if (!bodies.has(id)) return { status: 'orphan', meta: normalizeMeta(meta) };
      return {
        status: 'ok',
        manuscript: normalizeManuscript({ ...meta, source: bodies.get(id)! })
      };
    },
    async put(m) {
      const row = normalizeManuscript(m);
      const { source, ...meta } = row;
      metas.set(row.id, meta);
      bodies.set(row.id, source);
    },
    async delete(id) {
      metas.delete(id);
      bodies.delete(id);
    },
    async deleteForPubkey(pubkey) {
      const pk = pubkey.toLowerCase();
      for (const [id, m] of metas) {
        if (m.pubkey === pk) {
          metas.delete(id);
          bodies.delete(id);
        }
      }
    }
  };
}

function backend(): ManuscriptBackend {
  if (backendOverride) return backendOverride;
  if (typeof indexedDB === 'undefined') {
    backendOverride = memoryBackend();
    return backendOverride;
  }
  return idbBackend();
}

/** Test hook: swap in an isolated memory store. */
export function installMemoryManuscriptStoreForTests(): void {
  backendOverride = memoryBackend();
  staged = null;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

/** Test-only: remove body while keeping meta (simulates corrupt / mid-migrate row). */
export function dropManuscriptBodyForTests(id: string): void {
  dropBodyForTests?.(id);
}

export function failNextManuscriptPutForTests(err: Error): void {
  failNextPutForTests = err;
}

export function resetManuscriptStoreForTests(): void {
  backendOverride = null;
  dbPromise = null;
  staged = null;
  dropBodyForTests = null;
  failNextPutForTests = null;
  onFlushListeners.clear();
  onPersistErrorListeners.clear();
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

/** Warm the DB (runs pending migrations). Safe to call on app/PWA boot. */
export async function ensureManuscriptDb(): Promise<void> {
  if (backendOverride || typeof indexedDB === 'undefined') return;
  await openDb();
}

/** Subscribe to successful staged flushes (Compose refreshes the Drafts list). */
export function onManuscriptFlushed(listener: () => void): () => void {
  onFlushListeners.add(listener);
  return () => {
    onFlushListeners.delete(listener);
  };
}

/** Subscribe to persist failures (quota / IDB errors). */
export function onManuscriptPersistError(listener: (err: Error) => void): () => void {
  onPersistErrorListeners.add(listener);
  return () => {
    onPersistErrorListeners.delete(listener);
  };
}

function notifyFlushed(): void {
  for (const listener of onFlushListeners) {
    try {
      listener();
    } catch {
      /* ignore */
    }
  }
}

function notifyPersistError(err: Error): void {
  for (const listener of onPersistErrorListeners) {
    try {
      listener(err);
    } catch {
      /* ignore */
    }
  }
}

export async function listManuscriptMetas(pubkey: string): Promise<PublicationManuscriptMeta[]> {
  try {
    return await backend().listMeta(pubkey);
  } catch {
    return [];
  }
}

/** @deprecated Prefer listManuscriptMetas — kept for callers that expect full rows. */
export async function listManuscripts(pubkey: string): Promise<PublicationManuscript[]> {
  const metas = await listManuscriptMetas(pubkey);
  const out: PublicationManuscript[] = [];
  for (const meta of metas) {
    const full = await getManuscript(meta.id);
    if (full) out.push(full);
  }
  return out;
}

export async function getManuscriptResult(id: string): Promise<ManuscriptGetResult> {
  if (!id.trim()) return { status: 'missing' };
  try {
    return await backend().get(id.trim());
  } catch (err) {
    return { status: 'error', error: asError(err, 'Could not read manuscript') };
  }
}

export async function getManuscript(id: string): Promise<PublicationManuscript | null> {
  const result = await getManuscriptResult(id);
  return result.status === 'ok' ? result.manuscript : null;
}

export async function putManuscript(m: PublicationManuscript): Promise<void> {
  if (failNextPutForTests) {
    const err = failNextPutForTests;
    failNextPutForTests = null;
    throw err;
  }
  const row = normalizeManuscript({ ...m, updatedAt: m.updatedAt || Date.now() });
  await backend().put(row);
}

export async function deleteManuscript(id: string): Promise<void> {
  if (!id.trim()) return;
  if (staged?.id === id) clearStagedManuscript();
  try {
    await backend().delete(id.trim());
  } catch {
    /* ignore */
  }
}

export async function deleteManuscriptsForPubkey(pubkey: string): Promise<void> {
  if (staged && staged.pubkey === pubkey.toLowerCase()) clearStagedManuscript();
  try {
    await backend().deleteForPubkey(pubkey);
  } catch {
    /* ignore */
  }
}

export function stageManuscript(m: PublicationManuscript): void {
  staged = normalizeManuscript({ ...m, updatedAt: Date.now() });
  ensureFlushListeners();
}

export function clearStagedManuscript(): void {
  staged = null;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

export async function flushStagedManuscript(): Promise<void> {
  if (!staged) return;
  if (!staged.source.trim()) return;
  const snap = staged;
  try {
    await putManuscript(snap);
    notifyFlushed();
  } catch (err) {
    notifyPersistError(asError(err, 'Could not save manuscript'));
  }
}

/**
 * Debounced persist of the live manuscript. Call from Compose when split source changes.
 */
export function scheduleManuscriptPersist(
  m: PublicationManuscript,
  debounceMs = 800
): void {
  stageManuscript(m);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void flushStagedManuscript();
  }, debounceMs);
}

function ensureFlushListeners(): void {
  if (flushListenersInstalled) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  flushListenersInstalled = true;
  const flush = () => {
    void flushStagedManuscript();
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

/**
 * True when a tab autosave is only the thin shell for this manuscript.
 * Match by manuscript id only — d-tag alone is too weak (shared / reused d).
 */
export function localDraftMatchesManuscript(
  local: {
    kind: number;
    publicationManuscriptId?: string;
  },
  manuscript: Pick<PublicationManuscriptMeta, 'id'>
): boolean {
  if (local.kind !== 30040) return false;
  const mid = String(local.publicationManuscriptId ?? '').trim();
  return Boolean(mid && mid === manuscript.id);
}
