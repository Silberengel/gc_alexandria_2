import { describe, expect, it } from 'vitest';
import { buildTagsForKind } from '@silberengel/kind-compose-catalog';
import { formatRelayRows, relayRowsFromRaw } from './compose-relay-list';

describe('compose-relay-list', () => {
  it('keeps one url per row for plain lists', () => {
    const raw = formatRelayRows(
      [
        { url: 'wss://a.example', marker: 'both' },
        { url: 'wss://b.example', marker: 'both' }
      ],
      false
    );
    expect(relayRowsFromRaw(raw, false).map((r) => r.url)).toEqual([
      'wss://a.example',
      'wss://b.example'
    ]);
    expect(buildTagsForKind(10006, { relays: raw }, { app: 'alexandria' })).toEqual([
      ['relay', 'wss://a.example'],
      ['relay', 'wss://b.example']
    ]);
  });

  it('preserves read/write markers for NIP-65', () => {
    const raw = formatRelayRows(
      [
        { url: 'wss://both.example', marker: 'both' },
        { url: 'wss://read.example', marker: 'read' },
        { url: 'wss://write.example', marker: 'write' }
      ],
      true
    );
    expect(relayRowsFromRaw(raw, true)).toEqual([
      { url: 'wss://both.example', marker: 'both' },
      { url: 'wss://read.example', marker: 'read' },
      { url: 'wss://write.example', marker: 'write' }
    ]);
    expect(buildTagsForKind(10002, { relays: raw }, { app: 'alexandria' })).toEqual([
      ['r', 'wss://both.example'],
      ['r', 'wss://read.example', 'read'],
      ['r', 'wss://write.example', 'write']
    ]);
  });
});
