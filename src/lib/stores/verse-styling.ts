import { get, writable } from 'svelte/store';

const STORAGE_KEY = 'alexandria-verse-styling';

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function createVerseStylingStore() {
  const initial = typeof localStorage !== 'undefined' ? read() : false;
  const store = writable(initial);

  function persist(next: boolean): void {
    store.set(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      /* quota / private mode */
    }
  }

  return {
    subscribe: store.subscribe,
    set(next: boolean) {
      persist(next);
    },
    toggle() {
      persist(!get(store));
    }
  };
}

/** Compact bible prose (superscripts). Default off — normal section cards. */
export const verseStyling = createVerseStylingStore();
