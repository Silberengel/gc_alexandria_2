import { afterEach, describe, expect, it } from 'vitest';
import { AGGR_RELAY, PUBLIC_BROADCAST_RELAYS, SOCIAL_SEARCH_RELAYS } from '../constants';
import { relayPrefs } from '../stores/relay-prefs';
import {
  constrainRelays,
  documentStack,
  liveChatStack,
  setSelectorContext,
  socialSearchStack,
  socialStack,
  viewerOutboxStack,
  writeStack
} from './selector';

describe('nostr.land aggregator', () => {
  afterEach(() => {
    relayPrefs.reset();
    setSelectorContext({
      signedIn: false,
      viewerPubkey: '',
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

  it('signed out, treats library hosts and Outboxes as on', () => {
    expect(constrainRelays(['wss://thecitadel.nostr1.com', 'wss://random.example'])).toEqual([
      'wss://thecitadel.nostr1.com',
      'wss://random.example'
    ]);
    expect(socialSearchStack()).toEqual(expect.arrayContaining([...SOCIAL_SEARCH_RELAYS]));
    expect(documentStack().some((u) => u.includes('thecitadel.nostr1.com'))).toBe(true);
  });

  it('signed in with outboxes off, keeps viewer lists plus Alexandria library hosts', () => {
    setSelectorContext({
      signedIn: true,
      viewerPubkey: 'a'.repeat(64),
      inbox: ['wss://mine.example'],
      outbox: ['wss://write.example'],
      favorites: [],
      local: []
    });
    relayPrefs.setOutboxes(false);
    const kept = constrainRelays([
      'wss://thecitadel.nostr1.com',
      'wss://relay.damus.io',
      'wss://someone.example',
      'wss://mine.example/',
      'wss://write.example'
    ]);
    expect(kept).toContain('wss://thecitadel.nostr1.com');
    expect(kept).toContain('wss://mine.example/');
    expect(kept).toContain('wss://write.example');
    expect(kept).not.toContain('wss://relay.damus.io');
    expect(kept).not.toContain('wss://someone.example');
    expect(documentStack().some((u) => u.includes('thecitadel.nostr1.com'))).toBe(true);
    expect(documentStack()).toContain('wss://mine.example');
    expect(socialSearchStack()).toEqual(expect.arrayContaining([...SOCIAL_SEARCH_RELAYS]));
  });

  it('uses popular relays for missing notes alongside the social stack', () => {
    setSelectorContext({
      signedIn: true,
      inbox: [],
      outbox: [],
      favorites: [],
      local: []
    });
    expect(socialSearchStack()).toEqual(expect.arrayContaining([...SOCIAL_SEARCH_RELAYS]));
    expect(socialStack().some((u) => u.includes('primus.nostr1.com'))).toBe(false);
  });

  it('adds the nostr.land aggregator when the viewer lists nostr.land', () => {
    setSelectorContext({
      signedIn: true,
      inbox: ['wss://nostr.land'],
      outbox: [],
      favorites: [],
      local: []
    });
    expect(socialStack().some((u) => u.includes('aggr.nostr.land'))).toBe(true);
    expect(socialStack()).toContain('wss://nostr.land');
  });

  it('keeps library hosts when the signed-in viewer has no personal relays', () => {
    setSelectorContext({
      signedIn: true,
      viewerPubkey: 'a'.repeat(64),
      inbox: [],
      outbox: [],
      favorites: [],
      local: []
    });
    relayPrefs.setOutboxes(false);
    expect(socialStack().some((u) => u.includes('theforest'))).toBe(true);
    expect(documentStack().some((u) => u.includes('thecitadel'))).toBe(true);
    expect(viewerOutboxStack()).toEqual(['wss://theforest.nostr1.com']);
    expect(writeStack()).toEqual(['wss://theforest.nostr1.com']);
    const kept = constrainRelays([
      'wss://thecitadel.nostr1.com',
      'wss://theforest.nostr1.com',
      'wss://relay.damus.io'
    ]);
    expect(kept).toContain('wss://thecitadel.nostr1.com');
    expect(kept).toContain('wss://theforest.nostr1.com');
    expect(kept).not.toContain('wss://relay.damus.io');
  });

  it('keeps social search relays off the default social stack', () => {
    const social = socialStack();
    for (const url of SOCIAL_SEARCH_RELAYS) {
      expect(social).not.toContain(url);
    }
    expect(socialSearchStack()).toEqual(expect.arrayContaining([...SOCIAL_SEARCH_RELAYS]));
  });

  it('liveChatStack stays open on blocked relays until shield respects blocks', () => {
    setSelectorContext({
      signedIn: true,
      viewerPubkey: 'a'.repeat(64),
      inbox: [],
      outbox: [],
      favorites: [],
      local: [],
      blocked: ['wss://noisy.example']
    });
    const open = liveChatStack({ respectBlocked: false });
    expect(open).toEqual(expect.arrayContaining([...PUBLIC_BROADCAST_RELAYS, 'wss://noisy.example']));
    const shielded = liveChatStack({ respectBlocked: true });
    expect(shielded).toEqual(expect.arrayContaining([...PUBLIC_BROADCAST_RELAYS]));
    expect(shielded).not.toContain('wss://noisy.example');
  });
});
