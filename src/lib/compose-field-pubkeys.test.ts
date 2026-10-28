import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import { fieldHoldsPubkeys, hexPubkeysFromComposerText } from './compose-field-pubkeys';

const hex = 'a'.repeat(64);
const npub = nip19.npubEncode(hex);

describe('hexPubkeysFromComposerText', () => {
  it('resolves a bare hex or npub', () => {
    expect(hexPubkeysFromComposerText(hex)).toEqual([hex]);
    expect(hexPubkeysFromComposerText(npub)).toEqual([hex]);
  });

  it('collects unique pubkeys from multiline / delimited text', () => {
    const other = 'b'.repeat(64);
    expect(hexPubkeysFromComposerText(`${hex}\n${npub}\n${other}`)).toEqual([hex, other]);
  });

  it('returns empty for blank or non-pubkey text', () => {
    expect(hexPubkeysFromComposerText('')).toEqual([]);
    expect(hexPubkeysFromComposerText('not a key')).toEqual([]);
  });
});

describe('fieldHoldsPubkeys', () => {
  it('detects p / P / pubkey / p_tag / p_list fields', () => {
    expect(fieldHoldsPubkeys({ tag: 'p' })).toBe(true);
    expect(fieldHoldsPubkeys({ tag: 'P' })).toBe(true);
    expect(fieldHoldsPubkeys({ valueType: 'pubkey' })).toBe(true);
    expect(fieldHoldsPubkeys({ emit: 'p_tag' })).toBe(true);
    expect(fieldHoldsPubkeys({ emit: 'p_list' })).toBe(true);
    expect(fieldHoldsPubkeys({ tag: 'e' })).toBe(false);
    expect(fieldHoldsPubkeys({ valueType: 'event_id' })).toBe(false);
  });
});
