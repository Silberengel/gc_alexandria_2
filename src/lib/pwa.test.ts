import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyPwaUpdate,
  pwaUpdateAvailable,
  remoteBuildIsNewer,
  setPwaUpdateSWForTests
} from './pwa';
import { APP_BUILD, APP_VERSION } from './constants';

function stubReloadEnv() {
  const replace = vi.fn();
  const reload = vi.fn();
  vi.stubGlobal('location', {
    href: 'https://gc-alexandria.imwald.eu/#/feed',
    replace,
    reload
  });
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistrations: vi.fn(async () => [])
    }
  });
  vi.stubGlobal('caches', {
    keys: vi.fn(async () => ['alexandria-old']),
    delete: vi.fn(async () => true)
  });
  return { replace, reload };
}

describe('remoteBuildIsNewer', () => {
  it('detects a different build stamp even when semver matches', () => {
    expect(remoteBuildIsNewer({ version: APP_VERSION, build: `${APP_VERSION}+deadbeef` })).toBe(
      true
    );
    expect(remoteBuildIsNewer({ version: APP_VERSION, build: APP_BUILD })).toBe(false);
  });

  it('falls back to semver when build is missing (legacy version.json)', () => {
    expect(remoteBuildIsNewer({ version: '9.9.9' })).toBe(true);
    expect(remoteBuildIsNewer({ version: APP_VERSION })).toBe(false);
  });
});

describe('applyPwaUpdate', () => {
  beforeEach(() => {
    pwaUpdateAvailable.set(true);
    setPwaUpdateSWForTests(null);
    vi.useFakeTimers();
  });

  afterEach(() => {
    setPwaUpdateSWForTests(null);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps the banner up and hard-navigates with a cache-bust query', async () => {
    const { replace, reload } = stubReloadEnv();
    const pending = applyPwaUpdate();
    await vi.runAllTimersAsync();
    await pending;
    // Banner stays until the document unloads — soft-clear made OK a no-op.
    expect(get(pwaUpdateAvailable)).toBe(true);
    expect(replace).toHaveBeenCalledOnce();
    const next = String(replace.mock.calls[0]?.[0] ?? '');
    expect(next).toContain('_pwa=');
    expect(next).toContain('#/feed');
    expect(caches.delete).toHaveBeenCalledWith('alexandria-old');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('still force-navigates after updateSW resolves without navigating', async () => {
    const { replace } = stubReloadEnv();
    const updateSW = vi.fn(async () => {
      /* vite-plugin-pwa only posts SKIP_WAITING — no reload here */
    });
    setPwaUpdateSWForTests(updateSW);
    const pending = applyPwaUpdate();
    await vi.runAllTimersAsync();
    await pending;
    expect(updateSW).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledOnce();
  });
});
