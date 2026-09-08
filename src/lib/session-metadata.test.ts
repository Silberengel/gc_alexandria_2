import { describe, expect, it } from 'vitest';
import { KIND, NIP32_UGC_NAMESPACE } from './constants';
import { mergeRememberedMetadata, publicationLabelDedupeKey } from './session-metadata';
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

describe('session metadata remember', () => {
  it('dedupes labels by slug and publication target, not by empty d', () => {
    const older = ev({
      id: '2'.repeat(64),
      pubkey: pk,
      kind: KIND.LABEL,
      created_at: 1,
      tags: [
        ['L', NIP32_UGC_NAMESPACE],
        ['l', 'booklist', NIP32_UGC_NAMESPACE],
        ['a', addr]
      ]
    });
    const newer = ev({
      id: '3'.repeat(64),
      pubkey: pk,
      kind: KIND.LABEL,
      created_at: 2,
      tags: [
        ['L', NIP32_UGC_NAMESPACE],
        ['l', 'booklist', NIP32_UGC_NAMESPACE],
        ['a', addr]
      ]
    });
    const other = ev({
      id: '4'.repeat(64),
      pubkey: pk,
      kind: KIND.LABEL,
      created_at: 3,
      tags: [
        ['L', NIP32_UGC_NAMESPACE],
        ['l', 'romance', NIP32_UGC_NAMESPACE],
        ['a', addr]
      ]
    });
    expect(publicationLabelDedupeKey(older)).toBe(`booklist\0${addr}`);
    const merged = mergeRememberedMetadata([older, other], newer);
    expect(merged.map((e) => e.id).sort()).toEqual([newer.id, other.id].sort());
  });

  it('does not collapse unrelated labels that lack a shared target key', () => {
    const a = ev({
      id: '2'.repeat(64),
      kind: KIND.LABEL,
      tags: [['l', 'booklist', 'ugc'], ['a', addr]]
    });
    const b = ev({
      id: '3'.repeat(64),
      kind: KIND.LABEL,
      created_at: 2,
      tags: [['l', 'booklist', 'ugc'], ['a', `30040:${pk}:other`]]
    });
    const merged = mergeRememberedMetadata([a], b);
    expect(merged).toHaveLength(2);
  });

  it('removes deleted label ids and does not keep the kind-5 event', () => {
    const label = ev({
      id: '2'.repeat(64),
      kind: KIND.LABEL,
      tags: [['l', 'booklist', 'ugc'], ['a', addr]]
    });
    const keep = ev({
      id: '3'.repeat(64),
      kind: KIND.LABEL,
      tags: [['l', 'romance', 'ugc'], ['a', addr]]
    });
    const del = ev({
      id: '5'.repeat(64),
      kind: KIND.DELETION,
      tags: [['e', label.id], ['k', String(KIND.LABEL)]]
    });
    const merged = mergeRememberedMetadata([label, keep], del);
    expect(merged.map((e) => e.id)).toEqual([keep.id]);
  });

  it('deletes mixed-case event ids when the e-tag is lowercased', () => {
    const mixedId = ('AB' + 'cd'.repeat(31)).slice(0, 64);
    const label = {
      id: mixedId,
      pubkey: pk,
      created_at: 1,
      kind: KIND.LABEL,
      tags: [['l', 'booklist', 'ugc'], ['a', addr]],
      content: '',
      sig: 'c'.repeat(128)
    } as Event;
    const del = ev({
      id: '5'.repeat(64),
      kind: KIND.DELETION,
      tags: [['e', mixedId.toLowerCase()], ['k', String(KIND.LABEL)]]
    });
    const merged = mergeRememberedMetadata([label], del);
    expect(merged).toHaveLength(0);
  });

  it('still replaces bookmarks and directories by kind+d', () => {
    const oldBm = ev({
      id: '2'.repeat(64),
      kind: KIND.BOOKMARK,
      created_at: 1,
      tags: [['a', addr]]
    });
    const newBm = ev({
      id: '3'.repeat(64),
      kind: KIND.BOOKMARK,
      created_at: 2,
      tags: [['a', addr], ['a', `30040:${pk}:other`]]
    });
    expect(mergeRememberedMetadata([oldBm], newBm).map((e) => e.id)).toEqual([newBm.id]);

    const oldDir = ev({
      id: '6'.repeat(64),
      kind: KIND.DIRECTORY,
      created_at: 1,
      tags: [['d', 'adventure']]
    });
    const newDir = ev({
      id: '7'.repeat(64),
      kind: KIND.DIRECTORY,
      created_at: 2,
      tags: [['d', 'adventure'], ['a', addr]]
    });
    const otherDir = ev({
      id: '8'.repeat(64),
      kind: KIND.DIRECTORY,
      tags: [['d', 'my-book-collection']]
    });
    const dirs = mergeRememberedMetadata([oldDir, otherDir], newDir);
    expect(dirs.map((e) => e.id).sort()).toEqual([newDir.id, otherDir.id].sort());
  });
});
