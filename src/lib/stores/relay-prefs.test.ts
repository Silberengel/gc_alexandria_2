import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('relay prefs', () => {
  beforeEach(() => {
    mem.clear();
    stubStorage();
    vi.resetModules();
  });

  it('defaults both sources on and keeps the choice after a fresh load', async () => {
    const first = await import('./relay-prefs');
    expect(first.relayPrefs.get()).toEqual({ gitcitadel: true, outboxes: true });
    first.relayPrefs.setGitcitadel(false);
    first.relayPrefs.setOutboxes(false);
    expect(mem.get('alexandria-relay-prefs')).toBe(
      JSON.stringify({ gitcitadel: false, outboxes: false })
    );

    vi.resetModules();
    const second = await import('./relay-prefs');
    expect(second.relayPrefs.get()).toEqual({ gitcitadel: false, outboxes: false });
  });
});
