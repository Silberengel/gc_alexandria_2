import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  isSpaPathname,
  normalizeExternalSpaPath,
  rewritePathDeepLinkToHash
} from './path-to-hash';

describe('normalizeExternalSpaPath', () => {
  it('collapses /publication/naddr/{naddr} used by external linkers', () => {
    const naddr =
      'naddr1qvzqqqr4tqpzq0s66re6t57pyfzakaug23ky8t0rm97xuprvt98kq97ddn2pv35sqy3hwumn8ghj7';
    expect(normalizeExternalSpaPath(`/publication/naddr/${naddr}`)).toBe(`/publication/${naddr}`);
    expect(normalizeExternalSpaPath(`/wiki/naddr/${naddr}/`)).toBe(`/wiki/${naddr}`);
  });

  it('leaves canonical pointer and d-tag paths alone', () => {
    expect(normalizeExternalSpaPath('/publication/naddr1abc')).toBe('/publication/naddr1abc');
    expect(normalizeExternalSpaPath('/publication/d/jane-eyre/p/npub1abc')).toBe(
      '/publication/d/jane-eyre/p/npub1abc'
    );
  });
});

describe('isSpaPathname', () => {
  it('recognizes library deep links and ignores assets', () => {
    expect(isSpaPathname('/publication/naddr/naddr1abc')).toBe(true);
    expect(isSpaPathname('/publication/naddr1abc')).toBe(true);
    expect(isSpaPathname('/search')).toBe(true);
    expect(isSpaPathname('/')).toBe(false);
    expect(isSpaPathname('/assets/index.js')).toBe(false);
  });
});

describe('rewritePathDeepLinkToHash', () => {
  let replaceState: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    replaceState = vi.fn();
    vi.stubGlobal(
      'history',
      { replaceState } as Pick<History, 'replaceState'> as History
    );
    vi.stubGlobal('window', { history: { replaceState } } as unknown as Window & typeof globalThis);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rewrites a path naddr link into a hash route', () => {
    const naddr = 'naddr1qvzqqqr4tqpzq0s66re6t57pyfzakaug23ky8t0rm97xuprvt98kq97ddn2pv35s';
    const ok = rewritePathDeepLinkToHash({
      pathname: `/publication/naddr/${naddr}`,
      search: '',
      hash: ''
    });
    expect(ok).toBe(true);
    expect(replaceState).toHaveBeenCalledWith(null, '', `/#/publication/${naddr}`);
  });

  it('keeps path query on the hash route', () => {
    const ok = rewritePathDeepLinkToHash({
      pathname: '/search',
      search: '?q=plato',
      hash: ''
    });
    expect(ok).toBe(true);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/#/search?q=plato');
  });

  it('does nothing for the landing path', () => {
    expect(rewritePathDeepLinkToHash({ pathname: '/', search: '', hash: '' })).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
  });
});
