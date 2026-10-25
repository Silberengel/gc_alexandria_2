import { writable } from 'svelte/store';

const STORAGE_KEY = 'alexandria-live-chat-shield';

function load(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function createLiveChatShieldStore() {
  let current = load();
  const { subscribe, set } = writable(current);

  function commit(on: boolean): void {
    current = !!on;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, current ? 'true' : 'false');
      } catch {
        /* private mode */
      }
    }
    set(current);
  }

  return {
    subscribe,
    get(): boolean {
      return current;
    },
    set(on: boolean): void {
      commit(on);
    },
    toggle(): void {
      commit(!current);
    },
    reset(): void {
      commit(false);
    }
  };
}

/** Per-viewer live-chat Shield — default off (wide open). */
export const liveChatShield = createLiveChatShieldStore();
