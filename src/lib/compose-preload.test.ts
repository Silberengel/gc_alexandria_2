import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  shouldPreloadReplaceable,
  valuesFromReplaceableEvent
} from './compose-preload';

function ev(partial: Partial<Event> & Pick<Event, 'kind'>): Event {
  return {
    id: '1'.repeat(64),
    pubkey: 'a'.repeat(64),
    created_at: 1,
    tags: [],
    content: '',
    sig: '2'.repeat(128),
    ...partial
  };
}

describe('shouldPreloadReplaceable', () => {
  it('is true for NIP-01 replaceable kinds only', () => {
    expect(shouldPreloadReplaceable(0)).toBe(true);
    expect(shouldPreloadReplaceable(3)).toBe(true);
    expect(shouldPreloadReplaceable(10002)).toBe(true);
    expect(shouldPreloadReplaceable(10013)).toBe(true);
    expect(shouldPreloadReplaceable(16374)).toBe(true);
    expect(shouldPreloadReplaceable(1)).toBe(false);
    expect(shouldPreloadReplaceable(KIND.TEXT_NOTE)).toBe(false);
    expect(shouldPreloadReplaceable(KIND.LONG_FORM)).toBe(false);
    expect(shouldPreloadReplaceable(KIND.PUBLICATION)).toBe(false);
    expect(shouldPreloadReplaceable(30315)).toBe(false);
  });
});

describe('valuesFromReplaceableEvent', () => {
  it('maps NIP-65 relay lists into the relays field', () => {
    const pre = valuesFromReplaceableEvent(
      ev({
        kind: 10002,
        tags: [
          ['r', 'wss://relay.example'],
          ['r', 'wss://read.example', 'read']
        ]
      })
    );
    expect(pre.values.relays).toContain('wss://relay.example');
    expect(pre.values.relays).toContain('wss://read.example read');
  });

  it('maps favorite relays from relay tags', () => {
    const pre = valuesFromReplaceableEvent(
      ev({
        kind: 10012,
        tags: [['relay', 'wss://fav.example']]
      })
    );
    expect(pre.values.relays).toBe('wss://fav.example');
  });
});
