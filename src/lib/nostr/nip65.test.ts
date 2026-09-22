import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { nip65InboxOutbox, relayTagUrls } from './nip65';

function ev(tags: string[][]): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1,
    kind: 10002,
    tags,
    content: '',
    sig: 'c'.repeat(128)
  };
}

describe('nip65InboxOutbox', () => {
  it('splits read / write / both markers on r tags', () => {
    const { inbox, outbox } = nip65InboxOutbox(
      ev([
        ['r', 'wss://both.example/'],
        ['r', 'wss://inbox.example/', 'read'],
        ['r', 'wss://outbox.example/', 'write']
      ])
    );
    expect(inbox).toEqual(['wss://both.example', 'wss://inbox.example']);
    expect(outbox).toEqual(['wss://both.example', 'wss://outbox.example']);
  });

  it('does not treat bare r tags as write-only inbox leftovers', () => {
    const { inbox, outbox } = nip65InboxOutbox(ev([['r', 'wss://relay.example']]));
    expect(inbox).toEqual(['wss://relay.example']);
    expect(outbox).toEqual(['wss://relay.example']);
  });

  it('accepts legacy w tags as outbox-only', () => {
    const { inbox, outbox } = nip65InboxOutbox(ev([['w', 'wss://legacy-write.example/']]));
    expect(inbox).toEqual([]);
    expect(outbox).toEqual(['wss://legacy-write.example']);
  });
});

describe('relayTagUrls', () => {
  it('reads relay tags from list events', () => {
    expect(
      relayTagUrls(
        ev([
          ['relay', 'wss://fav.example/'],
          ['relay', 'wss://fav.example/'],
          ['d', 'ignore']
        ])
      )
    ).toEqual(['wss://fav.example']);
  });
});
