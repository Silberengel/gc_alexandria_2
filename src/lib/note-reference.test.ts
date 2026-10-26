import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { isKind1Quote } from './comments';
import { eventKindDescription, eventKindLabelLine } from './kind-label';
import { noteReferencePreviewText, noteReferenceSpec } from './note-reference';

function ev(partial: Partial<Event> & Pick<Event, 'kind'>): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1,
    tags: [],
    content: 'hello',
    sig: 'c'.repeat(128),
    ...partial
  };
}

describe('event kind labels', () => {
  it('labels kind 1 replies and quotes distinctly', () => {
    const note = ev({ kind: KIND.TEXT_NOTE });
    const reply = ev({
      kind: KIND.TEXT_NOTE,
      tags: [['e', 'd'.repeat(64), '', 'root']]
    });
    const quote = ev({
      kind: KIND.TEXT_NOTE,
      tags: [['q', 'e'.repeat(64)]]
    });
    expect(eventKindDescription(note)).toBe('Short text note');
    expect(eventKindDescription(reply)).toBe('Short text reply');
    expect(eventKindDescription(quote)).toBe('Quote');
    expect(eventKindLabelLine(reply)).toBe('KIND: 1 · Short text reply');
    expect(isKind1Quote(quote)).toBe(true);
    expect(isKind1Quote(reply)).toBe(false);
  });
});

describe('noteReferenceSpec', () => {
  it('builds a reply-to lookup from NIP-10 parent e-tag', () => {
    const parentId = '1'.repeat(64);
    const reply = ev({
      kind: KIND.TEXT_NOTE,
      tags: [
        ['e', parentId, 'wss://relay.example', 'root'],
        ['e', '2'.repeat(64), '', 'reply']
      ]
    });
    // commentParentId prefers reply when both root and reply exist
    expect(noteReferenceSpec(reply)).toEqual({
      kind: 'reply',
      type: 'id',
      id: '2'.repeat(64),
      relayHints: [],
      pubkeyHint: null
    });
  });

  it('builds a quote-of lookup from q tag', () => {
    const quoted = '3'.repeat(64);
    const quote = ev({
      kind: KIND.TEXT_NOTE,
      tags: [['q', quoted, 'wss://relay.example', 'd'.repeat(64)]]
    });
    expect(noteReferenceSpec(quote)).toEqual({
      kind: 'quote',
      type: 'id',
      id: quoted,
      relayHints: ['wss://relay.example'],
      pubkeyHint: 'd'.repeat(64)
    });
  });

  it('prefers reply over quote when both tags are present', () => {
    const reply = ev({
      kind: KIND.TEXT_NOTE,
      tags: [
        ['e', '4'.repeat(64), '', 'root'],
        ['q', '5'.repeat(64)]
      ]
    });
    expect(noteReferenceSpec(reply)?.kind).toBe('reply');
  });

  it('previews the first non-blank content line', () => {
    expect(
      noteReferencePreviewText(
        ev({ kind: KIND.TEXT_NOTE, content: '\n  First line\nSecond' }),
        20
      )
    ).toBe('First line');
  });
});
