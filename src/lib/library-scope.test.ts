import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import {
  isLibraryComment,
  isLibraryHighlight,
  newestCommentPerWork,
  newestHighlightPerAddress
} from './library-scope';

function ev(partial: Partial<Event> & Pick<Event, 'kind' | 'tags'>): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1,
    content: 'quote',
    sig: 'c'.repeat(128),
    ...partial
  };
}

const pubA = `30040:${'1'.repeat(64)}:jane-eyre`;
const noteA = `1:${'2'.repeat(64)}:`;

describe('library-scope', () => {
  it('keeps comments rooted on publications or wikis', () => {
    expect(isLibraryComment(ev({ kind: 1111, tags: [['K', '30040'], ['A', pubA]] }))).toBe(true);
    expect(isLibraryComment(ev({ kind: 1111, tags: [['k', '30818']] }))).toBe(true);
    expect(isLibraryComment(ev({ kind: 1111, tags: [['K', '1'], ['e', 'd'.repeat(64)]] }))).toBe(false);
  });

  it('keeps highlights with a library a-tag and drops website i-tag highlights', () => {
    expect(isLibraryHighlight(ev({ kind: 9802, tags: [['a', pubA]] }))).toBe(true);
    expect(isLibraryHighlight(ev({ kind: 9802, tags: [['i', 'https://example.com']] }))).toBe(false);
    expect(isLibraryHighlight(ev({ kind: 9802, tags: [['a', noteA]] }))).toBe(false);
  });

  it('keeps one newest highlight per a-tag', () => {
    const older = ev({ kind: 9802, created_at: 10, id: '1'.repeat(64), tags: [['a', pubA]] });
    const newer = ev({ kind: 9802, created_at: 20, id: '2'.repeat(64), tags: [['a', pubA]] });
    expect(newestHighlightPerAddress([older, newer]).map((e) => e.id)).toEqual([newer.id]);
  });

  it('keeps one newest comment per work, not the thread', () => {
    const older = ev({ kind: 1111, created_at: 10, id: '3'.repeat(64), tags: [['A', pubA]] });
    const newer = ev({ kind: 1111, created_at: 20, id: '4'.repeat(64), tags: [['A', pubA]] });
    const reply = ev({
      kind: 1111,
      created_at: 18,
      id: '6'.repeat(64),
      tags: [['A', pubA], ['e', '3'.repeat(64)]]
    });
    const other = ev({
      kind: 1111,
      created_at: 15,
      id: '5'.repeat(64),
      tags: [['A', `30040:${'2'.repeat(64)}:other`]]
    });
    expect(newestCommentPerWork([older, newer, reply, other]).map((e) => e.id)).toEqual([
      newer.id,
      other.id
    ]);
  });

  it('rolls section comments up to the parent edition', () => {
    const section = `30041:${'1'.repeat(64)}:ch-1`;
    const onSection = ev({
      kind: 1111,
      created_at: 30,
      id: '7'.repeat(64),
      tags: [['A', pubA], ['a', section]]
    });
    const onEdition = ev({ kind: 1111, created_at: 20, id: '8'.repeat(64), tags: [['A', pubA]] });
    expect(newestCommentPerWork([onSection, onEdition]).map((e) => e.id)).toEqual([onSection.id]);
  });
});
