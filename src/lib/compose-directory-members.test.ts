import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  buildDirectoryMemberTags,
  directoryMemberDisplayId,
  directoryMemberRowFromPointer,
  directoryMembersRawFromTags,
  directoryMemberRowsFromRaw,
  formatDirectoryMembers
} from './compose-directory-members';

const pub = 'a'.repeat(64);
const coord = `30040:${pub}:aesop`;
const eventId = 'b'.repeat(64);

describe('compose-directory-members', () => {
  it('round-trips a/e tags through the members field', () => {
    const raw = directoryMembersRawFromTags([
      ['a', coord, '', eventId],
      ['e', eventId, 'wss://relay.example', pub],
      ['title', 'ignored']
    ]);
    expect(buildDirectoryMemberTags(raw)).toEqual([
      ['a', coord, '', eventId],
      ['e', eventId, 'wss://relay.example', pub]
    ]);
  });

  it('shows the a-coordinate even when an event id hint is present', () => {
    const row = directoryMemberRowsFromRaw(`a\t${coord}\t\t${eventId}`)[0]!;
    expect(directoryMemberDisplayId(row)).toBe(coord);
    expect(row.extra).toBe(eventId);
  });

  it('keeps the wrapping a-address when editing the displayed event id', () => {
    const previous = directoryMemberRowsFromRaw(`a\t${coord}\t\t${eventId}`)[0]!;
    const next = directoryMemberRowFromPointer('c'.repeat(64), previous);
    expect(next).toEqual({
      tag: 'a',
      value: coord,
      extra: 'c'.repeat(64)
    });
    expect(formatDirectoryMembers([next])).toContain(coord);
  });

  it('expands naddr into an a membership and nevent into an e membership', () => {
    const naddr = nip19.naddrEncode({
      kind: 30040,
      pubkey: pub,
      identifier: 'aesop',
      relays: ['wss://relay.example']
    });
    expect(directoryMemberRowFromPointer(naddr)).toEqual({
      tag: 'a',
      value: coord,
      relay: 'wss://relay.example'
    });
    const nevent = nip19.neventEncode({
      id: eventId,
      relays: ['wss://e.example'],
      author: pub
    });
    expect(directoryMemberRowFromPointer(nevent)).toEqual({
      tag: 'e',
      value: eventId,
      relay: 'wss://e.example',
      extra: pub
    });
  });
});
