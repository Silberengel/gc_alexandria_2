import { writable } from 'svelte/store';
import {
  READING_CONCURRENT_DEFAULT,
  READING_CONCURRENT_MAX,
  READING_CONCURRENT_MIN
} from '$lib/constants';

const STORAGE_KEY = 'alexandria-reading-prefs';

export type ReadingPrefsState = {
  /** How many queue books are in the active concurrent subset. */
  concurrent: number;
};

const defaults: ReadingPrefsState = {
  concurrent: READING_CONCURRENT_DEFAULT
};

export function clampConcurrent(n: number): number {
  if (!Number.isFinite(n)) return READING_CONCURRENT_DEFAULT;
  return Math.min(READING_CONCURRENT_MAX, Math.max(READING_CONCURRENT_MIN, Math.round(n)));
}

function load(): ReadingPrefsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw) as Partial<ReadingPrefsState>;
    return { concurrent: clampConcurrent(Number(parsed.concurrent)) };
  } catch {
    return { ...defaults };
  }
}

function createReadingPrefsStore() {
  const initial = typeof localStorage !== 'undefined' ? load() : { ...defaults };
  const { subscribe, set, update } = writable<ReadingPrefsState>(initial);

  function persist(state: ReadingPrefsState): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  }

  return {
    subscribe,
    setConcurrent(n: number): void {
      update((s) => {
        const next = { ...s, concurrent: clampConcurrent(n) };
        persist(next);
        return next;
      });
    },
    reset(): void {
      const next = { ...defaults };
      persist(next);
      set(next);
    }
  };
}

export const readingPrefs = createReadingPrefsStore();
