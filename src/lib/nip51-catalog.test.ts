import { describe, expect, it } from 'vitest';
import { getKind } from '@silberengel/kind-compose-catalog';

/** New NIP-51 list/set kinds added for Alexandria compose + attributions. */
const EXPECTED: Record<number, string> = {
  10004: 'Communities list',
  10005: 'Public chats list',
  10007: 'Search relays',
  10008: 'Profile badges',
  10009: 'Simple groups',
  10017: 'Git authors',
  10018: 'Git repositories',
  10020: 'Media follows',
  10021: 'Favorite follow sets',
  10054: 'Favorite podcasts',
  10064: 'Authored podcasts',
  30002: 'Relay set',
  30003: 'Bookmark set',
  30004: 'Article curation set',
  30005: 'Video curation set',
  30006: 'Picture curation set',
  30007: 'Kind mute set',
  30008: 'Badge set',
  30015: 'Interest set',
  30267: 'App curation set',
  31924: 'Calendar',
  39092: 'Media starter pack'
};

describe('NIP-51 catalog kinds', () => {
  it('registers missing list and set kinds with expected labels', () => {
    for (const [kind, label] of Object.entries(EXPECTED)) {
      const def = getKind(Number(kind));
      expect(def, `kind ${kind}`).toBeTruthy();
      expect(def?.label).toBe(label);
      expect(def?.suites ?? []).toContain('lists');
    }
  });

  it('puts curation / bookmark sets on the alexandria suite', () => {
    for (const kind of [30003, 30004, 30005, 30006]) {
      expect(getKind(kind)?.suites ?? []).toContain('alexandria');
    }
  });
});
