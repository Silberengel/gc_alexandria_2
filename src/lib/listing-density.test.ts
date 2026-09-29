import { beforeAll, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { parseStoredListingDensity } from './stores/listing-density';

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
  it('persists full and table choices', async () => {
    mem.clear();
    const { listingDensity } = await import('./stores/listing-density');
    listingDensity.set('table');
    expect(get(listingDensity)).toBe('table');
    expect(localStorage.getItem('alexandria-listing-density')).toBe('table');
    listingDensity.set('full');
    expect(get(listingDensity)).toBe('full');
    listingDensity.toggle();
    expect(get(listingDensity)).toBe('table');
    listingDensity.toggle();
    expect(get(listingDensity)).toBe('full');
  });

  it('maps legacy compact-grid preference to full', () => {
    expect(parseStoredListingDensity('list')).toBe('full');
    expect(parseStoredListingDensity('table')).toBe('table');
    expect(parseStoredListingDensity('full')).toBe('full');
    expect(parseStoredListingDensity(null)).toBe('full');
  });
});
