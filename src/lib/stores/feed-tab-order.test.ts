import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

const mem = new Map<string, string>();

beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, String(v));
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
      clear: () => mem.clear()
    }
  });
});

describe('feedTabOrder', () => {
  beforeEach(() => {
    mem.clear();
  });

  it('defaults to follows first and persists reorder', async () => {
    const { feedTabOrder, normalizeFeedTabOrder } = await import('./feed-tab-order');
    expect(get(feedTabOrder)[0]).toBe('follows');
    expect(normalizeFeedTabOrder(['replies', 'bogus', 'original'])).toEqual([
      'replies',
      'original',
      'follows',
      'notifications'
    ]);
    feedTabOrder.set(['follows', 'original', 'replies', 'notifications']);
    feedTabOrder.reorder(0, 2);
    expect(get(feedTabOrder).slice(0, 3)).toEqual(['original', 'replies', 'follows']);
    expect(localStorage.getItem('alexandria-feed-tab-order')).toContain('original');
  });

  it('adds and removes kind tabs', async () => {
    const { feedTabOrder } = await import('./feed-tab-order');
    feedTabOrder.set(['follows', 'original', 'replies', 'notifications']);
    expect(feedTabOrder.addKind(30023)).toBe('kind:30023');
    expect(get(feedTabOrder)).toContain('kind:30023');
    feedTabOrder.remove('kind:30023');
    expect(get(feedTabOrder)).not.toContain('kind:30023');
    feedTabOrder.remove('follows');
    expect(get(feedTabOrder)).toContain('follows');
  });
});
