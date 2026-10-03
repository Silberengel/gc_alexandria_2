import { afterEach, describe, expect, it } from 'vitest';
import { AGGR_RELAY, SOCIAL_SEARCH_RELAYS } from '../constants';
import { documentStack, setSelectorContext, socialSearchStack, socialStack } from './selector';

describe('nostr.land aggregator', () => {
  afterEach(() => {
    setSelectorContext({
      signedIn: false,
      inbox: [],
      outbox: [],
      favorites: [],
      local: [],
      blocked: []
    });
  });

  it('does not add aggr when signed out even though defaults include nostr.land', () => {
    expect(documentStack().some((u) => u.includes('aggr.nostr.land'))).toBe(false);
  });

  it('inserts aggr after nostr.land when the viewer lists nostr.land, within the first relays', () => {
    setSelectorContext({
      signedIn: true,
      inbox: ['wss://nostr.land'],
      outbox: [],
      favorites: [],
      local: []
    });
    const stack = socialStack();
    const aggrAt = stack.findIndex((u) => u.includes('aggr.nostr.land'));
    const landAt = stack.findIndex((u) => /nostr\.land/.test(u) && !u.includes('aggr'));
    expect(aggrAt).toBeGreaterThanOrEqual(0);
    expect(aggrAt).toBeLessThan(8);
    expect(landAt).toBeGreaterThanOrEqual(0);
    expect(aggrAt).toBe(landAt + 1);
    expect(stack[aggrAt]).toBe(AGGR_RELAY);
  });

  it('keeps social search relays off the default social stack', () => {
    const social = socialStack();
    for (const url of SOCIAL_SEARCH_RELAYS) {
      expect(social).not.toContain(url);
    }
    expect(socialSearchStack()).toEqual(expect.arrayContaining([...SOCIAL_SEARCH_RELAYS]));
  });
});
