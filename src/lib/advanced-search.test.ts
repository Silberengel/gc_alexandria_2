import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADVANCED_SEARCH_MAX_LIMIT,
  buildMercurySearchBody,
  clampAdvancedLimit,
  defaultAdvancedSearchRelays,
  encodeAdvancedSearch,
  inferAdvancedSearchMode,
  mercuryHasQuery,
  normalizeAdvancedFilter,
  normalizeRelayList,
  parseAdvancedSearch,
  parseKindToken,
  parseKindsInput,
  type AdvancedSearchRequest
} from './advanced-search';

vi.mock('./nostr/selector', () => ({
  documentStack: () => ['wss://doc.example'],
  socialStack: () => ['wss://social.example']
}));

describe('advanced search encode/parse', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('clamps limit', () => {
    expect(clampAdvancedLimit(0)).toBe(1);
    expect(clampAdvancedLimit(-5)).toBe(1);
    expect(clampAdvancedLimit(999)).toBe(ADVANCED_SEARCH_MAX_LIMIT);
    expect(clampAdvancedLimit(undefined)).toBe(1);
    expect(clampAdvancedLimit(40)).toBe(40);
  });

  it('parses kind names and integers', () => {
    expect(parseKindToken('1')).toBe(1);
    expect(parseKindToken('wiki')).toBe(30818);
    expect(parseKindsInput('1, wiki, 30023')).toEqual([1, 30818, 30023]);
  });

  it('normalizes authors into authors vs #a', () => {
    const pk = 'a'.repeat(64);
    const filter = normalizeAdvancedFilter({
      authors: [pk, `30023:${pk}:hello-world`]
    });
    expect(filter.authors).toEqual([pk]);
    expect((filter as Record<string, string[]>)['#a']).toEqual([`30023:${pk}:hello-world`]);
  });

  it('round-trips encode/parse and always includes relays', () => {
    const req: AdvancedSearchRequest = {
      filter: { kinds: [1], search: 'gm', limit: 20 },
      relays: ['wss://relay.example/', 'wss://relay.example']
    };
    const encoded = encodeAdvancedSearch(req);
    const parsed = parseAdvancedSearch(encoded);
    expect(parsed).not.toBeNull();
    expect(parsed!.filter?.kinds).toEqual([1]);
    expect(parsed!.filter?.search).toBe('gm');
    expect(parsed!.filter?.limit).toBe(20);
    expect(parsed!.relays).toEqual(['wss://relay.example']);
  });

  it('rejects empty/invalid adv', () => {
    expect(parseAdvancedSearch('')).toBeNull();
    expect(parseAdvancedSearch('%7B%7D')).toBeNull();
    expect(parseAdvancedSearch(encodeURIComponent(JSON.stringify({ relays: ['wss://x'] })))).toBeNull();
  });

  it('backfills missing relays from default stacks', () => {
    const encoded = encodeURIComponent(
      JSON.stringify({ filter: { kinds: [1], limit: 10 } })
    );
    const parsed = parseAdvancedSearch(encoded);
    expect(parsed?.relays.length).toBeGreaterThan(0);
    expect(parsed?.relays).toEqual(defaultAdvancedSearchRelays({ kinds: [1] }));
  });

  it('normalizes relay lists', () => {
    expect(normalizeRelayList(['wss://A.example/', 'not-a-url', 'wss://a.example'])).toEqual([
      'wss://a.example'
    ]);
  });

  it('preserves #e #p #h tags on normalize', () => {
    const id = 'b'.repeat(64);
    const pk = 'c'.repeat(64);
    const filter = normalizeAdvancedFilter({
      kinds: [1],
      '#e': [id],
      '#p': [pk],
      '#h': ['group1']
    } as never);
    expect((filter as Record<string, string[]>)['#e']).toEqual([id]);
    expect((filter as Record<string, string[]>)['#p']).toEqual([pk]);
    expect((filter as Record<string, string[]>)['#h']).toEqual(['group1']);
  });

  it('infers mercury vs relays mode from payload shape', () => {
    expect(
      inferAdvancedSearchMode({
        mercury: { title: 'Monte Cristo' },
        relays: []
      })
    ).toBe('mercury');
    expect(
      inferAdvancedSearchMode({
        filter: { kinds: [1], limit: 10 },
        relays: ['wss://relay.example']
      })
    ).toBe('relays');
    // Mixed legacy payloads prefer relays UI.
    expect(
      inferAdvancedSearchMode({
        filter: { kinds: [30040] },
        mercury: { q: 'books' },
        relays: ['wss://relay.example']
      })
    ).toBe('relays');
  });

  it('builds Mercury bodies per target and rejects short wiki/section q', () => {
    expect(buildMercurySearchBody({ target: 'publications', title: 'Monte' }, 10)).toEqual({
      limit: 10,
      title: 'Monte'
    });
    expect(buildMercurySearchBody({ target: 'wiki', q: 'a' }, 10)).toBeNull();
    expect(buildMercurySearchBody({ target: 'wiki', q: 'no', title: 'Nostr' }, 5)).toEqual({
      limit: 5,
      q: 'no',
      title: 'Nostr'
    });
    expect(buildMercurySearchBody({ target: 'sections', q: 'abc' }, 10)).toBeNull();
    expect(buildMercurySearchBody({ target: 'sections', q: 'abcd', d: 'ch1' }, 8)).toEqual({
      limit: 8,
      q: 'abcd',
      d: 'ch1'
    });
    expect(
      buildMercurySearchBody({ target: 'publications', identifier: 'gutenberg:1' }, 10)
    ).toEqual({ limit: 10, i: 'gutenberg:1' });
    expect(mercuryHasQuery({ target: 'wiki', author: 'Ada' })).toBe(false);
    expect(mercuryHasQuery({ target: 'publications', author: 'Ada' })).toBe(true);
  });
});
