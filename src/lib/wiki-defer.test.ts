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
    expect(isDeferralPlaceholderContent('# Bitcoin\n\nA real article.')).toBe(false);
  });
});
