import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPwaUpdate, pwaUpdateAvailable, setPwaUpdateSWForTests } from './pwa';

function stubReloadEnv() {
  const reload = vi.fn();
  vi.stubGlobal('location', { reload });
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistrations: vi.fn(async () => [])
    }
  });
  vi.stubGlobal('caches', {
    keys: vi.fn(async () => []),
    delete: vi.fn(async () => true)
  });
  return reload;
}

describe('applyPwaUpdate', () => {
  beforeEach(() => {
    pwaUpdateAvailable.set(true);
    setPwaUpdateSWForTests(null);
  });

  afterEach(() => {
    setPwaUpdateSWForTests(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('clears the banner flag and reloads when no SW updater is registered', async () => {
    const reload = stubReloadEnv();
    await applyPwaUpdate();
    expect(get(pwaUpdateAvailable)).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('still force-reloads after updateSW resolves without navigating', async () => {
    const reload = stubReloadEnv();
    const updateSW = vi.fn(async () => {
      /* vite-plugin-pwa only posts SKIP_WAITING — no reload here */
    });
    setPwaUpdateSWForTests(updateSW);
    await applyPwaUpdate();
    expect(updateSW).toHaveBeenCalledOnce();
    expect(get(pwaUpdateAvailable)).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });
});
