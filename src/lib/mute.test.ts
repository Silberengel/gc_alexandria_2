import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  filterMuted,
  isMutedEvent,
  muteThreadRootId,
  parseMuteList
} from './mute';

function ev(over: Partial<Event> & Pick<Event, 'kind'>): Event {
  return {
    id: over.id ?? 'a'.repeat(64),
    pubkey: over.pubkey ?? 'b'.repeat(64),
    created_at: over.created_at ?? 1,
    kind: over.kind,
    tags: over.tags ?? [],
    content: over.content ?? '',
    sig: over.sig ?? 'c'.repeat(128)
  };
}

describe('parseMuteList NIP-51 / Amethyst coverage', () => {
  it('collects public p, e, t, and word tags', () => {
    const state = parseMuteList(
      ev({
        kind: KIND.MUTE,
        tags: [
          ['p', '1'.repeat(64)],
          ['e', '2'.repeat(64)],
          ['t', '#Nostr'],
          ['word', 'Spam']
        ]
      })
    );
    expect(state.pubkeys.has('1'.repeat(64))).toBe(true);
    expect(state.eventIds.has('2'.repeat(64))).toBe(true);
    expect(state.hashtags.has('nostr')).toBe(true);
    expect(state.words.has('spam')).toBe(true);
  });

  it('merges private/extra tags the same way', () => {
    const state = parseMuteList(ev({ kind: KIND.MUTE, tags: [['p', '1'.repeat(64)]] }), [
      ['t', 'nsfw'],
      ['word', 'scam'],
      ['e', '3'.repeat(64)]
    ]);
    expect(state.pubkeys.size).toBe(1);
    expect(state.hashtags.has('nsfw')).toBe(true);
    expect(state.words.has('scam')).toBe(true);
    expect(state.eventIds.has('3'.repeat(64))).toBe(true);
  });
});

describe('isMutedEvent', () => {
  it('hides muted authors and exact event ids', () => {
    const state = parseMuteList(
      ev({
        kind: KIND.MUTE,
        tags: [
          ['p', '1'.repeat(64)],
          ['e', 'd'.repeat(64)]
        ]
      })
    );
    expect(isMutedEvent(ev({ kind: 1, pubkey: '1'.repeat(64) }), state)).toBe(true);
    expect(isMutedEvent(ev({ kind: 1, id: 'd'.repeat(64), pubkey: '2'.repeat(64) }), state)).toBe(
      true
    );
  });

  it('hides replies in a muted thread (Amethyst e-tag thread mute)', () => {
    const root = 'e'.repeat(64);
    const state = parseMuteList(ev({ kind: KIND.MUTE, tags: [['e', root]] }));
    const reply = ev({
      kind: KIND.TEXT_NOTE,
      id: 'f'.repeat(64),
      pubkey: '2'.repeat(64),
      tags: [
        ['e', root, '', 'root'],
        ['e', '9'.repeat(64), '', 'reply']
      ],
      content: 'reply in muted thread'
    });
    expect(muteThreadRootId(reply)).toBe(root);
    expect(isMutedEvent(reply, state)).toBe(true);
  });

  it('hides notes with muted hashtags case-insensitively', () => {
    const state = parseMuteList(ev({ kind: KIND.MUTE, tags: [['t', 'Bitcoin']] }));
    const hit = ev({
      kind: 1,
      pubkey: '2'.repeat(64),
      tags: [['t', 'bitcoin']],
      content: 'gm'
    });
    const miss = ev({
      kind: 1,
      id: 'd'.repeat(64),
      pubkey: '2'.repeat(64),
      tags: [['t', 'nostr']],
      content: 'gm'
    });
    expect(isMutedEvent(hit, state)).toBe(true);
    expect(isMutedEvent(miss, state)).toBe(false);
  });

  it('hides notes whose content or title contains a muted word', () => {
    const state = parseMuteList(ev({ kind: KIND.MUTE, tags: [['word', 'casino']] }));
    const inBody = ev({
      kind: 1,
      pubkey: '2'.repeat(64),
      content: 'Try this Casino deal'
    });
    const inTitle = ev({
      kind: KIND.LONG_FORM,
      id: 'd'.repeat(64),
      pubkey: '2'.repeat(64),
      content: '',
      tags: [['title', 'Casino tips']]
    });
    const clean = ev({
      kind: 1,
      id: 'e'.repeat(64),
      pubkey: '2'.repeat(64),
      content: 'plain note'
    });
    expect(filterMuted([inBody, inTitle, clean], state).map((e) => e.id)).toEqual([clean.id]);
  });
});
