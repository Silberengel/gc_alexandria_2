import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { getWikiDeferTarget, isDeferralPlaceholderContent, isWikiDeference } from './wiki-defer';

function ev(partial: Partial<Event>): Event {
  return {
    id: 'c'.repeat(64),
    pubkey: 'a'.repeat(64),
    created_at: 0,
    kind: 30818,
    tags: [],
    content: '',
    sig: 'd'.repeat(128),
    ...partial
  };
}

describe('wiki deference', () => {
  it('reads the defer target coordinate', () => {
    const coord = `30818:${'b'.repeat(64)}:bitcoin`;
    const article = ev({
      tags: [
        ['d', 'bitcoin'],
        ['a', coord, '', 'defer'],
        ['e', 'e'.repeat(64), '', 'defer']
      ]
    });
    expect(isWikiDeference(article)).toBe(true);
    expect(getWikiDeferTarget(article)?.coordinate).toBe(coord);
  });

  it('ignores forks', () => {
    const article = ev({
      tags: [['a', `30818:${'b'.repeat(64)}:bitcoin`, '', 'fork']]
    });
    expect(isWikiDeference(article)).toBe(false);
  });

  it('recognizes the placeholder body', () => {
    expect(isDeferralPlaceholderContent('Read nostr:naddr1qqqq instead.')).toBe(true);
    expect(isDeferralPlaceholderContent('Read naddr1qqqqqqqq instead.')).toBe(true);
    expect(isDeferralPlaceholderContent('# Bitcoin\n\nA real article.')).toBe(false);
  });

  it('builds a wiki path from a defer coordinate', async () => {
    const { nip19 } = await import('nostr-tools');
    const { wikiPathFromCoordinate, wikiDeferTargetHref } = await import('./wiki-defer');
    const pk = 'b'.repeat(64);
    const npub = nip19.npubEncode(pk);
    expect(wikiPathFromCoordinate(`30818:${pk}:bitcoin`)).toBe(
      `/wiki/d/bitcoin/p/${npub}`
    );
    const article = ev({
      tags: [
        ['d', 'bitcoin'],
        ['a', `30818:${pk}:preferred`, '', 'defer']
      ],
      content: 'Read nostr:naddr1qqqq instead.'
    });
    expect(wikiDeferTargetHref(article)).toBe(`/wiki/d/preferred/p/${npub}`);
  });

  it('collects every pubkey that defers to the preferred article', async () => {
    const { eventDefersTo, deferrerPubkeys } = await import('./wiki-defer');
    const preferredPk = 'b'.repeat(64);
    const preferred = ev({
      id: '1'.repeat(64),
      pubkey: preferredPk,
      tags: [['d', 'nkbip-02']]
    });
    const a = ev({
      id: '2'.repeat(64),
      pubkey: 'c'.repeat(64),
      tags: [
        ['d', 'nkbip-02'],
        ['a', `30818:${preferredPk}:nkbip-02`, '', 'defer']
      ]
    });
    const b = ev({
      id: '3'.repeat(64),
      pubkey: 'd'.repeat(64),
      tags: [
        ['d', 'other'],
        ['e', preferred.id, '', 'defer']
      ]
    });
    const noise = ev({
      id: '4'.repeat(64),
      pubkey: 'e'.repeat(64),
      tags: [['d', 'nkbip-02']]
    });
    expect(eventDefersTo(a, preferred)).toBe(true);
    expect(eventDefersTo(b, preferred)).toBe(true);
    expect(eventDefersTo(noise, preferred)).toBe(false);
    expect(deferrerPubkeys([a, b, noise, preferred], preferred, ['f'.repeat(64)])).toEqual([
      'f'.repeat(64),
      'c'.repeat(64),
      'd'.repeat(64)
    ]);
  });
});
