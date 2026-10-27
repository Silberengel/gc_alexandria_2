import { get, writable } from 'svelte/store';
import {
  BUILTIN_FEED_TABS,
  DEFAULT_FEED_TAB_ORDER,
  isFeedTab,
  type FeedTab
} from '$lib/feed';

const STORAGE_KEY = 'alexandria-feed-tab-order';

/** Keep every built-in tab once; keep valid kind tabs; drop junk. */
export function normalizeFeedTabOrder(raw: unknown): FeedTab[] {
  const seen = new Set<string>();
  const out: FeedTab[] = [];
  const list = Array.isArray(raw) ? raw : [];
  for (const entry of list) {
    if (typeof entry !== 'string' || !isFeedTab(entry) || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  for (const tab of BUILTIN_FEED_TABS) {
    if (seen.has(tab)) continue;
    seen.add(tab);
    out.push(tab);
  }
  return out.length ? out : [...DEFAULT_FEED_TAB_ORDER];
}

function read(): FeedTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_FEED_TAB_ORDER];
    return normalizeFeedTabOrder(JSON.parse(raw));
  } catch {
    return [...DEFAULT_FEED_TAB_ORDER];
  }
}

function createFeedTabOrderStore() {
  const initial =
    typeof localStorage !== 'undefined' ? read() : ([...DEFAULT_FEED_TAB_ORDER] as FeedTab[]);
  const store = writable<FeedTab[]>(initial);

  function persist(next: FeedTab[]): void {
    const normalized = normalizeFeedTabOrder(next);
    store.set(normalized);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      /* quota / private mode */
    }
  }

  return {
    subscribe: store.subscribe,
    get(): FeedTab[] {
      return get(store);
    },
    set(next: FeedTab[]) {
      persist(next);
    },
    reorder(from: number, to: number): void {
      const cur = get(store);
      if (from === to || from < 0 || to < 0 || from >= cur.length || to >= cur.length) return;
      const next = cur.slice();
      const [item] = next.splice(from, 1);
      if (!item) return;
      next.splice(to, 0, item);
      persist(next);
    },
    addKind(kind: number): FeedTab | null {
      if (!Number.isInteger(kind) || kind < 0) return null;
      const tab = `kind:${kind}` as FeedTab;
      const cur = get(store);
      if (cur.includes(tab)) return tab;
      persist([...cur, tab]);
      return tab;
    },
    remove(tab: FeedTab): void {
      if (BUILTIN_FEED_TABS.includes(tab as (typeof BUILTIN_FEED_TABS)[number])) return;
      persist(get(store).filter((t) => t !== tab));
    }
  };
}

export const feedTabOrder = createFeedTabOrderStore();
