import { describe, expect, it, vi, beforeEach } from 'vitest';
import { KIND } from './constants';

vi.mock('./ensure-metadata', () => ({
  ensureMetadata: vi.fn(async () => null)
}));

vi.mock('./nostr/pool', () => ({
  relayPool: {
    query: vi.fn(async () => [])
  }
}));

vi.mock('./nostr/selector', () => ({
  profileStack: () => ['wss://profile.example'],
  socialStack: () => ['wss://social.example']
}));

vi.mock('./nostr/identity-cache', () => ({
  cachedIdentityEvent: vi.fn(() => null),
  rememberIdentityEvent: vi.fn()
}));

vi.mock('./nostr/event-memory', () => ({
  memoryFindMetadata: vi.fn(() => null),
  rememberEvents: vi.fn()
}));

describe('loadAuthorPaymentTargets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty rows for invalid pubkeys', async () => {
    const { loadAuthorPaymentTargets } = await import('./payment-targets');
    const hit = await loadAuthorPaymentTargets('not-a-key');
    expect(hit.rows).toEqual([]);
    expect(hit.profile).toBeNull();
  });

  it('builds rows from kind 0 lud16 and kind 10133 payto tags', async () => {
    const pk = 'a'.repeat(64);
    const { ensureMetadata } = await import('./ensure-metadata');
    const { relayPool } = await import('./nostr/pool');
    const profile = {
      id: '1'.repeat(64),
      pubkey: pk,
      kind: KIND.METADATA,
      created_at: 1,
      content: JSON.stringify({ lud16: 'ada@example.com' }),
      tags: [] as string[][],
      sig: '0'.repeat(128)
    };
    const payment = {
      id: '2'.repeat(64),
      pubkey: pk,
      kind: KIND.PAYMENT,
      created_at: 2,
      content: '',
      tags: [['payto', 'monero', '4'.repeat(95)]],
      sig: '0'.repeat(128)
    };
    vi.mocked(ensureMetadata).mockResolvedValue(profile as never);
    vi.mocked(relayPool.query).mockResolvedValue([profile, payment] as never);

    const { loadAuthorPaymentTargets } = await import('./payment-targets');
    const hit = await loadAuthorPaymentTargets(pk);
    expect(hit.rows.some((r) => r.type === 'lightning' || r.type === 'lud16')).toBe(true);
    expect(hit.rows.some((r) => r.type === 'monero')).toBe(true);
  });
});
