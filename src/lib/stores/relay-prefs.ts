import { writable } from 'svelte/store';

const STORAGE_KEY = 'alexandria-relay-prefs';

export type RelayPrefsState = {
  /** Shipped library / social / profile relays. Default on. */
  gitcitadel: boolean;
  /**
   * Other people's relays (their outboxes and inboxes, tag hints, public social relays).
   * Default on. Off means a signed-in session never dials a relay that is not the
   * viewer's own list or, when enabled, GitCitadel's.
   */
  outboxes: boolean;
};

const defaults: RelayPrefsState = {
  gitcitadel: true,
  outboxes: true
};

function load(): RelayPrefsState {
  if (typeof localStorage === 'undefined') return { ...defaults };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw) as Partial<RelayPrefsState>;
    return {
      gitcitadel: parsed.gitcitadel !== false,
      outboxes: parsed.outboxes !== false
    };
  } catch {
    return { ...defaults };
  }
}

function createRelayPrefsStore() {
  let current = load();
  const { subscribe, set } = writable<RelayPrefsState>(current);

  function commit(next: RelayPrefsState): void {
    current = next;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* private mode */
      }
    }
    set(next);
  }

  return {
    subscribe,
    get(): RelayPrefsState {
      return current;
    },
    setGitcitadel(on: boolean): void {
      commit({ ...current, gitcitadel: !!on });
    },
    setOutboxes(on: boolean): void {
      commit({ ...current, outboxes: !!on });
    },
    reset(): void {
      commit({ ...defaults });
    }
  };
}

export const relayPrefs = createRelayPrefsStore();
