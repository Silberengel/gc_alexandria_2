import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPwaUpdate, pwaUpdateAvailable } from './pwa';

describe('applyPwaUpdate', () => {
  beforeEach(() => {
    pwaUpdateAvailable.set(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('clears the banner flag and reloads when no SW updater is registered', async () => {
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
    await applyPwaUpdate();
    expect(get(pwaUpdateAvailable)).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });
});
