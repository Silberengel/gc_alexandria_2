import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  formatSearchPointerQuery,
  parseSearchPointer,
  validateDTagInput,
  validateKindInput,
  validatePubkeyHex,
  validateRelaysInput
} from './search-pointer';

const pk = '573634b648634cbad10f2451776089ea21090d9407f715e83c577b4611ae6edc';
const id = 'ab'.repeat(32);
const relayA = 'wss://relay.example';
const relayB = 'wss://nostr.mom';

describe('parseSearchPointer', () => {
  it('parses coordinates and naddr into kind/pubkey/d', () => {
    const d =
      'the-epistle-of-paul-the-apostle-to-the-romans.-chapter-14-14-by-cambridge-v-king-james-version';
    expect(parseSearchPointer(`30041:${pk}:${d}`)).toEqual({
      type: 'coord',
      kind: 30041,
      pubkey: pk,
      d
    });
    expect(parseSearchPointer(`10111:${pk}`)).toEqual({
      type: 'coord',
      kind: 10111,
      pubkey: pk,
      d: ''
    });
    const naddr = nip19.naddrEncode({ kind: 30023, pubkey: pk, identifier: 'am-fluss' });
    expect(parseSearchPointer(naddr)).toEqual({
      type: 'coord',
      kind: 30023,
      pubkey: pk,
      d: 'am-fluss'
    });
  });

  it('keeps relay hints from nevent and naddr', () => {
    const nevent = nip19.neventEncode({ id, author: pk, relays: [relayA, relayB] });
    expect(parseSearchPointer(nevent)).toEqual({
      type: 'id',
      id,
      author: pk,
      relays: [relayA, relayB]
    });
    const naddr = nip19.naddrEncode({
      kind: 30040,
      pubkey: pk,
      identifier: 'book',
      relays: [relayA]
    });
    expect(parseSearchPointer(naddr)).toEqual({
      type: 'coord',
      kind: 30040,
      pubkey: pk,
      d: 'book',
      relays: [relayA]
    });
  });

  it('parses note / nevent / hex as id parts', () => {
    expect(parseSearchPointer(id)).toEqual({ type: 'id', id });
    expect(parseSearchPointer(nip19.noteEncode(id))).toEqual({ type: 'id', id });
    expect(parseSearchPointer(nip19.neventEncode({ id, author: pk }))).toEqual({
      type: 'id',
      id,
      author: pk
    });
  });

  it('returns null for plain text', () => {
    expect(parseSearchPointer('mansfield park')).toBeNull();
  });
});

describe('part validation', () => {
  it('accepts integer kinds and hex pubkeys', () => {
    expect(validateKindInput('30041')).toEqual({ ok: true, value: 30041 });
    expect(validateKindInput('3.5').ok).toBe(false);
    expect(validateKindInput('wiki').ok).toBe(false);
    expect(validatePubkeyHex(pk)).toEqual({ ok: true, value: pk });
    expect(validatePubkeyHex('npub1…').ok).toBe(false);
  });

  it('requires hyphen-friendly d-tags', () => {
    expect(validateDTagInput('')).toEqual({ ok: true, value: '' });
    expect(validateDTagInput('romans-14').ok).toBe(true);
    expect(validateDTagInput('romans.-chapter-14').ok).toBe(true);
    expect(validateDTagInput('bad/tag').ok).toBe(false);
    expect(validateDTagInput('!!!').ok).toBe(false);
  });

  it('normalizes relay hint lines', () => {
    expect(validateRelaysInput(`${relayA}/\n${relayB}`)).toEqual({
      ok: true,
      value: [relayA, relayB]
    });
    expect(validateRelaysInput('').ok).toBe(true);
    expect(validateRelaysInput('https://not-a-relay').ok).toBe(false);
  });
});

describe('formatSearchPointerQuery', () => {
  it('rebuilds coordinate and id queries', () => {
    expect(formatSearchPointerQuery({ type: 'coord', kind: 10111, pubkey: pk, d: '' })).toBe(
      `10111:${pk}`
    );
    expect(formatSearchPointerQuery({ type: 'coord', kind: 30041, pubkey: pk, d: 'romans-14' })).toBe(
      `30041:${pk}:romans-14`
    );
    expect(formatSearchPointerQuery({ type: 'id', id })).toBe(id);
  });

  it('encodes bech32 when relay hints remain', () => {
    const naddrQ = formatSearchPointerQuery({
      type: 'coord',
      kind: 30040,
      pubkey: pk,
      d: 'book',
      relays: [relayA]
    });
    expect(nip19.decode(naddrQ)).toMatchObject({
      type: 'naddr',
      data: { kind: 30040, pubkey: pk, identifier: 'book', relays: [relayA] }
    });
    const neventQ = formatSearchPointerQuery({
      type: 'id',
      id,
      author: pk,
      relays: [relayA, relayB]
    });
    expect(nip19.decode(neventQ)).toMatchObject({
      type: 'nevent',
      data: { id, author: pk, relays: [relayA, relayB] }
    });
  });
});
