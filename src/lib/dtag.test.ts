import { describe, expect, it } from 'vitest';
import { normalizeDTag } from './dtag';

describe('normalizeDTag', () => {
  it('folds separators', () => {
    expect(normalizeDTag('Bitcoin Wallet')).toBe('bitcoin-wallet');
    expect(normalizeDTag('Sphinx.Chat')).toBe('sphinx-chat');
    expect(normalizeDTag('sphinx_chat')).toBe('sphinx-chat');
  });
});
