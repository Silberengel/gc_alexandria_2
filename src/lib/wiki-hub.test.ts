import { describe, expect, it, vi, beforeEach } from 'vitest';
import { KIND } from './constants';
import type { Event } from 'nostr-tools';

vi.mock('./nostr/mercury', () => ({
  mercuryFilter: vi.fn(async () => []),
  mercuryWikiSearch: vi.fn(async () => [])
}));

vi.mock('./nostr/fetch', () => ({
  fetchByAddresses: vi.fn(async () => [])
}));

vi.mock('./nostr/pool', () => ({
  relayPool: {
    query: vi.fn(async () => [])
  }
}));

vi.mock('./nostr/cache', () => ({
  cachedEventsByKind: vi.fn(async () => [])
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
    content: over.content ?? 'Article body.',
    sig: over.sig ?? 'b'.repeat(128)
  };
}

describe('wiki-hub helpers', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const hub = await import('./wiki-hub');
    const memory = await import('./nostr/event-memory');
    hub.resetWikiRecentCacheForTests();
    memory.resetEventMemoryForTests();
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

  it('loadWikiRecent merges wiki and spec hits from cache and relays', async () => {
    const cache = await import('./nostr/cache');
    const pool = await import('./nostr/pool');
    vi.mocked(cache.cachedEventsByKind).mockImplementation(async (kind) => {
      if (kind === KIND.WIKI) {
        return [ev({ id: '1'.repeat(64), kind: KIND.WIKI, created_at: 20 })];
      }
      return [];
    });
    vi.mocked(pool.relayPool.query).mockImplementation(async (_urls, filters) => {
      const kinds = filters[0]?.kinds ?? [];
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

  it('loadWikiRecent skips empty-content wiki pages', async () => {
    const cache = await import('./nostr/cache');
    const pool = await import('./nostr/pool');
    const empty = ev({
      id: 'c'.repeat(64),
      kind: KIND.WIKI,
      created_at: 80,
      tags: [['d', 'empty-shell'], ['title', 'Empty shell']],
      content: ''
    });
    const real = ev({
      id: 'b'.repeat(64),
      kind: KIND.WIKI,
      created_at: 40,
      tags: [['d', 'with-body'], ['title', 'With body']],
      content: 'Actual article text.'
    });
    vi.mocked(cache.cachedEventsByKind).mockResolvedValue([empty, real]);
    vi.mocked(pool.relayPool.query).mockResolvedValue([]);
    const { loadWikiRecent } = await import('./wiki-hub');
    expect((await loadWikiRecent(10)).map((e) => e.id)).toEqual([real.id]);
  });

  it('loadWikiRecent skips deferrals', async () => {
    const cache = await import('./nostr/cache');
    const pool = await import('./nostr/pool');
    const defer = ev({
      id: 'd'.repeat(64),
      kind: KIND.WIKI,
      created_at: 99,
      tags: [
        ['d', 'nkbip-02'],
        ['a', `30818:${'f'.repeat(64)}:nkbip-02`, 'wss://relay.example/', 'defer']
      ],
      content: 'Read the other version instead.'
    });
    const real = ev({
      id: 'e'.repeat(64),
      kind: KIND.WIKI,
      created_at: 50,
      tags: [['d', 'bitcoin'], ['title', 'Bitcoin']]
    });
    vi.mocked(cache.cachedEventsByKind).mockResolvedValue([defer, real]);
    vi.mocked(pool.relayPool.query).mockResolvedValue([]);
    const { loadWikiRecent } = await import('./wiki-hub');
    const hits = await loadWikiRecent(10);
    expect(hits.map((e) => e.id)).toEqual([real.id]);
  });

  it('loadWikiRecent reuses the TTL cache and skips a second relay query', async () => {
    const cache = await import('./nostr/cache');
    const pool = await import('./nostr/pool');
    const page = ev({
      id: 'a'.repeat(64),
      kind: KIND.WIKI,
      created_at: 40,
      tags: [['d', 'cached'], ['title', 'Cached']]
    });
    vi.mocked(cache.cachedEventsByKind).mockResolvedValue([page]);
    vi.mocked(pool.relayPool.query).mockResolvedValue([]);
    const { loadWikiRecent } = await import('./wiki-hub');
    expect((await loadWikiRecent(10)).map((e) => e.id)).toEqual([page.id]);
    expect(pool.relayPool.query).toHaveBeenCalled();
    const calls = vi.mocked(pool.relayPool.query).mock.calls.length;
    expect((await loadWikiRecent(10)).map((e) => e.id)).toEqual([page.id]);
    expect(vi.mocked(pool.relayPool.query).mock.calls.length).toBe(calls);
  });

  it('parseWikiRecentKind accepts wiki/spec and defaults to all', async () => {
    const { parseWikiRecentKind, wikiHubListingHref, wikiRecentKindHref } =
      await import('./wiki-hub');
    expect(parseWikiRecentKind(null)).toBe('all');
    expect(parseWikiRecentKind('Wiki')).toBe('wiki');
    expect(parseWikiRecentKind('spec')).toBe('spec');
    expect(parseWikiRecentKind('other')).toBe('all');
    expect(wikiRecentKindHref('all')).toBe('#/wiki');
    expect(wikiRecentKindHref('wiki')).toBe('#/wiki?kind=wiki');
    expect(wikiRecentKindHref('spec')).toBe('#/wiki?kind=spec');
    expect(wikiHubListingHref({ kind: 'wiki', from: 'trusted' })).toBe('#/wiki?kind=wiki');
    expect(wikiHubListingHref({ from: 'follows' })).toBe('#/wiki?from=follows');
    expect(wikiHubListingHref({ from: 'all' })).toBe('#/wiki?from=all');
  });

  it('loadWikiRecent filters by wiki or spec kind', async () => {
    const cache = await import('./nostr/cache');
    const pool = await import('./nostr/pool');
    const wiki = ev({
      id: '1'.repeat(64),
      kind: KIND.WIKI,
      created_at: 20,
      tags: [['d', 'wiki-page'], ['title', 'Wiki page']]
    });
    const spec = ev({
      id: '2'.repeat(64),
      kind: KIND.SPEC,
      created_at: 30,
      tags: [['d', 'nkbip-04'], ['title', 'NKBIP-04']]
    });
    vi.mocked(cache.cachedEventsByKind).mockImplementation(async (kind) => {
      if (kind === KIND.WIKI) return [wiki];
      if (kind === KIND.SPEC) return [spec];
      return [];
    });
    vi.mocked(pool.relayPool.query).mockResolvedValue([]);
    const { loadWikiRecent } = await import('./wiki-hub');
    expect((await loadWikiRecent(10, 'all')).map((e) => e.kind)).toEqual([KIND.SPEC, KIND.WIKI]);
    expect((await loadWikiRecent(10, 'wiki')).map((e) => e.id)).toEqual([wiki.id]);
    expect((await loadWikiRecent(10, 'spec')).map((e) => e.id)).toEqual([spec.id]);
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

  it('searchWikiHub resolves alias redirects into target articles and ranks them highly', async () => {
    const mercury = await import('./nostr/mercury');
    const fetch = await import('./nostr/fetch');
    const pk = 'b'.repeat(64);
    const bitcoin = ev({
      id: 'a'.repeat(64),
      kind: KIND.WIKI,
      pubkey: pk,
      created_at: 1,
      tags: [['d', 'bitcoin'], ['title', 'Bitcoin']]
    });
    const titleOnly = ev({
      id: 'c'.repeat(64),
      kind: KIND.WIKI,
      pubkey: 'd'.repeat(64),
      created_at: 99,
      tags: [['d', 'other'], ['title', 'BTC notes']]
    });
    const redirect = ev({
      id: 'e'.repeat(64),
      kind: KIND.WIKI_REDIRECT,
      pubkey: pk,
      tags: [['d', 'btc'], ['a', `30818:${pk}:bitcoin`]]
    });
    vi.mocked(mercury.mercuryWikiSearch).mockImplementation(async (query) => {
      if (query.title) return [titleOnly];
      return [];
    });
    vi.mocked(mercury.mercuryFilter).mockImplementation(async (filter) => {
      if (filter.kinds?.includes(KIND.WIKI_REDIRECT)) return [redirect];
      return [];
    });
    vi.mocked(fetch.fetchByAddresses).mockResolvedValue([bitcoin]);
    const { searchWikiHub, wikiHubAliasMatchesQuery } = await import('./wiki-hub');
    expect(wikiHubAliasMatchesQuery('btc', 'btc')).toBe(true);
    const hits = await searchWikiHub('btc');
    expect(hits.map((e) => e.id)).toEqual([bitcoin.id, titleOnly.id]);
  });
});
