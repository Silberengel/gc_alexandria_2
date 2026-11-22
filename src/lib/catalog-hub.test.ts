import { describe, expect, it, vi, beforeEach } from 'vitest';
import { KIND } from './constants';
import type { Event } from 'nostr-tools';

vi.mock('./nostr/mercury', () => ({
  mercuryFilter: vi.fn(async () => []),
  mercuryPublicationSearch: vi.fn(async () => [])
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
  documentStack: () => ['wss://docs.example']
}));

function ev(over: Partial<Event>): Event {
  return {
    id: over.id ?? '1'.repeat(64),
    pubkey: over.pubkey ?? 'a'.repeat(64),
    created_at: over.created_at ?? 10,
    kind: over.kind ?? KIND.PUBLICATION,
    tags: over.tags ?? [['d', 'monte-cristo'], ['title', 'Monte Cristo']],
    content: over.content ?? 'Index body.',
    sig: over.sig ?? 'b'.repeat(128)
  };
}

describe('catalogMatchesQuery', () => {
  it('matches title and d-tag substrings (normalized)', async () => {
    const { catalogMatchesQuery } = await import('./catalog-hub');
    const pub = ev({
      kind: KIND.PUBLICATION,
      tags: [
        ['d', 'animated-media-reaction-clips'],
        ['title', 'Animated Media (Reaction Clips)']
      ]
    });
    expect(catalogMatchesQuery(pub, 'reaction')).toBe(true);
    expect(catalogMatchesQuery(pub, 'Reaction')).toBe(true);
    expect(catalogMatchesQuery(pub, 'animated-media')).toBe(true);
    expect(catalogMatchesQuery(pub, 'zzz')).toBe(false);
  });

  it('matches body text for catalog hubs', async () => {
    const { catalogMatchesQuery } = await import('./catalog-hub');
    const article = ev({
      kind: KIND.LONG_FORM,
      tags: [['d', 'notes'], ['title', 'Notes']],
      content: 'A short essay about reaction clips.'
    });
    expect(catalogMatchesQuery(article, 'reaction')).toBe(true);
  });
});

describe('searchCatalogHub', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const memory = await import('./nostr/event-memory');
    memory.resetEventMemoryForTests();
  });

  it('keeps publication title-substring hits from Mercury bare q', async () => {
    const mercury = await import('./nostr/mercury');
    const titleHit = ev({
      id: '2'.repeat(64),
      kind: KIND.PUBLICATION,
      tags: [
        ['d', 'animated-media-reaction-clips'],
        ['title', 'Animated Media (Reaction Clips)'],
        ['a', `30041:${'a'.repeat(64)}:ch1`]
      ]
    });
    const unrelated = ev({
      id: '3'.repeat(64),
      kind: KIND.PUBLICATION,
      tags: [['d', 'other'], ['title', 'Other'], ['a', `30041:${'a'.repeat(64)}:x`]],
      content: 'no match'
    });
    vi.mocked(mercury.mercuryPublicationSearch).mockImplementation(async (query) => {
      if (query.title || query.d) return [unrelated];
      return [titleHit, unrelated];
    });
    const { searchCatalogHub } = await import('./catalog-hub');
    const hits = await searchCatalogHub(KIND.PUBLICATION, 'reaction');
    expect(hits.map((e) => e.id)).toEqual([titleHit.id]);
    expect(
      vi.mocked(mercury.mercuryPublicationSearch).mock.calls.some(
        (c) => !c[0].title && !c[0].d && c[0].q === 'reaction'
      )
    ).toBe(true);
  });
});
