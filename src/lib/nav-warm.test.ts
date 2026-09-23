import { beforeEach, describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import {
  eventMatchesPublicationRoute,
  takePendingNavEvent,
  warmNavEvent
} from './nav-warm';
import { memoryFindByAddress } from './nostr/event-memory';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear()
    }
  });
});

function pub(over: Partial<Event> & { d?: string } = {}): Event {
  const d = over.d ?? 'am-fluss-der-zeiten-ulrike-renk';
  const { d: _d, ...rest } = over;
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1,
    kind: 30040,
    tags: [
      ['d', d],
      ['title', 'Am Fluss der Zeiten']
    ],
    content: '',
    sig: 'c'.repeat(128),
    ...rest
  };
}

describe('nav-warm', () => {
  it('stashes the clicked event so the destination can paint after memory wipe', () => {
    const event = pub();
    warmNavEvent(event);
    const pending = takePendingNavEvent();
    expect(pending?.id).toBe(event.id);
    expect(pending?.tags.find((t) => t[0] === 'd')?.[1]).toBe('am-fluss-der-zeiten-ulrike-renk');
    expect(takePendingNavEvent()).toBeNull();
  });

  it('still indexes memory for same-module lookups', () => {
    const event = pub({ id: 'd'.repeat(64) });
    warmNavEvent(event);
    expect(memoryFindByAddress(30040, event.pubkey, 'am-fluss-der-zeiten-ulrike-renk')?.id).toBe(
      event.id
    );
  });

  it('matches publication routes across d-tag casing', () => {
    const event = pub({ d: 'Am-Fluss-Der-Zeiten-Ulrike-Renk' });
    expect(
      eventMatchesPublicationRoute(event, 30040, event.pubkey, 'am-fluss-der-zeiten-ulrike-renk')
    ).toBe(true);
    expect(
      eventMatchesPublicationRoute(event, 30040, 'f'.repeat(64), 'am-fluss-der-zeiten-ulrike-renk')
    ).toBe(false);
    expect(
      eventMatchesPublicationRoute(event, 30041, event.pubkey, 'am-fluss-der-zeiten-ulrike-renk')
    ).toBe(false);
  });
});
