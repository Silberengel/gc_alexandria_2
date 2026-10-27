import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { KIND } from './constants';
import {
  parseWikiRedirect,
  resolveWikiAliasArticles,
  uniqueRedirectTargets,
  wikiAliasMatchesQuery,
  wikiAliasesFromRedirects,
  wikiRedirectTargetHref
} from './wiki-redirect';

vi.mock('./nostr/mercury', () => ({
  mercuryFilter: vi.fn(async () => [])
}));

vi.mock('./nostr/fetch', () => ({
  fetchByAddresses: vi.fn(async () => [])
}));

vi.mock('./nostr/pool', () => ({
  relayPool: {
    query: vi.fn(async () => [])
  }
}));

vi.mock('./nostr/selector', () => ({
  wikiStack: () => ['wss://wiki.example']
}));

function ev(partial: Partial<Event> & Pick<Event, 'kind' | 'pubkey'>): Event {
  return {
    id: (partial.id ?? 'a'.repeat(64)).slice(0, 64),
    created_at: partial.created_at ?? 1_700_000_000,
    content: partial.content ?? '',
    tags: partial.tags ?? [],
    sig: 'c'.repeat(128),
    ...partial
  };
}

describe('wiki-redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses 30819 and builds a wiki path', () => {
    const pk = 'b'.repeat(64);
    const redirect = ev({
      kind: KIND.WIKI_REDIRECT,
      pubkey: 'f'.repeat(64),
      tags: [
        ['d', 'btc'],
        ['a', `30818:${pk}:bitcoin`]
      ]
    });
    expect(parseWikiRedirect(redirect)?.alias).toBe('btc');
    expect(wikiRedirectTargetHref(redirect)).toBe(
      `/wiki/d/bitcoin/p/${nip19.npubEncode(pk)}`
    );
  });

  it('dedupes redirect targets', () => {
    const pk = 'b'.repeat(64);
    const a = ev({
      kind: KIND.WIKI_REDIRECT,
      pubkey: '1'.repeat(64),
      id: '1'.repeat(64),
      tags: [['d', 'btc'], ['a', `30818:${pk}:bitcoin`]]
    });
    const b = ev({
      kind: KIND.WIKI_REDIRECT,
      pubkey: '2'.repeat(64),
      id: '2'.repeat(64),
      tags: [['d', 'btc'], ['a', `30818:${pk}:bitcoin`]]
    });
    const c = ev({
      kind: KIND.WIKI_REDIRECT,
      pubkey: '3'.repeat(64),
      id: '3'.repeat(64),
      tags: [['d', 'btc'], ['a', `30818:${'c'.repeat(64)}:bitcoin-cash`]]
    });
    expect(uniqueRedirectTargets([a, b, c])).toHaveLength(2);
  });

  it('lists inbound alias redirects for an article', () => {
    const pk = 'b'.repeat(64);
    const article = ev({
      kind: KIND.WIKI,
      pubkey: pk,
      id: '9'.repeat(64),
      tags: [['d', 'bitcoin'], ['title', 'Bitcoin']]
    });
    const alias = ev({
      kind: KIND.WIKI_REDIRECT,
      pubkey: pk,
      id: '8'.repeat(64),
      tags: [['d', 'btc'], ['a', `30818:${pk}:bitcoin`]]
    });
    const other = ev({
      kind: KIND.WIKI_REDIRECT,
      pubkey: pk,
      id: '7'.repeat(64),
      tags: [['d', 'cash'], ['a', `30818:${pk}:bitcoin-cash`]]
    });
    const self = ev({
      kind: KIND.WIKI_REDIRECT,
      pubkey: pk,
      id: '6'.repeat(64),
      tags: [['d', 'bitcoin'], ['a', `30818:${pk}:bitcoin`]]
    });
    expect(wikiAliasesFromRedirects([alias, other, self], article)).toEqual([
      { alias: 'btc', href: '/wiki/d/btc', pubkey: pk }
    ]);
  });

  it('matches alias queries by exact, prefix, or contains', () => {
    expect(wikiAliasMatchesQuery('btc', 'btc')).toBe(true);
    expect(wikiAliasMatchesQuery('bitcoin', 'bit')).toBe(true);
    expect(wikiAliasMatchesQuery('lightning-network', 'ning')).toBe(true);
    expect(wikiAliasMatchesQuery('btc', 'eth')).toBe(false);
  });

  it('resolveWikiAliasArticles fetches redirect targets for matching aliases', async () => {
    const mercury = await import('./nostr/mercury');
    const fetch = await import('./nostr/fetch');
    const pk = 'b'.repeat(64);
    const bitcoin = ev({
      id: 'a'.repeat(64),
      kind: KIND.WIKI,
      pubkey: pk,
      tags: [['d', 'bitcoin'], ['title', 'Bitcoin']]
    });
    const redirect = ev({
      id: 'e'.repeat(64),
      kind: KIND.WIKI_REDIRECT,
      pubkey: pk,
      tags: [['d', 'btc'], ['a', `30818:${pk}:bitcoin`]]
    });
    vi.mocked(mercury.mercuryFilter).mockResolvedValue([redirect]);
    vi.mocked(fetch.fetchByAddresses).mockResolvedValue([bitcoin]);

    const hit = await resolveWikiAliasArticles('btc');
    expect(hit.targets.map((e) => e.id)).toEqual([bitcoin.id]);
    expect(hit.exactAliasIds.has(bitcoin.id)).toBe(true);
    expect(hit.aliasMatchedIds.has(bitcoin.id)).toBe(true);
  });
});
