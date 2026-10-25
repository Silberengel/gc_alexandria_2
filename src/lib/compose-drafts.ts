export type ComposeDraftState = {
  kind: number;
  content: string;
  values: Record<string, string>;
  hashtags: string[];
  imetaTags: string[][];
  freeformTags: string[][];
  updatedAt: number;
};

const KEY_PREFIX = 'alexandria:compose-draft:';

export function draftStorageKey(
  pubkey: string,
  kind: number,
  mode = 'compose',
): string {
  return `${KEY_PREFIX}${pubkey.toLowerCase()}:${mode}:${kind}`;
}

function storage(): Storage | null {
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage;
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
}

export function listComposeDrafts(
  pubkey: string,
): Array<{ kind: number; mode: string; updatedAt: number }> {
  const store = storage();
  if (!store) return [];
  const pk = pubkey.toLowerCase();
  const needle = `${KEY_PREFIX}${pk}:`;
  const out: Array<{ kind: number; mode: string; updatedAt: number }> = [];

  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key?.startsWith(needle)) continue;
    const rest = key.slice(needle.length);
    const lastColon = rest.lastIndexOf(':');
    if (lastColon <= 0) continue;
    const mode = rest.slice(0, lastColon);
    const kind = Number(rest.slice(lastColon + 1));
    if (!Number.isFinite(kind)) continue;
    const draft = loadComposeDraft(pubkey, kind, mode);
    out.push({
      kind,
      mode,
      updatedAt: draft?.updatedAt ?? 0,
    });
  }

  return out.sort((a, b) => b.updatedAt - a.updatedAt);
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
