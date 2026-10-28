import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  isComposePointerTagName,
  normalizeComposeTagRow,
  normalizeComposeTagValue
} from './compose-tag-normalize';

const pk = 'a'.repeat(64);
const id = 'b'.repeat(64);

describe('normalizeComposeTagRow', () => {
  it('recognizes a/e/p/q and uppercase names', () => {
    for (const name of ['a', 'A', 'e', 'E', 'p', 'P', 'q', 'Q']) {
      expect(isComposePointerTagName(name)).toBe(true);
    }
    expect(isComposePointerTagName('t')).toBe(false);
  });

  it('expands naddr into a / A coordinates', () => {
    const naddr = nip19.naddrEncode({
      kind: 30040,
      pubkey: pk,
      identifier: 'mansfield-park',
      relays: ['wss://relay.example']
    });
    expect(normalizeComposeTagRow(['a', naddr])).toEqual([
      'a',
      `30040:${pk}:mansfield-park`,
      'wss://relay.example'
    ]);
    expect(normalizeComposeTagValue('A', `nostr:${naddr}`)).toBe(
      `30040:${pk}:mansfield-park`
    );
  });

  it('expands nevent / note into e / E ids', () => {
    const nevent = nip19.neventEncode({
      id,
      relays: ['wss://r.example'],
      author: pk
    });
    expect(normalizeComposeTagRow(['e', nevent])).toEqual([
      'e',
      id,
      'wss://r.example',
      pk
    ]);
    const note = nip19.noteEncode(id);
    expect(normalizeComposeTagValue('E', note)).toBe(id);
  });

  it('expands npub / nprofile into p / P hex', () => {
    const npub = nip19.npubEncode(pk);
    expect(normalizeComposeTagRow(['p', npub])).toEqual(['p', pk]);
    const nprofile = nip19.nprofileEncode({
      pubkey: pk,
      relays: ['wss://profile.example']
    });
    expect(normalizeComposeTagRow(['P', nprofile])).toEqual([
      'P',
      pk,
      'wss://profile.example'
    ]);
  });

  it('expands q / Q from naddr, nevent, or npub', () => {
    const naddr = nip19.naddrEncode({
      kind: 30023,
      pubkey: pk,
      identifier: 'essay'
    });
    expect(normalizeComposeTagValue('q', naddr)).toBe(`30023:${pk}:essay`);
    const nevent = nip19.neventEncode({ id, author: pk });
    expect(normalizeComposeTagRow(['Q', nevent])).toEqual(['Q', id, '', pk]);
    expect(normalizeComposeTagValue('q', nip19.npubEncode(pk))).toBe(pk);
  });

  it('leaves unrelated tags and undecodable values alone', () => {
    expect(normalizeComposeTagRow(['t', 'books'])).toEqual(['t', 'books']);
    expect(normalizeComposeTagRow(['a', 'not-an-naddr'])).toEqual(['a', 'not-an-naddr']);
    expect(normalizeComposeTagRow(['e', 'still-typing-nevent1abc'])).toEqual([
      'e',
      'still-typing-nevent1abc'
    ]);
  });

  it('does not overwrite an existing relay hint', () => {
    const nevent = nip19.neventEncode({
      id,
      relays: ['wss://from-nevent'],
      author: pk
    });
    expect(normalizeComposeTagRow(['e', nevent, 'wss://keep-me'])).toEqual([
      'e',
      id,
      'wss://keep-me',
      pk
    ]);
  });
});
