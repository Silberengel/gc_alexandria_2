import { describe, expect, it, vi } from 'vitest';
import { KIND } from './constants';
import type { Event } from 'nostr-tools';

vi.mock('./nostr/mercury', () => ({
  mercuryFilter: vi.fn(async () => []),
  mercuryWikiSearch: vi.fn(async () => [])
}));

vi.mock('./nostr/pool', () => ({
  relayPool: {
    query: vi.fn(async () => [])
  }
}));

vi.mock('./nostr/selector', () => ({
  wikiStack: () => ['wss://wiki.example']
}));

function ev(over: Partial<Event>): Event {
  return {
    id: over.id ?? '1'.repeat(64),
    pubkey: over.pubkey ?? 'a'.repeat(64),
    created_at: over.created_at ?? 10,
    kind: over.kind ?? KIND.WIKI,
    tags: over.tags ?? [['d', 'monte-cristo'], ['title', 'Monte Cristo']],
    content: over.content ?? '',
    sig: over.sig ?? 'b'.repeat(128)
  };
}

describe('wiki-hub helpers', () => {
  it('labels and paths for wiki vs spec', async () => {
    const { wikiHubKindLabel, wikiHubResultHref, wikiHubResultLabel } = await import('./wiki-hub');
    const wiki = ev({ kind: KIND.WIKI });
    const spec = ev({
      kind: KIND.SPEC,
      tags: [['d', 'nkbip-04'], ['title', 'NKBIP-04']]
    });
    expect(wikiHubKindLabel(wiki)).toBe('Wiki');
    expect(wikiHubKindLabel(spec)).toBe('Spec');
    expect(wikiHubResultLabel(wiki)).toContain('Monte');
    expect(wikiHubResultHref(wiki)).toContain('#/wiki/');
    expect(wikiHubResultHref(spec)).toContain('#/spec/');
  });

  it('loadWikiRecent merges wiki and spec hits', async () => {
    const mercury = await import('./nostr/mercury');
    vi.mocked(mercury.mercuryFilter).mockImplementation(async (filter) => {
      const kinds = filter.kinds ?? [];
      if (kinds.includes(KIND.WIKI)) {
        return [ev({ id: '1'.repeat(64), kind: KIND.WIKI, created_at: 20 })];
      }
      if (kinds.includes(KIND.SPEC)) {
        return [
          ev({
            id: '2'.repeat(64),
            kind: KIND.SPEC,
            created_at: 30,
            tags: [['d', 'nkbip-04'], ['title', 'NKBIP-04']]
          })
        ];
      }
      return [];
    });
    const { loadWikiRecent } = await import('./wiki-hub');
    const hits = await loadWikiRecent(10);
    expect(hits.map((e) => e.kind)).toEqual([KIND.SPEC, KIND.WIKI]);
  });
});
