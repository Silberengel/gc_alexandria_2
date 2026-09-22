import { get, writable } from 'svelte/store';

/** Full = detailed cards / cover shelves; list = compact grid; table = sortable text table. */
export type ListingDensity = 'full' | 'list' | 'table';

const STORAGE_KEY = 'alexandria-listing-density';

function read(): ListingDensity {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'list' || raw === 'table') return raw;
  } catch {
    /* ignore */
  }
  return 'full';
}

function createListingDensityStore() {
  const initial = typeof localStorage !== 'undefined' ? read() : ('full' as ListingDensity);
  const store = writable<ListingDensity>(initial);

  function persist(next: ListingDensity): void {
    store.set(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* quota / private mode */
    }
  }

  return {
    subscribe: store.subscribe,
    set(next: ListingDensity) {
      persist(next);
    },
    toggle() {
      const order: ListingDensity[] = ['full', 'list', 'table'];
      const cur = get(store);
      persist(order[(order.indexOf(cur) + 1) % order.length]!);
    }
  };
}

export const listingDensity = createListingDensityStore();
