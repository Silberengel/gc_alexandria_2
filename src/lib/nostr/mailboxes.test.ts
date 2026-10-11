import { describe, expect, it } from 'vitest';
import { KIND } from '../constants';
import { responseInboxPubkeys, withPreferredRelays } from './mailboxes';

describe('withPreferredRelays', () => {
  it('puts the extra relays first and raises the cap so they are not sliced off', () => {
    const { relays, maxRelays } = withPreferredRelays(
      ['wss://thecitadel.nostr1.com', 'wss://theforest.nostr1.com', 'wss://nostr.land'],
      ['wss://personal.example', 'wss://thecitadel.nostr1.com/'],
      2
    );
    expect(relays.slice(0, 2)).toEqual(['wss://personal.example', 'wss://thecitadel.nostr1.com/']);
    expect(relays.filter((u) => u.includes('thecitadel'))).toHaveLength(1);
    expect(maxRelays).toBe(4);
    expect(relays.slice(0, maxRelays)).toContain('wss://personal.example');
    expect(relays.slice(0, maxRelays)).toContain('wss://theforest.nostr1.com');
  });

  it('leaves the cap unchanged when there is nothing to add', () => {
    const base = ['wss://thecitadel.nostr1.com'];
    expect(withPreferredRelays(base, [], 4)).toEqual({ relays: base, maxRelays: 4 });
  });
});

describe('responseInboxPubkeys', () => {
  const other = 'a'.repeat(64);
  const self = 'b'.repeat(64);
  const root = 'c'.repeat(64);

  it('collects p and P on a comment and skips the signer', () => {
    expect(
      responseInboxPubkeys({
        kind: KIND.COMMENT,
        pubkey: self,
        tags: [
          ['P', root],
          ['p', other],
          ['p', self],
          ['e', 'd'.repeat(64)]
        ]
      })
    ).toEqual([root, other]);
  });

  it('does not treat the viewer’s own lists as a response delivery', () => {
    expect(
      responseInboxPubkeys({
        kind: KIND.LABEL,
        pubkey: self,
        tags: [['p', other]]
      })
    ).toEqual([]);
  });
});
