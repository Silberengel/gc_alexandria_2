import { describe, expect, it, vi, beforeEach } from 'vitest';
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

vi.mock('./trusted-assertions', () => ({
  trustedAssertions: {
    resolveProvider: vi.fn(async () => {}),
    requestScoresAndWait: vi.fn(async () => {}),
    getScore: vi.fn(() => null)
  }
}));

vi.mock('./follows-of-follows', () => ({
  ensureFollowsOfFollows: vi.fn(async () => {}),
  getFollowsOfFollowsSet: vi.fn(() => new Set<string>())
}));

vi.mock('./stores/session', () => ({
  session: {
    getPubkey: () => null,
    getMetadata: () => []
  }
}));

vi.mock('./stores/trust', () => ({
  trust: {
    snapshot: () => ({ enabled: false, rankMin: 0 })
  }
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it('matches only d-tag and title, not body content', async () => {
    const { wikiHubMatchesQuery } = await import('./wiki-hub');
    const bodyOnly = ev({
      id: '3'.repeat(64),
      tags: [['d', 'nkbip-04'], ['title', 'NKBIP-04']],
      content: 'Discusses amethyst wallet features at length'
    });
    const byD = ev({
      id: '4'.repeat(64),
      tags: [['d', 'amethyst'], ['title', 'Amethyst']],
      content: ''
    });
    expect(wikiHubMatchesQuery(bodyOnly, 'amethyst')).toBe(false);
    expect(wikiHubMatchesQuery(byD, 'amethyst')).toBe(true);
  });

  it('ranks exact d-tag ahead of title-only and unrelated body hits', async () => {
    const { sortWikiHubResults, wikiHubRelevanceScore } = await import('./wiki-hub');
    const exactD = ev({
      id: '5'.repeat(64),
      created_at: 1,
      tags: [['d', 'amethyst'], ['title', 'Android client']]
    });
    const titleHit = ev({
      id: '6'.repeat(64),
      created_at: 99,
      tags: [['d', 'other-page'], ['title', 'Amethyst notes']]
    });
    const weak = ev({
      id: '7'.repeat(64),
      created_at: 50,
      tags: [['d', 'amethyst-fork'], ['title', 'Fork']]
    });
    expect(wikiHubRelevanceScore(exactD, 'amethyst')).toBeGreaterThan(
      wikiHubRelevanceScore(weak, 'amethyst')
    );
    expect(wikiHubRelevanceScore(weak, 'amethyst')).toBeGreaterThan(
      wikiHubRelevanceScore(titleHit, 'amethyst')
    );
    const sorted = sortWikiHubResults([titleHit, weak, exactD], 'amethyst');
    expect(sorted.map((e) => e.id)).toEqual([exactD.id, weak.id, titleHit.id]);
  });

  it('searchWikiHub queries Mercury title/d only and filters body hits', async () => {
    const mercury = await import('./nostr/mercury');
    const bodyHit = ev({
      id: '8'.repeat(64),
      tags: [['d', 'nkbip-04'], ['title', 'NKBIP-04']],
      content: 'amethyst'
    });
    const dHit = ev({
      id: '9'.repeat(64),
      tags: [['d', 'amethyst'], ['title', 'Amethyst']],
      created_at: 5
    });
    vi.mocked(mercury.mercuryWikiSearch).mockImplementation(async (query) => {
      if (query.d) return [dHit, bodyHit];
      if (query.title) return [bodyHit];
      return [bodyHit];
    });
    const { searchWikiHub } = await import('./wiki-hub');
    const hits = await searchWikiHub('amethyst');
    expect(hits.map((e) => e.id)).toEqual([dHit.id]);
    expect(vi.mocked(mercury.mercuryWikiSearch).mock.calls.every((c) => c[0].title || c[0].d)).toBe(
      true
    );
    expect(vi.mocked(mercury.mercuryWikiSearch).mock.calls.some((c) => c[0].title && !c[0].d)).toBe(
      true
    );
    expect(vi.mocked(mercury.mercuryWikiSearch).mock.calls.some((c) => c[0].d && !c[0].title)).toBe(
      true
    );
  });
});
