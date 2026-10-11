import { afterEach, describe, expect, it } from 'vitest';
import { AGGR_RELAY, SOCIAL_SEARCH_RELAYS } from '../constants';
import { relayPrefs } from '../stores/relay-prefs';
import {
  constrainRelays,
  documentStack,
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

  it('signed out, keeps GitCitadel relays and drops popular and random hosts', () => {
    expect(constrainRelays(['wss://thecitadel.nostr1.com', 'wss://random.example'])).toEqual([
      'wss://thecitadel.nostr1.com'
    ]);
    expect(constrainRelays(['wss://relay.damus.io'])).toEqual([]);
    expect(socialSearchStack()).toEqual([]);
    expect(documentStack().some((u) => u.includes('thecitadel.nostr1.com'))).toBe(true);
  });

  it('signed in with outboxes off, keeps only the viewer list unless GitCitadel is on', () => {
    setSelectorContext({
      signedIn: true,
      viewerPubkey: 'a'.repeat(64),
      inbox: ['wss://mine.example'],
      outbox: ['wss://write.example'],
      favorites: [],
      local: []
    });
    relayPrefs.setOutboxes(false);
    relayPrefs.setGitcitadel(false);
    expect(
      constrainRelays([
        'wss://thecitadel.nostr1.com',
        'wss://relay.damus.io',
        'wss://someone.example',
        'wss://mine.example/',
        'wss://write.example'
      ])
    ).toEqual(['wss://mine.example/', 'wss://write.example']);
    expect(documentStack()).not.toContain('wss://thecitadel.nostr1.com');
    expect(documentStack()).toContain('wss://mine.example');
    expect(socialSearchStack()).toEqual([]);

    relayPrefs.setGitcitadel(true);
    const kept = constrainRelays([
      'wss://thecitadel.nostr1.com',
      'wss://relay.damus.io',
      'wss://someone.example',
      'wss://mine.example'
    ]);
    expect(kept).toContain('wss://thecitadel.nostr1.com');
    expect(kept).toContain('wss://mine.example');
    expect(kept).not.toContain('wss://relay.damus.io');
    expect(kept).not.toContain('wss://someone.example');
    expect(documentStack().some((u) => u.includes('thecitadel.nostr1.com'))).toBe(true);
    expect(documentStack()).toContain('wss://mine.example');
  });

  it('uses popular relays for missing notes only when Outboxes is on', () => {
    setSelectorContext({
      signedIn: true,
      inbox: [],
      outbox: [],
      favorites: [],
      local: []
    });
    relayPrefs.setOutboxes(false);
    expect(socialSearchStack()).toEqual([]);
    relayPrefs.setOutboxes(true);
    expect(socialSearchStack()).toEqual(expect.arrayContaining([...SOCIAL_SEARCH_RELAYS]));
    expect(socialStack().some((u) => u.includes('relay.damus.io'))).toBe(false);
  });

  it('does not add the nostr.land aggregator when GitCitadel relays are off', () => {
    setSelectorContext({
      signedIn: true,
      inbox: ['wss://nostr.land'],
      outbox: [],
      favorites: [],
      local: []
    });
    relayPrefs.setGitcitadel(false);
    expect(socialStack().some((u) => u.includes('aggr.nostr.land'))).toBe(false);
    expect(socialStack()).toContain('wss://nostr.land');
  });

  it('falls back to theforest when the signed-in viewer has no relays', () => {
    setSelectorContext({
      signedIn: true,
      viewerPubkey: 'a'.repeat(64),
      inbox: [],
      outbox: [],
      favorites: [],
      local: []
    });
    relayPrefs.setGitcitadel(false);
    relayPrefs.setOutboxes(false);
    expect(socialStack()).toEqual(['wss://theforest.nostr1.com']);
    expect(documentStack()).toEqual(['wss://theforest.nostr1.com']);
    expect(viewerOutboxStack()).toEqual(['wss://theforest.nostr1.com']);
    expect(writeStack()).toEqual(['wss://theforest.nostr1.com']);
    expect(
      constrainRelays([
        'wss://thecitadel.nostr1.com',
        'wss://theforest.nostr1.com',
        'wss://relay.damus.io'
      ])
    ).toEqual(['wss://theforest.nostr1.com']);
  });

  it('keeps social search relays off the default social stack', () => {
    const social = socialStack();
    for (const url of SOCIAL_SEARCH_RELAYS) {
      expect(social).not.toContain(url);
    }
    expect(socialSearchStack()).toEqual([]);
  });
});
