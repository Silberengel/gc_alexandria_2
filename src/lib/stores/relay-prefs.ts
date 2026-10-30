import { writable } from 'svelte/store';

const STORAGE_KEY = 'alexandria-relay-prefs';

export type RelayPrefsState = {
  /**
   * Shipped library / social / profile relays (theforest, thecitadel, Mercury, …).
   * Always on — merged with the viewer's own lists. Kept in state for older
   * localStorage blobs; {@link setGitcitadel} is a no-op that forces true.
   */
  gitcitadel: boolean;
  /**
   * Other people's relays (their outboxes and inboxes, tag hints, public social relays).
   * Default on. Off means a signed-in session never dials a relay that is not the
   * viewer's own list or Alexandria's shipped hosts.
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
    // Library hosts are always on (merged with the viewer's lists).
    return {
      gitcitadel: true,
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
    current = { ...next, gitcitadel: true };
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
      } catch {
        /* private mode */
      }
    }
    set(current);
  }

  // Rewrite older localStorage that had gitcitadel: false.
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<RelayPrefsState>;
        if (parsed.gitcitadel === false) {
          commit({ gitcitadel: true, outboxes: parsed.outboxes !== false });
        }
      }
    } catch {
      /* ignore */
    }
  }

  return {
    subscribe,
    get(): RelayPrefsState {
      return current;
    },
    /** No-op — library relays stay merged with the viewer's lists. */
    setGitcitadel(_on: boolean): void {
      commit({ ...current, gitcitadel: true });
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
