import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  authorsRawFromTags,
  buildPListTags,
  formatPeopleRows,
  peopleRowsFromRaw
} from './compose-people-list';

describe('compose-people-list', () => {
  const hex = 'a'.repeat(64);
  const npub = nip19.npubEncode(hex);

  it('parses pipe and space follow lines', () => {
    expect(peopleRowsFromRaw(`${hex}|wss://r.example|Ada`)).toEqual([
      { pubkey: hex, relay: 'wss://r.example', petname: 'Ada' }
    ]);
    expect(peopleRowsFromRaw(`${npub} wss://r.example Ada Lovelace`)).toEqual([
      { pubkey: npub, relay: 'wss://r.example', petname: 'Ada Lovelace' }
    ]);
  });

  it('builds deduped p tags from hex and npub', () => {
    const tags = buildPListTags(`${hex}\n${npub}|wss://r.example|Ada`);
    expect(tags).toEqual([['p', hex]]);
  });

  it('keeps relay and petname on the tag', () => {
    expect(buildPListTags(`${hex}|wss://r.example|Ada`)).toEqual([
      ['p', hex, 'wss://r.example', 'Ada']
    ]);
  });

  it('round-trips tags into the authors field', () => {
    const raw = authorsRawFromTags([
      ['p', hex],
      ['p', 'b'.repeat(64), 'wss://x', 'Bob']
    ]);
    expect(formatPeopleRows(peopleRowsFromRaw(raw))).toBe(raw);
    expect(buildPListTags(raw)).toEqual([
      ['p', hex],
      ['p', 'b'.repeat(64), 'wss://x', 'Bob']
    ]);
  });
});
