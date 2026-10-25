import { get, writable } from 'svelte/store';

export type MediaViewerState = {
  open: boolean;
  /** Current slide URL (same as `urls[index]` when open). */
  url: string;
  /** Full gallery; length 1 for a single image. */
  urls: string[];
  index: number;
  title: string;
  /** Optional in-app hash path (e.g. publication). */
  href?: string;
};

const empty: MediaViewerState = {
  open: false,
  url: '',
  urls: [],
  index: 0,
  title: ''
};

export const mediaViewer = writable<MediaViewerState>({ ...empty });

/** True after we pushed a history entry for the open viewer. */
let historyPushed = false;

function onPopState(): void {
  if (!get(mediaViewer).open) return;
  historyPushed = false;
  mediaViewer.set({ ...empty });
}

let listening = false;
function ensurePopStateListener(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('popstate', onPopState);
}

function normalizeUrls(urls: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const url = raw.trim();
    if (!url) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

export function openMediaViewer(opts: {
  url?: string;
  /** When provided (and length > 1), the viewer becomes a slideshow. */
  urls?: string[];
  /** Starting index into `urls` (or into `[url]`). */
  index?: number;
  title?: string;
  href?: string;
}): void {
  const primary = (opts.url ?? '').trim();
  const list = normalizeUrls(
    opts.urls?.length ? opts.urls : primary ? [primary] : []
  );
  if (!list.length) return;

  let index = 0;
  if (typeof opts.index === 'number' && Number.isFinite(opts.index)) {
    index = Math.max(0, Math.min(list.length - 1, Math.floor(opts.index)));
  } else if (primary) {
    const hit = list.findIndex((u) => u.toLowerCase() === primary.toLowerCase());
    if (hit >= 0) index = hit;
  }

  ensurePopStateListener();
  const alreadyOpen = get(mediaViewer).open;
  mediaViewer.set({
    open: true,
    urls: list,
    index,
    url: list[index]!,
    title: (opts.title ?? '').trim(),
    href: opts.href?.trim() || undefined
  });
  // Keep the previous history entry so Close / Back restores the same page.
  if (!alreadyOpen && !historyPushed) {
    try {
      history.pushState({ alexandriaMediaViewer: true }, '');
      historyPushed = true;
    } catch {
      historyPushed = false;
    }
  }
}

/** Move ±1 in the open gallery (wraps). No-op for a single image. */
export function stepMediaViewer(delta: number): void {
  const cur = get(mediaViewer);
  if (!cur.open || cur.urls.length < 2 || !delta) return;
  const len = cur.urls.length;
  const next = ((cur.index + delta) % len + len) % len;
  const url = cur.urls[next];
  if (!url) return;
  mediaViewer.set({ ...cur, index: next, url });
}

export function closeMediaViewer(): void {
  if (!get(mediaViewer).open) return;
  mediaViewer.set({ ...empty });
  if (historyPushed) {
    historyPushed = false;
    try {
      history.back();
    } catch {
      /* ignore */
    }
  }
}
