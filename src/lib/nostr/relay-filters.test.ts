import { describe, expect, it } from 'vitest';
import { isTorOrI2pRelay, normalizeWebSocketRelay, webSocketRelays } from './relay-filters';

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
