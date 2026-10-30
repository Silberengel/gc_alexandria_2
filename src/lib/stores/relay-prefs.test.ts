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

  it('keeps library hosts always on and persists outboxes', async () => {
    const first = await import('./relay-prefs');
    expect(first.relayPrefs.get()).toEqual({ gitcitadel: true, outboxes: true });
    first.relayPrefs.setGitcitadel(false);
    first.relayPrefs.setOutboxes(false);
    expect(first.relayPrefs.get()).toEqual({ gitcitadel: true, outboxes: false });
    expect(mem.get('alexandria-relay-prefs')).toBe(
      JSON.stringify({ gitcitadel: true, outboxes: false })
    );

    vi.resetModules();
    const second = await import('./relay-prefs');
    expect(second.relayPrefs.get()).toEqual({ gitcitadel: true, outboxes: false });
  });

  it('migrates older gitcitadel:false localStorage back on', async () => {
    mem.set('alexandria-relay-prefs', JSON.stringify({ gitcitadel: false, outboxes: true }));
    const mod = await import('./relay-prefs');
    expect(mod.relayPrefs.get()).toEqual({ gitcitadel: true, outboxes: true });
    expect(mem.get('alexandria-relay-prefs')).toBe(
      JSON.stringify({ gitcitadel: true, outboxes: true })
    );
  });
});
