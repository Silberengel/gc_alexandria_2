import { afterEach, describe, expect, it } from 'vitest';
import { PUBLIC_BROADCAST_RELAYS } from './constants';
import { broadcastStack, setSelectorContext } from './nostr/selector';
import { relayPrefs } from './stores/relay-prefs';

describe('broadcastStack', () => {
  afterEach(() => {
    setSelectorContext({
      signedIn: false,
      viewerPubkey: '',
      inbox: [],
      outbox: [],
      favorites: [],
      local: [],
      blocked: []
    });
    relayPrefs.setGitcitadel(true);
    relayPrefs.setOutboxes(true);
  });

  it('uses the public broadcast relays when signed out', () => {
    setSelectorContext({
      signedIn: false,
      viewerPubkey: '',
      inbox: [],
      outbox: [],
      favorites: [],
      local: [],
      blocked: []
    });
    expect(broadcastStack()).toEqual([...PUBLIC_BROADCAST_RELAYS]);
  });

  it('uses the viewer write stack when signed in with outboxes', () => {
    setSelectorContext({
      signedIn: true,
      viewerPubkey: 'a'.repeat(64),
      inbox: ['wss://inbox.example'],
      outbox: ['wss://outbox.example'],
      favorites: [],
      local: [],
      blocked: []
    });
    expect(broadcastStack()).toEqual(['wss://outbox.example']);
  });
});
