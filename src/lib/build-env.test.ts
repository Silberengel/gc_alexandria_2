import { describe, expect, it } from 'vitest';
import { viteHex, viteList, viteString } from './build-env';

describe('viteString', () => {
  it('keeps the fallback when unset or blank', () => {
    expect(viteString(undefined, 'wss://default')).toBe('wss://default');
    expect(viteString('   ', 'wss://default')).toBe('wss://default');
  });

  it('uses a trimmed override', () => {
    expect(viteString('  wss://other  ', 'wss://default')).toBe('wss://other');
  });
});

describe('viteHex', () => {
  it('lowercases an override', () => {
    expect(viteHex('Ab', 'cd')).toBe('ab');
    expect(viteHex(undefined, 'CD')).toBe('cd');
  });
});

describe('viteList', () => {
  const fallback = ['wss://a', 'wss://b'] as const;

  it('keeps the fallback when unset, blank, or only commas', () => {
    expect(viteList(undefined, fallback)).toEqual(['wss://a', 'wss://b']);
    expect(viteList('  ', fallback)).toEqual(['wss://a', 'wss://b']);
    expect(viteList(',,', fallback)).toEqual(['wss://a', 'wss://b']);
  });

  it('splits a comma-separated override', () => {
    expect(viteList(' wss://x, wss://y, ', fallback)).toEqual(['wss://x', 'wss://y']);
  });
});
