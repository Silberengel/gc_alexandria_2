import { describe, expect, it } from 'vitest';
import { KIND, NIP32_BOOKLIST_LABEL, NIP32_UGC_NAMESPACE } from './constants';
import {
  assertAndroidSafeBookshelfTags,
  buildBookshelfMembershipATag,
  canPublishBookshelfReplacement,
  createEmptyBookshelfDirectoryDraft,
  createBookshelfDirectoryDraft,
  directoryContainsPublication,
  listBookshelfShelfOptions,
  MY_BOOK_COLLECTION_D_TAG,
  togglePublicationInDirectoryTags
} from './bookshelf';
import {
  publicationCoordinateLookupKeys,
  coordinatesOverlap
} from './publication-coordinate';
import {
  aggregateRating,
  isPublicationRatingEvent,
  newestRatingPerAuthor,
  publicationRatingATagsForQuery,
  ratingHasScore,
  ratingStarsFromEvent,
  ratingTags
} from './ratings';
import { publicationLabelDraft, highlightDraft, ratingDraft } from './drafts';
import { slugifyPublicationLabel, HOME_SHELF_SLUGS } from './publication-lists';
import { membershipsFromEvents, nestedShelvesForViewer, isViewerBoundShelfId } from './shelves';
import { isPublicationLabelEvent } from './nip32';
import {
  interactionMarksFromEvents,
  marksForPublication
} from './interaction-marks';
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
const pub = ev({
  id: '2'.repeat(64),
  pubkey: pk,
  kind: KIND.PUBLICATION,
  tags: [['d', 'mansfield-park']]
});

describe('publication coordinates', () => {
  it('builds NFC/NFD lookup keys for d', () => {
    const nfd = 'cafe\u0301';
    const coord = `30040:${pk}:${nfd}`;
    const keys = publicationCoordinateLookupKeys(coord);
    expect(keys.length).toBeGreaterThanOrEqual(1);
    expect(keys.some((k) => k.includes(nfd.normalize('NFC')) || k.includes(nfd))).toBe(true);
    expect(coordinatesOverlap(coord, `30040:${pk}:${nfd.normalize('NFC')}`)).toBe(true);
  });
});

describe('ratings jumble shape', () => {
  it('publishes m=book, rating stars/5, s, a+A, e, k, p', () => {
    const tags = ratingTags(pub, 4, true);
    expect(tags.find((t) => t[0] === 'm')?.[1]).toBe('book');
    expect(tags.find((t) => t[0] === 'rating')?.[1]).toBe('0.800');
    expect(tags.find((t) => t[0] === 's')?.[1]).toBe('4');
    expect(tags.filter((t) => t[0] === 'a' || t[0] === 'A')).toHaveLength(2);
    expect(tags.find((t) => t[0] === 'c')?.[1]).toBe('true');
    const draft = ratingDraft(pub, 5, 'Loved it');
    expect(draft.content).toBe('Loved it');
    expect(draft.kind).toBe(KIND.RATING);
  });

  it('recognizes publication ratings and aggregates scored only', () => {
    const addr = `30040:${pk}:mansfield-park`;
    const scored = ev({
      pubkey: '3'.repeat(64),
      kind: KIND.RATING,
      tags: [
        ['d', addr],
        ['m', 'book'],
        ['rating', '0.800'],
        ['a', addr]
      ]
    });
    const unscored = ev({
      id: '4'.repeat(64),
      pubkey: '5'.repeat(64),
      kind: KIND.RATING,
      tags: [
        ['d', addr],
        ['m', 'book'],
        ['a', addr]
      ],
      content: 'no stars'
    });
    expect(isPublicationRatingEvent(scored)).toBe(true);
    expect(ratingHasScore(scored)).toBe(true);
    expect(ratingStarsFromEvent(scored)).toBe(4);
    expect(ratingHasScore(unscored)).toBe(false);
    const newest = newestRatingPerAuthor([scored, unscored], addr);
    expect(newest).toHaveLength(2);
    const agg = aggregateRating(newest);
    expect(agg.count).toBe(1);
    expect(agg.average).toBeCloseTo(0.8);
  });

  it('queries NFC/NFD a-tag variants', () => {
    const keys = publicationRatingATagsForQuery(pub);
    expect(keys[0]).toContain('mansfield-park');
  });
});

describe('highlight draft', () => {
  it('tags a, e, p, k and optional context', () => {
    const section = ev({
      id: '9'.repeat(64),
      pubkey: pk,
      kind: KIND.SECTION,
      tags: [['d', 'ch1']]
    });
    const draft = highlightDraft(section, 'quoted', 'surrounding paragraph');
    expect(draft.tags.find((t) => t[0] === 'a')?.[1]).toBe(`30041:${pk}:ch1`);
    expect(draft.tags.find((t) => t[0] === 'e')?.[1]).toBe(section.id);
    expect(draft.tags.find((t) => t[0] === 'context')?.[1]).toBe('surrounding paragraph');
  });
});

describe('publication labels', () => {
  it('slugifies and drafts ugc labels for home genres', () => {
    expect(HOME_SHELF_SLUGS).toContain('adventure');
    expect(slugifyPublicationLabel('English Literature')).toBe('english-literature');
    const draft = publicationLabelDraft(pub, 'romance');
    expect(draft.tags).toEqual([
      ['L', NIP32_UGC_NAMESPACE],
      ['l', 'romance', NIP32_UGC_NAMESPACE],
      ['a', `30040:${pk}:mansfield-park`]
    ]);
    const booklist = publicationLabelDraft(pub);
    expect(booklist.tags.find((t) => t[0] === 'l')?.[1]).toBe(NIP32_BOOKLIST_LABEL);
  });

  it('treats any l-tagged publication label as membership', () => {
    const label = ev({
      kind: KIND.LABEL,
      pubkey: pk,
      tags: [
        ['L', 'ugc'],
        ['l', 'adventure', 'ugc'],
        ['a', `30040:${pk}:mansfield-park`]
      ]
    });
    expect(isPublicationLabelEvent(label)).toBe(true);
    const memberships = membershipsFromEvents([label]);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.address).toBe(`30040:${pk}:mansfield-park`);
  });
});

describe('bookshelf 30045', () => {
  it('builds Android-safe a tags and toggles membership', () => {
    const aTag = buildBookshelfMembershipATag(pub);
    expect(aTag).toEqual(['a', `30040:${pk}:mansfield-park`, '', pub.id]);
    expect(assertAndroidSafeBookshelfTags([['d', MY_BOOK_COLLECTION_D_TAG], aTag])).toBe(true);
    expect(
      assertAndroidSafeBookshelfTags([
        ['d', MY_BOOK_COLLECTION_D_TAG],
        ['a', `30040:${pk}:mansfield-park`, '', 'My Books']
      ])
    ).toBe(false);

    const toggled = togglePublicationInDirectoryTags(null, MY_BOOK_COLLECTION_D_TAG, pub);
    expect(toggled.ok).toBe(true);
    if (!toggled.ok) return;
    expect(toggled.added).toBe(true);
    expect(directoryContainsPublication({ tags: toggled.tags }, pub)).toBe(true);

    const removed = togglePublicationInDirectoryTags({ tags: toggled.tags }, MY_BOOK_COLLECTION_D_TAG, pub);
    expect(removed.ok && !removed.added).toBe(true);
  });

  it('creates empty nested shelves without title tags', () => {
    const empty = createEmptyBookshelfDirectoryDraft('Summer Reads');
    expect(empty.kind).toBe(KIND.DIRECTORY);
    expect(empty.tags).toEqual([['d', 'summer-reads']]);
    expect(empty.tags.some((t) => t[0] === 'title')).toBe(false);
  });

  it('wipe-guards replacements until existing is known', () => {
    expect(canPublishBookshelfReplacement(null, false)).toBe(false);
    expect(canPublishBookshelfReplacement(null, true)).toBe(true);
    expect(canPublishBookshelfReplacement(pub, false)).toBe(true);
  });

  it('lists nested shelf options and drafts link from root', () => {
    const nested = ev({
      id: '7'.repeat(64),
      pubkey: pk,
      kind: KIND.DIRECTORY,
      tags: [['d', 'adventure']]
    });
    const root = ev({
      id: '8'.repeat(64),
      pubkey: pk,
      kind: KIND.DIRECTORY,
      tags: [
        ['d', MY_BOOK_COLLECTION_D_TAG],
        ['a', `30045:${pk}:adventure`, '', nested.id]
      ]
    });
    const options = listBookshelfShelfOptions(root, (coord) =>
      coord === `30045:${pk}:adventure` ? nested : undefined
    );
    expect(options[0]?.isRoot).toBe(true);
    expect(options.some((o) => o.d === 'adventure')).toBe(true);

    const draft = createBookshelfDirectoryDraft(nested, 'adventure', pub);
    expect('error' in draft).toBe(false);
    if ('error' in draft) return;
    expect(directoryContainsPublication({ tags: draft.tags }, pub)).toBe(true);
  });

  it('builds nested viewer shelves from directories', () => {
    const nested = ev({
      id: '7'.repeat(64),
      pubkey: pk,
      kind: KIND.DIRECTORY,
      tags: [
        ['d', 'adventure'],
        ['a', `30040:${pk}:mansfield-park`, '', pub.id]
      ]
    });
    const pubs = new Map([[`30040:${pk}:mansfield-park`, pub]]);
    const shelves = nestedShelvesForViewer([nested], pubs, pk);
    expect(shelves).toHaveLength(1);
    expect(shelves[0]?.id).toBe('folder:adventure');
    expect(shelves[0]?.d).toBe('adventure');
    expect(shelves[0]?.events[0]?.id).toBe(pub.id);
    expect(isViewerBoundShelfId('folder:adventure')).toBe(true);
    expect(isViewerBoundShelfId('nested:adventure')).toBe(false);
  });
});

describe('interaction marks', () => {
  it('marks labeled, shelved, rated works', () => {
    const addr = `30040:${pk}:mansfield-park`;
    const events = [
      ev({
        kind: KIND.LABEL,
        tags: [
          ['L', 'ugc'],
          ['l', 'romance', 'ugc'],
          ['a', addr]
        ]
      }),
      ev({
        id: '3'.repeat(64),
        kind: KIND.DIRECTORY,
        tags: [['d', 'adventure'], ['a', addr, '', pub.id]]
      }),
      ev({
        id: '4'.repeat(64),
        kind: KIND.RATING,
        tags: [['d', addr], ['m', 'book'], ['rating', '1.000'], ['a', addr]]
      })
    ];
    const map = interactionMarksFromEvents(events);
    const marks = marksForPublication(map, pub);
    expect(marks).toEqual(['labeled', 'shelved', 'rated']);
  });
});
