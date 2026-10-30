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

describe('normalizeIgnoreWord', () => {
  beforeEach(() => {
    mem.clear();
    stubStorage();
    vi.resetModules();
  });

  it('rejects empty and multi-word phrases', async () => {
    const { normalizeIgnoreWord } = await import('./grammar-ignore');
    expect(normalizeIgnoreWord('')).toBe('');
    expect(normalizeIgnoreWord('  ')).toBe('');
    expect(normalizeIgnoreWord('Nostr protocol')).toBe('');
    expect(normalizeIgnoreWord('Nostr')).toBe('Nostr');
  });
});

describe('grammarIgnoreWords', () => {
  beforeEach(() => {
    mem.clear();
    stubStorage();
    vi.resetModules();
  });

  it('persists adds and matches case-insensitively', async () => {
    const { grammarIgnoreWords } = await import('./grammar-ignore');
    expect(grammarIgnoreWords.add('Nostr')).toBe(true);
    expect(grammarIgnoreWords.add('nostr')).toBe(false);
    expect(grammarIgnoreWords.has('NOSTR')).toBe(true);
    expect(get(grammarIgnoreWords)).toEqual(['Nostr']);
    expect(JSON.parse(mem.get('alexandria-grammar-ignore') ?? '[]')).toEqual(['Nostr']);

    vi.resetModules();
    const again = await import('./grammar-ignore');
    expect(get(again.grammarIgnoreWords)).toEqual(['Nostr']);
    expect(again.grammarIgnoreWords.has('nostr')).toBe(true);
  });

  it('removes words', async () => {
    const { grammarIgnoreWords } = await import('./grammar-ignore');
    grammarIgnoreWords.add('npub');
    grammarIgnoreWords.remove('NPUB');
    expect(grammarIgnoreWords.has('npub')).toBe(false);
    expect(get(grammarIgnoreWords)).toEqual([]);
  });
});
