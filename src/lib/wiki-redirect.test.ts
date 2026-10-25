import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { KIND } from './constants';
import {
  parseWikiRedirect,
  uniqueRedirectTargets,
  wikiRedirectTargetHref
} from './wiki-redirect';

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
});
