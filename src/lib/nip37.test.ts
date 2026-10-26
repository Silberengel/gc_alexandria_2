import { describe, expect, it } from 'vitest';
import {
  buildCheckpointTags,
  buildPrivateRelayTagRows,
  draftWrapAddress,
  parsePrivateRelayTags
} from '@silberengel/kind-compose-catalog';
import { KIND } from './constants';
import {
  buildDraftWrapTags,
  decryptWrap,
  draftExpirationUnix,
  normalizePrivateRelayUrls,
  publicFallbackPrivateRelays
} from './nip37';
import type { Event } from 'nostr-tools';

describe('nip37 helpers', () => {
  it('builds draft wrap tags with d, k, and expiration', () => {
    expect(buildDraftWrapTags({ d: 'my-draft', k: 30023, expiration: 1893456000 })).toEqual([
      ['d', 'my-draft'],
      ['k', '30023'],
      ['expiration', '1893456000']
    ]);
  });

  it('always emits an empty d tag so Primal wraps can be deleted', () => {
    expect(buildDraftWrapTags({ d: '', k: 30023 })).toEqual([
      ['d', ''],
      ['k', '30023']
    ]);
  });

  it('accepts Primal-style wraps with an empty d tag', async () => {
    const wrap = {
      id: '60f9cb2588dea6df71cb56ab29d327bd512a85a3557462226980e5e3e50009c5',
      sig: '9'.repeat(128),
      kind: 31234,
      tags: [
        ['d', ''],
        ['k', '30023'],
        ['client', 'Primal Web']
      ],
      pubkey: 'dd664d5e4016433a8cd69f005ae1480804351789b59de5af06276de65633d319',
      content: 'ciphertext',
      created_at: 1792998851
    } as Event;
    const dec = await decryptWrap(wrap);
    expect(dec).not.toBeNull();
    expect(dec!.d).toBe('');
    expect(dec!.draftKind).toBe(30023);
    expect(dec!.deleted).toBe(false);
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
