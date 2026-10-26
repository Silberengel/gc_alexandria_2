import { composerFieldSpecs, isCatalogued } from '@silberengel/kind-compose-catalog';
import { isKind0TagRowsEmpty } from './compose-kind0';

export type ComposeDraftState = {
  kind: number;
  content: string;
  values: Record<string, string>;
  hashtags: string[];
  imetaTags: string[][];
  freeformTags: string[][];
  /** Kind-0 profile editor rows (JSON + tag mirrors). */
  kind0Tags?: string[][];
  /** Advanced-editor markup, when the kind has a Djot or AsciiDoc body. */
  markup?: 'djot' | 'asciidoc' | null;
  updatedAt: number;
};

const KEY_PREFIX = 'alexandria:compose-draft:';

/** Latest form snapshot; survives Svelte teardown so Vite HMR can still flush. */
let stagedDraft: { pubkey: string; draft: ComposeDraftState } | null = null;
let flushListenersInstalled = false;

function baselineValuesForKind(kind: number): Record<string, string> {
  if (!isCatalogued(kind)) return {};
  const out: Record<string, string> = {};
  for (const f of composerFieldSpecs(kind)) {
    out[f.id] = f.default != null ? String(f.default) : '';
  }
  return out;
}

export function draftStorageKey(
  pubkey: string,
  kind: number,
  mode = 'compose',
): string {
  return `${KEY_PREFIX}${pubkey.toLowerCase()}:${mode}:${kind}`;
}

function storage(): Storage | null {
  try {
    const store = globalThis.sessionStorage;
    return store ?? null;
  } catch {
    return null;
  }
}

export function loadComposeDraft(
  pubkey: string,
  kind: number,
  mode?: string,
): ComposeDraftState | null {
  const store = storage();
  if (!store) return null;
  const raw = store.getItem(draftStorageKey(pubkey, kind, mode));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ComposeDraftState;
    if (parsed && typeof parsed === 'object' && typeof parsed.kind === 'number') {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * True when the draft has no user-entered content beyond optional catalog
 * baseline defaults (e.g. publication_type=book).
 */
export function isComposeDraftEmpty(
  draft: Pick<
    ComposeDraftState,
    'content' | 'values' | 'hashtags' | 'imetaTags' | 'freeformTags' | 'kind0Tags'
  >,
  baselineValues: Record<string, string> = {},
): boolean {
  if (draft.content.trim()) return false;
  if (draft.hashtags.some((h) => h.trim())) return false;
  if (
    draft.imetaTags.some(
      (t) => t.length > 0 && t.some((c) => String(c).trim().length > 0),
    )
  ) {
    return false;
  }
  if (draft.freeformTags.some((row) => row.some((c) => String(c).trim()))) {
    return false;
  }
  if (draft.kind0Tags?.length && !isKind0TagRowsEmpty(draft.kind0Tags)) {
    return false;
  }
  for (const [id, raw] of Object.entries(draft.values)) {
    const v = String(raw ?? '').trim();
    if (!v) continue;
    const base = String(baselineValues[id] ?? '').trim();
    if (v !== base) return false;
  }
  return true;
}

export function saveComposeDraft(
  pubkey: string,
  draft: ComposeDraftState,
  mode?: string,
): void {
  const store = storage();
  if (!store) return;
  store.setItem(
    draftStorageKey(pubkey, draft.kind, mode),
    JSON.stringify({ ...draft, updatedAt: draft.updatedAt || Date.now() }),
  );
}

export function deleteComposeDraft(
  pubkey: string,
  kind: number,
  mode?: string,
): void {
  const store = storage();
  if (!store) return;
  store.removeItem(draftStorageKey(pubkey, kind, mode));
  if (
    stagedDraft &&
    stagedDraft.pubkey.toLowerCase() === pubkey.toLowerCase() &&
    stagedDraft.draft.kind === kind
  ) {
    stagedDraft = null;
  }
}

/**
 * Keep a module-level copy of the live form. Component debounce cleanup and
 * pagehide listeners can drop on HMR; this staged value still flushes.
 */
export function stageComposeDraft(
  pubkey: string,
  draft: ComposeDraftState,
): void {
  stagedDraft = { pubkey, draft };
  ensureDraftFlushListeners();
}

/** Write the staged draft to sessionStorage. Empty shells are skipped (not deleted). */
export function flushStagedComposeDraft(): void {
  if (!stagedDraft) return;
  const { pubkey, draft } = stagedDraft;
  if (isComposeDraftEmpty(draft, baselineValuesForKind(draft.kind))) return;
  saveComposeDraft(pubkey, draft);
}

function ensureDraftFlushListeners(): void {
  if (flushListenersInstalled) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  flushListenersInstalled = true;
  const flush = () => flushStagedComposeDraft();
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

export function listComposeDrafts(
  pubkey: string,
): Array<{ kind: number; mode: string; updatedAt: number }> {
  const store = storage();
  if (!store) return [];
  const pk = pubkey.toLowerCase();
  const needle = `${KEY_PREFIX}${pk}:`;
  const out: Array<{ kind: number; mode: string; updatedAt: number }> = [];

  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key?.startsWith(needle)) keys.push(key);
  }
  for (const key of keys) {
    const rest = key.slice(needle.length);
    const lastColon = rest.lastIndexOf(':');
    if (lastColon <= 0) continue;
    const mode = rest.slice(0, lastColon);
    const kind = Number(rest.slice(lastColon + 1));
    if (!Number.isFinite(kind)) continue;
    const draft = loadComposeDraft(pubkey, kind, mode);
    if (!draft || isComposeDraftEmpty(draft, baselineValuesForKind(kind))) {
      // Drop legacy empty shells so the list stays meaningful.
      store.removeItem(key);
      continue;
    }
    out.push({
      kind,
      mode,
      updatedAt: draft.updatedAt ?? 0,
    });
  }

  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * True when a tab autosave is the working copy of an encrypted wrap: same kind and
 * matching `d` (wrap id, or the inner draft's d-tag), or same body when both lack a d.
 */
export function localDraftMatchesEncrypted(
  local: Pick<ComposeDraftState, 'kind' | 'content' | 'values'>,
  wrap: {
    draftKind: number;
    d: string;
    draft: { content: string; tags: string[][] } | null;
  }
): boolean {
  if (local.kind !== wrap.draftKind) return false;
  const localD = String(local.values.d ?? '').trim();
  const wrapD = String(wrap.d ?? '').trim();
  if (localD || wrapD) {
    if (localD && wrapD && localD === wrapD) return true;
    const innerD =
      wrap.draft?.tags.find((t) => t[0] === 'd')?.[1]?.trim() ?? '';
    if (localD && innerD && localD === innerD) return true;
    return false;
  }
  if (!wrap.draft) return false;
  return local.content.trim() === wrap.draft.content.trim();
}

export function clearComposeDraftsForPubkey(pubkey: string): void {
  const store = storage();
  if (!store) return;
  const pk = pubkey.toLowerCase();
  const needle = `${KEY_PREFIX}${pk}:`;
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key?.startsWith(needle)) keys.push(key);
  }
  for (const key of keys) store.removeItem(key);
}
