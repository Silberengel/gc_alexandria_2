/** Local autosave for comment/reply drafts (text + drawing imeta). */

import { compressBackgroundDataUrl } from './drawing/compress';

export type ThreadDraftState = {
  text: string;
  imetaTags: string[][];
  asKind1Reply: boolean;
  updatedAt: number;
};

export type DrawingDraftState = {
  strokes: unknown[];
  paperId: string;
  mirror: boolean;
  labelText?: string;
  fontId?: string;
  color?: string;
  width?: number;
  tool?: string;
  /** Compressed JPEG/WebP data URL for an uploaded background (optional). */
  backgroundDataUrl?: string;
  backgroundName?: string;
  updatedAt: number;
};

/** Rough sessionStorage budget for one drawing draft payload. */
export const DRAWING_DRAFT_BG_MAX_CHARS = 1_200_000;

const THREAD_PREFIX = 'alexandria:thread-draft:';
const DRAW_PREFIX = 'alexandria:drawing-draft:';

function storage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function threadDraftStorageKey(pubkey: string, scope: string): string {
  return `${THREAD_PREFIX}${pubkey.toLowerCase()}:${scope}`;
}

export function drawingDraftStorageKey(pubkey: string, scope: string): string {
  return `${DRAW_PREFIX}${pubkey.toLowerCase()}:${scope}`;
}

export function isThreadDraftEmpty(
  draft: Pick<ThreadDraftState, 'text' | 'imetaTags'>
): boolean {
  if (draft.text.trim()) return false;
  return !draft.imetaTags.some(
    (row) => Array.isArray(row) && row.some((c) => String(c ?? '').trim())
  );
}

export function loadThreadDraft(pubkey: string, scope: string): ThreadDraftState | null {
  const store = storage();
  if (!store || !pubkey || !scope) return null;
  const raw = store.getItem(threadDraftStorageKey(pubkey, scope));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ThreadDraftState;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      imetaTags: Array.isArray(parsed.imetaTags)
        ? parsed.imetaTags.filter((row) => Array.isArray(row)).map((row) => row.map(String))
        : [],
      asKind1Reply: !!parsed.asKind1Reply,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0
    };
  } catch {
    return null;
  }
}

export function saveThreadDraft(
  pubkey: string,
  scope: string,
  draft: Omit<ThreadDraftState, 'updatedAt'> & { updatedAt?: number }
): void {
  const store = storage();
  if (!store || !pubkey || !scope) return;
  if (isThreadDraftEmpty(draft)) {
    store.removeItem(threadDraftStorageKey(pubkey, scope));
    return;
  }
  const toStore: ThreadDraftState = {
    text: draft.text,
    imetaTags: draft.imetaTags.map((row) => [...row]),
    asKind1Reply: !!draft.asKind1Reply,
    updatedAt: draft.updatedAt || Date.now()
  };
  store.setItem(threadDraftStorageKey(pubkey, scope), JSON.stringify(toStore));
}

export function deleteThreadDraft(pubkey: string, scope: string): void {
  const store = storage();
  if (!store || !pubkey || !scope) return;
  store.removeItem(threadDraftStorageKey(pubkey, scope));
}

export function isDrawingDraftEmpty(
  draft: Pick<DrawingDraftState, 'strokes' | 'backgroundDataUrl'>
): boolean {
  if (draft.strokes.length) return false;
  return !draft.backgroundDataUrl?.startsWith('data:');
}

export function loadDrawingDraft(pubkey: string, scope: string): DrawingDraftState | null {
  const store = storage();
  if (!store || !pubkey || !scope) return null;
  const raw = store.getItem(drawingDraftStorageKey(pubkey, scope));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DrawingDraftState;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.strokes)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDrawingDraft(
  pubkey: string,
  scope: string,
  draft: Omit<DrawingDraftState, 'updatedAt'> & { updatedAt?: number }
): void {
  const store = storage();
  if (!store || !pubkey || !scope) return;
  if (isDrawingDraftEmpty(draft)) {
    store.removeItem(drawingDraftStorageKey(pubkey, scope));
    return;
  }
  const toStore: DrawingDraftState = {
    ...draft,
    strokes: draft.strokes,
    updatedAt: draft.updatedAt || Date.now()
  };
  if (toStore.backgroundDataUrl && toStore.backgroundDataUrl.length > DRAWING_DRAFT_BG_MAX_CHARS) {
    delete toStore.backgroundDataUrl;
    delete toStore.backgroundName;
  }
  try {
    store.setItem(drawingDraftStorageKey(pubkey, scope), JSON.stringify(toStore));
  } catch {
    /* quota — retry without background, then drop */
    try {
      if (toStore.backgroundDataUrl) {
        const { backgroundDataUrl: _bg, backgroundName: _name, ...rest } = toStore;
        store.setItem(drawingDraftStorageKey(pubkey, scope), JSON.stringify(rest));
        return;
      }
      store.removeItem(drawingDraftStorageKey(pubkey, scope));
    } catch {
      try {
        store.removeItem(drawingDraftStorageKey(pubkey, scope));
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Downscale + JPEG-compress a background for sessionStorage drafts.
 * Returns null if the image cannot be encoded within the size budget.
 */
export function compressBackgroundForDraft(
  img: CanvasImageSource & { width: number; height: number },
  opts?: { maxEdge?: number; maxChars?: number }
): string | null {
  return compressBackgroundDataUrl(img, {
    maxEdge: opts?.maxEdge,
    maxChars: opts?.maxChars ?? DRAWING_DRAFT_BG_MAX_CHARS
  });
}

export function deleteDrawingDraft(pubkey: string, scope: string): void {
  const store = storage();
  if (!store || !pubkey || !scope) return;
  store.removeItem(drawingDraftStorageKey(pubkey, scope));
}

/** Stable short scope token from a quote (ink notes). */
export function quoteDraftScope(quote: string): string {
  const normalized = quote.replace(/\s+/g, ' ').trim().slice(0, 160);
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function clearThreadDraftsForPubkey(pubkey: string): void {
  const store = storage();
  if (!store) return;
  const pk = pubkey.toLowerCase();
  const needles = [`${THREAD_PREFIX}${pk}:`, `${DRAW_PREFIX}${pk}:`];
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key && needles.some((n) => key.startsWith(n))) keys.push(key);
  }
  for (const key of keys) store.removeItem(key);
}
