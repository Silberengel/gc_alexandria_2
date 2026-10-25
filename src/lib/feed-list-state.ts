import type { Event } from 'nostr-tools';
import type { FeedTab } from './feed';

/** Survives `/feed` ↔ `/feed/:id` remounts so Return lands on the opened card. */
export type FeedListSnapshot = {
  tab: FeedTab;
  items: Event[];
  shown: Record<string, true>;
  boostExcerpts: Record<string, string>;
  scrollY: number;
  /** Feed row that was opened — restore scrolls this card into view. */
  focusId: string | null;
  listSettled: boolean;
};

const STORAGE_KEY = 'alexandria-feed-list-restore';

let snapshot: FeedListSnapshot | null = null;
/** True after leaving the list for a thread until the list consumes the snapshot. */
let pendingRestore = false;

function persist(): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (!pendingRestore || !snapshot) {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        pendingRestore: true,
        tab: snapshot.tab,
        focusId: snapshot.focusId,
        scrollY: snapshot.scrollY,
        listSettled: snapshot.listSettled,
        shown: snapshot.shown,
        boostExcerpts: snapshot.boostExcerpts,
        items: snapshot.items
      })
    );
  } catch {
    /* private mode / quota */
  }
}

function hydrateFromSession(): void {
  if (snapshot) return;
  try {
    if (typeof sessionStorage === 'undefined') return;
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<FeedListSnapshot> & { pendingRestore?: boolean };
    if (!parsed || !Array.isArray(parsed.items) || !parsed.tab) return;
    snapshot = {
      tab: parsed.tab as FeedTab,
      items: parsed.items as Event[],
      shown: (parsed.shown as Record<string, true>) ?? {},
      boostExcerpts: (parsed.boostExcerpts as Record<string, string>) ?? {},
      scrollY: typeof parsed.scrollY === 'number' ? parsed.scrollY : 0,
      focusId: typeof parsed.focusId === 'string' ? parsed.focusId.toLowerCase() : null,
      listSettled: !!parsed.listSettled
    };
    pendingRestore = parsed.pendingRestore !== false;
  } catch {
    /* ignore */
  }
}

export function saveFeedListState(next: FeedListSnapshot): void {
  snapshot = {
    tab: next.tab,
    items: next.items.slice(),
    shown: { ...next.shown },
    boostExcerpts: { ...next.boostExcerpts },
    scrollY: Math.max(0, next.scrollY),
    focusId: next.focusId ? next.focusId.toLowerCase() : null,
    listSettled: next.listSettled
  };
  pendingRestore = true;
  persist();
}

/** Snapshot for hydrating the list after Return — one-shot. */
export function takeFeedListRestore(): FeedListSnapshot | null {
  hydrateFromSession();
  if (!pendingRestore || !snapshot) return null;
  pendingRestore = false;
  persist();
  return snapshot;
}

export function peekFeedListState(): FeedListSnapshot | null {
  hydrateFromSession();
  return snapshot;
}

export function clearFeedListRestore(): void {
  pendingRestore = false;
  persist();
}

/** Re-arm a saved snapshot so Return can restore again. */
export function rearmFeedListRestore(): boolean {
  hydrateFromSession();
  if (!snapshot) return false;
  pendingRestore = true;
  persist();
  return true;
}

export function discardFeedListState(): void {
  snapshot = null;
  pendingRestore = false;
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function feedListPathHasPendingRestore(): boolean {
  hydrateFromSession();
  return pendingRestore && !!snapshot;
}
