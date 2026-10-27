import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  navigateReturn,
  normalizeNavKey,
  peekReturnTarget,
  resetNavHistoryForTests,
  skipNextNavTrack,
  trackNavChange
} from './nav-history';

vi.mock('svelte-spa-router', () => ({
  replace: vi.fn(() => Promise.resolve())
}));

import { replace } from 'svelte-spa-router';

afterEach(() => {
  resetNavHistoryForTests();
  vi.mocked(replace).mockClear();
});

describe('normalizeNavKey', () => {
  it('normalizes hash and empty to /', () => {
    expect(normalizeNavKey('')).toBe('/');
    expect(normalizeNavKey('#')).toBe('/');
    expect(normalizeNavKey('#/')).toBe('/');
    expect(normalizeNavKey('#/feed?thread=ab')).toBe('/feed?thread=ab');
    expect(normalizeNavKey('search?q=x')).toBe('/search?q=x');
  });
});

describe('nav history stack', () => {
  it('falls back to landing when empty', () => {
    trackNavChange('/about');
    expect(peekReturnTarget()).toBe('/');
    navigateReturn();
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('returns to the previously tracked page', () => {
    trackNavChange('/search?q=nostr');
    trackNavChange('/feed');
    trackNavChange('/feed?thread=abc');
    expect(peekReturnTarget()).toBe('/feed');
    navigateReturn();
    expect(replace).toHaveBeenCalledWith('/feed');
    // After Return, lastSeen is the destination — peek walks further back.
    expect(peekReturnTarget()).toBe('/search?q=nostr');
  });

  it('does not re-push when Return navigates', () => {
    trackNavChange('/about');
    trackNavChange('/settings');
    navigateReturn();
    expect(replace).toHaveBeenCalledWith('/about');
    // Simulate the location update that follows replace (skipping is set).
    trackNavChange('/about');
    expect(peekReturnTarget()).toBe('/');
  });

  it('skips quiet rewrites so Feed default-tab does not trap Back', () => {
    trackNavChange('/');
    trackNavChange('/feed');
    skipNextNavTrack();
    trackNavChange('/feed?tab=follows');
    expect(peekReturnTarget()).toBe('/');
    navigateReturn();
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('does not leave skipping stuck on a no-op Return', () => {
    trackNavChange('/');
    navigateReturn();
    expect(replace).not.toHaveBeenCalled();
    trackNavChange('/settings');
    trackNavChange('/compose');
    expect(peekReturnTarget()).toBe('/settings');
  });
});
