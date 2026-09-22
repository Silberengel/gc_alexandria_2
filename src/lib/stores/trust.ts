import { writable } from 'svelte/store';
import { GRAPEVINE_RANK_MIN_DEFAULT } from '../constants';

const ENABLED_KEY = 'alexandria-trust-filter-enabled';
const RANK_MIN_KEY = 'alexandria-grapevine-rank-min';

export type TrustState = {
  /** Missing localStorage key = enabled (jumble / Android parity). */
  enabled: boolean;
  rankMin: number;
};

function snapRankMin(value: number): number {
  return Math.min(100, Math.max(1, Math.round(value)));
}

function load(): TrustState {
  let enabled = true;
  let rankMin = GRAPEVINE_RANK_MIN_DEFAULT;
  try {
    const rawEnabled = localStorage.getItem(ENABLED_KEY);
    if (rawEnabled === 'false') enabled = false;
    else if (rawEnabled === 'true') enabled = true;
    const rawMin = localStorage.getItem(RANK_MIN_KEY);
    if (rawMin != null) {
      const parsed = Number.parseInt(rawMin, 10);
      if (!Number.isNaN(parsed)) rankMin = snapRankMin(parsed);
    }
  } catch {
    /* private mode */
  }
  return { enabled, rankMin };
}

function createTrustStore() {
  let current = load();
  const { subscribe, set } = writable<TrustState>(current);

  function commit(next: TrustState): void {
    current = next;
    try {
      localStorage.setItem(ENABLED_KEY, next.enabled ? 'true' : 'false');
      localStorage.setItem(RANK_MIN_KEY, String(next.rankMin));
    } catch {
      /* ignore */
    }
    set(next);
  }

  return {
    subscribe,
    getEnabled: () => current.enabled,
    getRankMin: () => current.rankMin,
    snapshot: () => ({ ...current }),
    setEnabled(enabled: boolean) {
      commit({ ...current, enabled });
    },
    setRankMin(rankMin: number) {
      commit({ ...current, rankMin: snapRankMin(rankMin) });
    },
    reset() {
      commit({ enabled: true, rankMin: GRAPEVINE_RANK_MIN_DEFAULT });
    }
  };
}

export const trust = createTrustStore();
