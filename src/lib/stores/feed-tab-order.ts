import { get, writable } from 'svelte/store';
import {
  CORE_FEED_TABS,
  DEFAULT_FEED_TAB_ORDER,
  encodeKindFeedTab,
  isCoreFeedTab,
  isFeedTab,
  isKindFeedTab,
  isOptionalBuiltinFeedTab,
  isRemovableFeedTab,
  normalizeFeedTabCustomName,
  type FeedTab,
  type OptionalBuiltinFeedTab
} from '$lib/feed';

const STORAGE_KEY = 'alexandria-feed-tab-order';
const LABELS_KEY = 'alexandria-feed-tab-labels';

/**
 * Keep Follows / Notifications once; keep optional built-ins and kind tabs the
 * user still has; drop junk. Original Posts / Replies stay absent when removed.
 */
export function normalizeFeedTabOrder(raw: unknown): FeedTab[] {
  const seen = new Set<string>();
  const out: FeedTab[] = [];
  const list = Array.isArray(raw) ? raw : [];
  for (const entry of list) {
    if (typeof entry !== 'string' || !isFeedTab(entry) || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  for (const tab of CORE_FEED_TABS) {
    if (seen.has(tab)) continue;
    seen.add(tab);
    out.push(tab);
  }
  return out.length ? out : [...DEFAULT_FEED_TAB_ORDER];
}

/**
 * Custom names for kind tabs only; drop empty / non-kind keys.
 * When `order` is passed, drop labels for tabs no longer in the strip.
 */
export function normalizeFeedTabLabels(
  raw: unknown,
  order?: readonly FeedTab[]
): Record<string, string> {
  const allowed = order ? new Set(order.filter(isKindFeedTab)) : null;
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isKindFeedTab(key)) continue;
    if (allowed && !allowed.has(key)) continue;
    const name = normalizeFeedTabCustomName(typeof value === 'string' ? value : null);
    if (!name) continue;
    out[key] = name;
  }
  return out;
}

function readOrder(): FeedTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_FEED_TAB_ORDER];
    return normalizeFeedTabOrder(JSON.parse(raw));
  } catch {
    return [...DEFAULT_FEED_TAB_ORDER];
  }
}

function readLabels(order: readonly FeedTab[]): Record<string, string> {
  try {
    const raw = localStorage.getItem(LABELS_KEY);
    if (!raw) return {};
    return normalizeFeedTabLabels(JSON.parse(raw), order);
  } catch {
    return {};
  }
}

function createFeedTabOrderStore() {
  const initialOrder =
    typeof localStorage !== 'undefined' ? readOrder() : ([...DEFAULT_FEED_TAB_ORDER] as FeedTab[]);
  const initialLabels =
    typeof localStorage !== 'undefined' ? readLabels(initialOrder) : ({} as Record<string, string>);
  const store = writable<FeedTab[]>(initialOrder);
  const labelsStore = writable<Record<string, string>>(initialLabels);

  function persistOrder(next: FeedTab[]): FeedTab[] {
    const normalized = normalizeFeedTabOrder(next);
    store.set(normalized);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      /* quota / private mode */
    }
    return normalized;
  }

  function persistLabels(next: Record<string, string>, order: readonly FeedTab[]): Record<string, string> {
    const normalized = normalizeFeedTabLabels(next, order);
    labelsStore.set(normalized);
    try {
      localStorage.setItem(LABELS_KEY, JSON.stringify(normalized));
    } catch {
      /* quota / private mode */
    }
    return normalized;
  }

  function setLabel(tab: FeedTab, name: string | null | undefined, order: readonly FeedTab[]): void {
    if (!isKindFeedTab(tab)) return;
    const cur = { ...get(labelsStore) };
    const normalized = normalizeFeedTabCustomName(name);
    if (normalized) cur[tab] = normalized;
    else delete cur[tab];
    persistLabels(cur, order);
  }

  return {
    subscribe: store.subscribe,
    /** Custom names keyed by kind-tab id. */
    labels: {
      subscribe: labelsStore.subscribe,
      get(): Record<string, string> {
        return get(labelsStore);
      }
    },
    get(): FeedTab[] {
      return get(store);
    },
    set(next: FeedTab[]) {
      const order = persistOrder(next);
      persistLabels(get(labelsStore), order);
    },
    reorder(from: number, to: number): void {
      const cur = get(store);
      if (from === to || from < 0 || to < 0 || from >= cur.length || to >= cur.length) return;
      const next = cur.slice();
      const [item] = next.splice(from, 1);
      if (!item) return;
      next.splice(to, 0, item);
      persistOrder(next);
    },
    addKind(kind: number, name?: string | null): FeedTab | null {
      return this.addKinds([kind], name);
    },
    addKinds(kinds: readonly number[], name?: string | null): FeedTab | null {
      const tab = encodeKindFeedTab(kinds);
      if (!tab) return null;
      const cur = get(store);
      const order = cur.includes(tab) ? cur : persistOrder([...cur, tab]);
      setLabel(tab, name, order);
      return tab;
    },
    /** Put Original Posts / Replies back on the strip after the user removed them. */
    addOptionalBuiltin(tab: OptionalBuiltinFeedTab): FeedTab | null {
      if (!isOptionalBuiltinFeedTab(tab)) return null;
      const cur = get(store);
      if (cur.includes(tab)) return tab;
      return persistOrder([...cur, tab]).includes(tab) ? tab : null;
    },
    setTabName(tab: FeedTab, name: string | null | undefined): void {
      setLabel(tab, name, get(store));
    },
    remove(tab: FeedTab): void {
      if (!isRemovableFeedTab(tab) || isCoreFeedTab(tab)) return;
      const order = persistOrder(get(store).filter((t) => t !== tab));
      persistLabels(get(labelsStore), order);
    }
  };
}

export const feedTabOrder = createFeedTabOrderStore();
