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

describe('live chat shield', () => {
  beforeEach(() => {
    mem.clear();
    stubStorage();
    vi.resetModules();
  });

  it('defaults off and persists when flipped on', async () => {
    const first = await import('./live-chat-shield');
    expect(first.liveChatShield.get()).toBe(false);
    first.liveChatShield.set(true);
    expect(mem.get('alexandria-live-chat-shield')).toBe('true');

    vi.resetModules();
    const second = await import('./live-chat-shield');
    expect(second.liveChatShield.get()).toBe(true);
  });
});
