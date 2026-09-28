import { get, writable } from 'svelte/store';

export type MediaViewerState = {
  open: boolean;
  url: string;
  title: string;
  /** Optional in-app hash path (e.g. publication). */
  href?: string;
};

const empty: MediaViewerState = {
  open: false,
  url: '',
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

export function openMediaViewer(opts: { url: string; title?: string; href?: string }): void {
  const url = opts.url.trim();
  if (!url) return;
  ensurePopStateListener();
  const alreadyOpen = get(mediaViewer).open;
  mediaViewer.set({
    open: true,
    url,
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
