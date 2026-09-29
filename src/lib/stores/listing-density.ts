import { get, writable } from 'svelte/store';

/** Full = detailed cards / cover shelves; table = sortable text table. */
export type ListingDensity = 'full' | 'table';

const STORAGE_KEY = 'alexandria-listing-density';

/** Normalize a stored preference (legacy `list` compact-grid → full). */
export function parseStoredListingDensity(raw: string | null): ListingDensity {
  if (raw === 'table') return 'table';
  return 'full';
}

function read(): ListingDensity {
  try {
    return parseStoredListingDensity(localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'full';
  }
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
      const order: ListingDensity[] = ['full', 'table'];
      const cur = get(store);
      persist(order[(order.indexOf(cur) + 1) % order.length]!);
    }
  };
}

export const listingDensity = createListingDensityStore();
