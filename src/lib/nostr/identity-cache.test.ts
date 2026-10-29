import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KIND } from '../constants';
import type { Event } from 'nostr-tools';

const mem = new Map<string, string>();

function stubStorage(): void {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, String(v));
    },
    removeItem: (k: string) => {
      mem.delete(k);
    },
    clear: () => mem.clear()
  });
}

const pk = 'a'.repeat(64);

function ev(partial: Partial<Event> & Pick<Event, 'kind' | 'created_at'>): Event {
  return {
    id: 'b'.repeat(64),
    pubkey: pk,
    tags: [],
    content: '',
    sig: 'c'.repeat(128),
    ...partial
  };
}

describe('identity cache', () => {
  beforeEach(() => {
    mem.clear();
    stubStorage();
    vi.resetModules();
  });

  it('keeps the newest relay list, profile, and payment target across a reload', async () => {
    const first = await import('./identity-cache');
    first.rememberIdentityEvent(
      ev({ kind: KIND.RELAY_LIST, created_at: 10, tags: [['r', 'wss://old.example']] })
    );
    first.rememberIdentityEvent(
      ev({
        id: 'd'.repeat(64),
        kind: KIND.RELAY_LIST,
        created_at: 20,
        tags: [['r', 'wss://new.example']]
      })
    );
    first.rememberIdentityEvent(
      ev({ id: 'e'.repeat(64), kind: KIND.METADATA, created_at: 5, content: '{"name":"Ada"}' })
    );
    first.rememberIdentityEvent(
      ev({ id: 'f'.repeat(64), kind: KIND.PAYMENT, created_at: 8, tags: [['lud16', 'ada@example.com']] })
    );
    await Promise.resolve();

    vi.resetModules();
    const second = await import('./identity-cache');
    expect(second.cachedIdentityEvent(KIND.RELAY_LIST, pk)?.tags).toEqual([['r', 'wss://new.example']]);
    expect(second.cachedIdentityEvent(KIND.METADATA, pk)?.content).toBe('{"name":"Ada"}');
    expect(second.cachedIdentityEvents(KIND.METADATA).map((event) => event.content)).toEqual([
      '{"name":"Ada"}'
    ]);
    expect(second.cachedIdentityEvent(KIND.PAYMENT, pk)?.tags).toEqual([['lud16', 'ada@example.com']]);
    expect(second.cachedViewerIdentity(pk)).toHaveLength(3);
    second.rememberIdentityEvent(
      ev({ id: '1'.repeat(64), kind: KIND.CONTACT_LIST, created_at: 4, tags: [['p', 'b'.repeat(64)]] })
    );
    second.rememberIdentityEvent(
      ev({ id: '2'.repeat(64), kind: KIND.MUTE, created_at: 4, tags: [['p', 'c'.repeat(64)]] })
    );
    second.rememberIdentityEvent(
      ev({ id: '3'.repeat(64), kind: KIND.BLOCKED, created_at: 4, tags: [['relay', 'wss://no.example']] })
    );
    second.rememberIdentityEvent(ev({ id: '4'.repeat(64), kind: KIND.TEXT_NOTE, created_at: 9, content: 'hi' }));
    expect(second.cachedIdentityEvent(KIND.CONTACT_LIST, pk)?.tags[0]?.[1]).toBe('b'.repeat(64));
    expect(second.cachedIdentityEvent(KIND.MUTE, pk)?.tags[0]?.[1]).toBe('c'.repeat(64));
    expect(second.cachedIdentityEvent(KIND.BLOCKED, pk)?.tags).toEqual([['relay', 'wss://no.example']]);
    expect(second.cachedIdentityEvent(KIND.TEXT_NOTE, pk)).toBeNull();
  });

  it('drops an older replaceable', async () => {
    const mod = await import('./identity-cache');
    mod.rememberIdentityEvent(ev({ kind: KIND.METADATA, created_at: 30, content: '{"name":"New"}' }));
    mod.rememberIdentityEvent(
      ev({ id: '9'.repeat(64), kind: KIND.METADATA, created_at: 10, content: '{"name":"Old"}' })
    );
    expect(mod.cachedIdentityEvent(KIND.METADATA, pk)?.content).toBe('{"name":"New"}');
  });
});