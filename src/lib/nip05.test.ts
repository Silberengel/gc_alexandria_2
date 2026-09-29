import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getWellKnownNip05Url,
  lookupNip05Pubkey,
  splitNip05Identifier,
  verifyNip05AgainstWellKnown
} from './nip05';

const SILBERENGEL = 'fd208ee8c8f283780a9552896e4823cc9dc6bfd442063889577106940fd927c1';

describe('nip05', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('splits local@domain on the first @', () => {
    expect(splitNip05Identifier('silberengel@gitcitadel.com')).toEqual({
      name: 'silberengel',
      domain: 'gitcitadel.com'
    });
    expect(splitNip05Identifier('bad')).toBeNull();
  });

  it('builds the well-known URL', () => {
    expect(getWellKnownNip05Url('gitcitadel.com')).toBe(
      'https://gitcitadel.com/.well-known/nostr.json'
    );
    expect(getWellKnownNip05Url('gitcitadel.com', 'silberengel')).toContain('name=silberengel');
  });

  it('verifies a matching names entry', () => {
    const json = {
      names: {
        silberengel: SILBERENGEL,
        other: 'a'.repeat(64)
      }
    };
    expect(verifyNip05AgainstWellKnown(json, 'silberengel', SILBERENGEL)).toBe(true);
    expect(verifyNip05AgainstWellKnown(json, 'silberengel', 'b'.repeat(64))).toBe(false);
    expect(verifyNip05AgainstWellKnown(json, 'missing', SILBERENGEL)).toBe(false);
  });

  it('accepts inverted hex → name rows', () => {
    const json = { names: { [SILBERENGEL]: 'silberengel' } };
    expect(verifyNip05AgainstWellKnown(json, 'silberengel', SILBERENGEL)).toBe(true);
  });

  it('caches failed NIP-05 lookups so well-known is not re-fetched', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ names: {} })
    }));
    vi.stubGlobal('fetch', fetchMock);

    const id = `missing-cache-miss-${Date.now()}@example.test`;
    expect(await lookupNip05Pubkey(id)).toBeNull();
    expect(await lookupNip05Pubkey(id)).toBeNull();
    // First attempt: unscoped + ?name= scoped. Second attempt must hit the null cache.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caches successful NIP-05 lookups', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ names: { alice: SILBERENGEL } })
    }));
    vi.stubGlobal('fetch', fetchMock);

    const id = `alice@success-${Date.now()}.example.test`;
    expect(await lookupNip05Pubkey(id)).toBe(SILBERENGEL);
    expect(await lookupNip05Pubkey(id)).toBe(SILBERENGEL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
