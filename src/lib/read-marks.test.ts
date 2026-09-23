import { describe, expect, it } from 'vitest';
import { KIND, NIP32_READ_LABEL, NIP32_UGC_NAMESPACE } from './constants';
import { landingLabels } from './labels';
import { isListPublicationLabelEvent, isPublicationLabelEvent } from './nip32';
import {
  countReadPublications,
  distinctReadPubkeys,
  editionPeopleRows,
  isReadLabelEvent,
  isReadLabelSlug
} from './read-marks';
import { interactionMarksFromEvents, marksForPublication } from './interaction-marks';
import type { Event } from 'nostr-tools';

function ev(over: Partial<Event> & { tags?: string[][] }): Event {
  return {
    id: (over.id ?? 'a'.repeat(64)).toLowerCase(),
    pubkey: (over.pubkey ?? 'b'.repeat(64)).toLowerCase(),
    created_at: over.created_at ?? 1,
    kind: over.kind ?? 1,
    tags: over.tags ?? [],
    content: over.content ?? '',
    sig: over.sig ?? 'c'.repeat(128)
  };
}

const pk = '1'.repeat(64);
const addr = `30040:${pk}:mansfield-park`;
const pub = ev({
  id: '2'.repeat(64),
  pubkey: pk,
  kind: KIND.PUBLICATION,
  tags: [['d', 'mansfield-park']]
});

describe('read marks', () => {
  it('treats read as a publication label but not a list label', () => {
    const read = ev({
      kind: KIND.LABEL,
      pubkey: '3'.repeat(64),
      tags: [
        ['L', NIP32_UGC_NAMESPACE],
        ['l', NIP32_READ_LABEL, NIP32_UGC_NAMESPACE],
        ['a', addr]
      ]
    });
    expect(isReadLabelSlug(NIP32_READ_LABEL)).toBe(true);
    expect(isReadLabelEvent(read)).toBe(true);
    expect(isPublicationLabelEvent(read)).toBe(true);
    expect(isListPublicationLabelEvent(read)).toBe(false);
  });

  it('keeps read off landing labels and the labeled interaction mark', () => {
    const read = ev({
      kind: KIND.LABEL,
      tags: [
        ['l', NIP32_READ_LABEL, NIP32_UGC_NAMESPACE],
        ['a', addr]
      ]
    });
    const booklist = ev({
      id: '3'.repeat(64),
      kind: KIND.LABEL,
      tags: [
        ['l', 'booklist', NIP32_UGC_NAMESPACE],
        ['a', addr]
      ]
    });
    expect(landingLabels([read, booklist])).toEqual(['booklist']);
    const marks = interactionMarksFromEvents([read]);
    expect(marksForPublication(marks, pub)).toEqual([]);
    const listMarks = interactionMarksFromEvents([booklist]);
    expect(marksForPublication(listMarks, pub)).toContain('labeled');
  });

  it('counts distinct readers and publications', () => {
    const a = ev({
      id: '3'.repeat(64),
      pubkey: '3'.repeat(64),
      kind: KIND.LABEL,
      tags: [['l', 'read'], ['a', addr]]
    });
    const b = ev({
      id: '4'.repeat(64),
      pubkey: '4'.repeat(64),
      kind: KIND.LABEL,
      tags: [['l', 'read'], ['a', addr]]
    });
    const dup = ev({
      id: '5'.repeat(64),
      pubkey: '3'.repeat(64),
      created_at: 9,
      kind: KIND.LABEL,
      tags: [['l', 'read'], ['a', addr]]
    });
    expect(distinctReadPubkeys([a, b, dup])).toHaveLength(2);
    expect(countReadPublications([a, b])).toBe(1);
  });

  it('builds people rows without read labels in Labeled', () => {
    const labeled = ev({
      id: '3'.repeat(64),
      pubkey: '3'.repeat(64),
      kind: KIND.LABEL,
      tags: [['l', 'booklist'], ['a', addr]]
    });
    const read = ev({
      id: '4'.repeat(64),
      pubkey: '4'.repeat(64),
      kind: KIND.LABEL,
      tags: [['l', 'read'], ['a', addr]]
    });
    const bookmark = ev({
      id: '5'.repeat(64),
      pubkey: '5'.repeat(64),
      kind: KIND.BOOKMARK,
      tags: [['a', addr]]
    });
    const rows = editionPeopleRows({
      publication: pub,
      labels: [labeled, read],
      bookmarks: [bookmark],
      highlights: [],
      directories: []
    });
    expect(rows.map((r) => r.key)).toEqual(['labeled', 'bookmarked']);
    expect(rows.find((r) => r.key === 'labeled')?.pubkeys).toEqual(['3'.repeat(64)]);
    expect(rows.find((r) => r.key === 'bookmarked')?.pubkeys).toEqual(['5'.repeat(64)]);
  });

  it('dedupes people by pubkey and skips muted authors', () => {
    const mutedPk = '6'.repeat(64);
    const highlightA = ev({
      id: '7'.repeat(64),
      pubkey: mutedPk,
      kind: KIND.HIGHLIGHT,
      tags: [['a', addr]]
    });
    const highlightB = ev({
      id: '8'.repeat(64),
      pubkey: '7'.repeat(64),
      kind: KIND.HIGHLIGHT,
      tags: [['a', addr]]
    });
    const highlightDup = ev({
      id: '9'.repeat(64),
      pubkey: '7'.repeat(64),
      created_at: 9,
      kind: KIND.HIGHLIGHT,
      tags: [['a', addr]]
    });
    const rows = editionPeopleRows({
      publication: pub,
      labels: [],
      bookmarks: [],
      highlights: [highlightA, highlightB, highlightDup],
      directories: [],
      mute: { pubkeys: new Set([mutedPk]), eventIds: new Set() }
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.pubkeys).toEqual(['7'.repeat(64)]);
  });
});
