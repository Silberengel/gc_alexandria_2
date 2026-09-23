import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

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

vi.mock('../nostr/pool', () => ({
  relayPool: {
    setSignedIn: vi.fn(),
    query: vi.fn(async () => []),
    publish: vi.fn(async () => undefined)
  }
}));

vi.mock('../nostr/mercury', () => ({
  mercuryFilter: vi.fn(async () => [])
}));

vi.mock('../nostr/cache', () => ({
  cachePutMany: vi.fn(async () => undefined),
  cacheClearLandingSnapshot: vi.fn(async () => undefined)
}));

const PK = 'a'.repeat(64);

describe('session sign-out persistence', () => {
  beforeEach(() => {
    mem.clear();
    stubStorage();
  });

  it('clears persisted session and stays anonymous after restore', async () => {
    const { nip19 } = await import('nostr-tools');
    const npub = nip19.npubEncode(PK);
    const getPublicKey = vi.fn(async () => PK);
    const nostr = { getPublicKey, _pubkey: PK as string | null };
    vi.stubGlobal('window', { nostr });
    vi.stubGlobal('nostr', nostr);

    const { session } = await import('./session');
    session.signOut();
    mem.set(
      'alexandria-session',
      JSON.stringify({ pubkey: PK, npub, signerType: 'nip07' })
    );

    expect(await session.restore()).toBe(true);
    expect(get(session).pubkey).toBe(PK);

    session.signOut();
    expect(get(session).pubkey).toBeNull();
    expect(localStorage.getItem('alexandria-session')).toBeNull();
    expect(nostr._pubkey).toBeNull();

    getPublicKey.mockClear();
    expect(await session.restore()).toBe(false);
    expect(get(session).pubkey).toBeNull();
    expect(getPublicKey).not.toHaveBeenCalled();
  });
});
