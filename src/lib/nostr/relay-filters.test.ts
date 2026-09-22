import { describe, expect, it } from 'vitest';
import {
  AGGR_RELAY,
  BRAINSTORM_SEARCH_RELAY_URL,
  MERCURY_WSS
} from '../constants';
import {
  isTorOrI2pRelay,
  normalizeWebSocketRelay,
  webSocketRelays,
  writeWebSocketRelays
} from './relay-filters';

describe('Tor and I2P relays', () => {
  it('detects onion and i2p hosts', () => {
    expect(isTorOrI2pRelay('ws://abc.onion:7778/')).toBe(true);
    expect(isTorOrI2pRelay('wss://relay.example.i2p/')).toBe(true);
    expect(isTorOrI2pRelay('wss://pipe.imwald.eu/')).toBe(false);
  });

  it('drops them from normalized and stack lists', () => {
    expect(normalizeWebSocketRelay('ws://cwx3zhyyu3x64b7u5xj63toy56eyo35ohzsaxjs5ko2ackpapqi3qhyd.onion:7778/')).toBeNull();
    expect(normalizeWebSocketRelay('wss://foo.b32.i2p/')).toBeNull();
    expect(
      webSocketRelays([
        'wss://pipe.imwald.eu/',
        'ws://cwx3zhyyu3x64b7u5xj63toy56eyo35ohzsaxjs5ko2ackpapqi3qhyd.onion:7778/',
        'wss://secret.i2p/'
      ])
    ).toEqual(['wss://pipe.imwald.eu']);
  });
});

describe('writeWebSocketRelays', () => {
  it('drops Mercury, aggregator, Brainstorm, and Nostr Archives relays', () => {
    expect(
      writeWebSocketRelays([
        'wss://pipe.imwald.eu/',
        MERCURY_WSS,
        `${MERCURY_WSS}/`,
        AGGR_RELAY,
        BRAINSTORM_SEARCH_RELAY_URL,
        'wss://thecitadel.nostr1.com',
        'wss://feeds.nostrarchives.com/notes/trending/reactions/today',
        'wss://search.nostrarchives.com/'
      ])
    ).toEqual(['wss://pipe.imwald.eu', 'wss://thecitadel.nostr1.com']);
  });
});

describe('normalizeRelayFilters NIP-50 search', () => {
  it('preserves search on Brainstorm-style filters', async () => {
    const { normalizeRelayFilters } = await import('./relay-filters');
    const out = normalizeRelayFilters([
      {
        kinds: [30040],
        search: 'pride observer:aa sort:rank include:spam',
        limit: 80
      }
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.search).toContain('observer:aa');
    expect(out[0]?.kinds).toEqual([30040]);
  });
});
