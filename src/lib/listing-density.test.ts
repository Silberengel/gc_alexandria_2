import { beforeAll, describe, expect, it } from 'vitest';
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

describe('listingDensity', () => {
  it('persists full, list, and table choices', async () => {
    mem.clear();
    const { listingDensity } = await import('./stores/listing-density');
    listingDensity.set('list');
    expect(get(listingDensity)).toBe('list');
    expect(localStorage.getItem('alexandria-listing-density')).toBe('list');
    listingDensity.set('table');
    expect(get(listingDensity)).toBe('table');
    expect(localStorage.getItem('alexandria-listing-density')).toBe('table');
    listingDensity.set('full');
    expect(get(listingDensity)).toBe('full');
    listingDensity.toggle();
    expect(get(listingDensity)).toBe('list');
    listingDensity.toggle();
    expect(get(listingDensity)).toBe('table');
  });
});
