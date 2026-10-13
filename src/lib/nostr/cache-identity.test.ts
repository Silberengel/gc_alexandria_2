import { beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { KIND } from '../constants';

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

describe('cachePutEvent viewer lists', () => {
  beforeEach(async () => {
    mem.clear();
    stubStorage();
    const { clearIdentityCache } = await import('./identity-cache');
    const { setSelectorContext } = await import('./selector');
    clearIdentityCache();
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

  it('keeps the newest viewer contact and mute lists that arrive after login', async () => {
    const { cachePutEvent } = await import('./cache');
    const { cachedIdentityEvent } = await import('./identity-cache');
    const { setSelectorContext } = await import('./selector');
    const sk = generateSecretKey();
    const viewer = getPublicKey(sk);
    setSelectorContext({ signedIn: true, viewerPubkey: viewer });

    await cachePutEvent(
      finalizeEvent(
        { kind: KIND.CONTACT_LIST, created_at: 10, tags: [['p', 'a'.repeat(64)]], content: '' },
        sk
      )
    );
    const newerFollows = finalizeEvent(
      { kind: KIND.CONTACT_LIST, created_at: 20, tags: [['p', 'b'.repeat(64)]], content: '' },
      sk
    );
    await cachePutEvent(newerFollows);
    expect(cachedIdentityEvent(KIND.CONTACT_LIST, viewer)?.id).toBe(newerFollows.id);

    await cachePutEvent(
      finalizeEvent(
        { kind: KIND.MUTE, created_at: 10, tags: [['p', 'c'.repeat(64)]], content: '' },
        sk
      )
    );
    const newerMute = finalizeEvent(
      { kind: KIND.MUTE, created_at: 30, tags: [['p', 'd'.repeat(64)]], content: '' },
      sk
    );
    await cachePutEvent(newerMute);
    expect(cachedIdentityEvent(KIND.MUTE, viewer)?.id).toBe(newerMute.id);
  });

  it('leaves another author contact list out of the map', async () => {
    const { cachePutEvent } = await import('./cache');
    const { cachedIdentityEvent } = await import('./identity-cache');
    const { setSelectorContext } = await import('./selector');
    const viewer = getPublicKey(generateSecretKey());
    const otherSk = generateSecretKey();
    const other = getPublicKey(otherSk);
    setSelectorContext({ signedIn: true, viewerPubkey: viewer });
    await cachePutEvent(
      finalizeEvent(
        { kind: KIND.CONTACT_LIST, created_at: 5, tags: [['p', 'e'.repeat(64)]], content: '' },
        otherSk
      )
    );
    expect(cachedIdentityEvent(KIND.CONTACT_LIST, other)).toBeNull();
    expect(cachedIdentityEvent(KIND.CONTACT_LIST, viewer)).toBeNull();
  });
});
