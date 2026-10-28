import { describe, expect, it } from 'vitest';
import { dTagVariants, normalizeDTag } from './dtag';

describe('normalizeDTag', () => {
  it('folds separators', () => {
    expect(normalizeDTag('Bitcoin Wallet')).toBe('bitcoin-wallet');
    expect(normalizeDTag('Sphinx.Chat')).toBe('sphinx-chat');
    expect(normalizeDTag('sphinx_chat')).toBe('sphinx-chat');
  });

  it('lowercases Latin AE ligatures', () => {
    expect(normalizeDTag('by-Æsop')).toBe('by-æsop');
  });
});

describe('dTagVariants', () => {
  it('keeps Æ when the input was lowercased to æ (relay exact match)', () => {
    const variants = dTagVariants(
      'aesops-fables-a-new-revised-version-from-original-sources-by-æsop-v-new-revised'
    );
    expect(variants).toContain(
      'aesops-fables-a-new-revised-version-from-original-sources-by-æsop-v-new-revised'
    );
    expect(variants).toContain(
      'aesops-fables-a-new-revised-version-from-original-sources-by-Æsop-v-new-revised'
    );
  });
});
