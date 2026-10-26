import { describe, expect, it } from 'vitest';
import {
  buildCheckpointTags,
  buildDraftWrapTags,
  buildPrivateRelayTagRows,
  draftWrapAddress,
  parsePrivateRelayTags
} from '@silberengel/kind-compose-catalog';
import { KIND } from './constants';
import {
  draftExpirationUnix,
  normalizePrivateRelayUrls,
  publicFallbackPrivateRelays
} from './nip37';

describe('nip37 helpers', () => {
  it('builds draft wrap tags with d, k, and expiration', () => {
    expect(buildDraftWrapTags({ d: 'my-draft', k: 30023, expiration: 1893456000 })).toEqual([
      ['d', 'my-draft'],
      ['k', '30023'],
      ['expiration', '1893456000']
    ]);
  });

  it('builds checkpoint a-tag from address', () => {
    const pk = 'a'.repeat(64);
    const address = draftWrapAddress(pk, 'ch1');
    expect(address).toBe(`31234:${pk}:ch1`);
    expect(buildCheckpointTags({ address })).toEqual([['a', address]]);
  });

  it('parses private relay tag rows and normalizes urls', () => {
    const rows = buildPrivateRelayTagRows([
      'wss://nostr.land/',
      'wss://nostr.land',
      'not-a-relay',
      'ws://localhost:7777'
    ]);
    expect(parsePrivateRelayTags(rows)).toEqual([
      'wss://nostr.land/',
      'ws://localhost:7777'
    ]);
    expect(normalizePrivateRelayUrls(['wss://a.example/', 'wss://a.example'])).toEqual([
      'wss://a.example/'
    ]);
  });

  it('recommends a 90-day expiration window', () => {
    const now = 1_700_000_000;
    expect(draftExpirationUnix(now)).toBe(now + 90 * 24 * 60 * 60);
  });

  it('exposes public fallback relays and kind constants', () => {
    const fallback = publicFallbackPrivateRelays();
    expect(fallback.length).toBeGreaterThan(0);
    for (const url of fallback) {
      expect(url).toMatch(/^wss:\/\//);
    }
    expect(KIND.PRIVATE_RELAY_LIST).toBe(10013);
    expect(KIND.DRAFT_WRAP).toBe(31234);
    expect(KIND.DRAFT_CHECKPOINT).toBe(1234);
  });
});
