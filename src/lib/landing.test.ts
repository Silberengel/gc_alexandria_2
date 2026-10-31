import { afterEach, describe, expect, it } from 'vitest';
import {
  preferLive,
  subjectsFromPublications,
  withSubjects,
  orderShelfCovers,
  landingCoverSeed,
  titleForAddress,
  publisherForAddress,
  displayRefTitle,
  focusHrefForRef,
  pathForRef,
  topLevelPublicationAddress,
  mergeLandingShelves,
  landingRefHasRenderableTarget,
  recordWarmLandingVisit,
  clearWarmLandingVisit,
  isWarmLandingRevisit
} from './landing';
import {
  bookshelfChipsFromDirectories,
  guideCoverTrackCount,
  GUIDES_MIN_COVERS_PER_TRACK,
  orderLandingShelves,
  dedupeLandingShelfEvents
} from './shelves';
import { MY_BOOK_COLLECTION_D_TAG } from './bookshelf';
import { KIND } from './constants';
import type { Event } from 'nostr-tools';
import type { LandingShelfSnap } from './nostr/cache';

function ev(tags: string[][], idNibble = 'a'): Event {
  return {
    id: idNibble.repeat(64).slice(0, 64),
    pubkey: 'b'.repeat(64),
    created_at: 1,
    kind: 30040,
    tags,
    content: '',
    sig: 'c'.repeat(128)
  };
}

describe('landing cache fallback', () => {
  it('keeps the snapshot when live results are empty', () => {
    const cached = [ev([['title', 'Cached']])];
    expect(preferLive([], cached)).toEqual(cached);
    expect(preferLive([ev([['title', 'Live']])], cached)[0]?.tags[0]?.[1]).toBe('Live');
  });

  it('ranks subjects from cached publications', () => {
    expect(
      subjectsFromPublications([
        ev([['t', 'fiction'], ['t', 'romance']]),
        ev([['t', 'fiction']])
      ])
    ).toEqual(['fiction', 'romance']);
  });

  it('withSubjects counts t-tags on shelf covers when publications lack them', () => {
    const tagged = ev([['t', 'novel'], ['t', 'classical'], ['title', 'Jane Eyre']], 'a');
    tagged.kind = 30040;
    const bare = ev([['title', 'Chronological Bible']], 'b');
    bare.kind = 30040;
    const view = withSubjects({
      viewerPubkey: null,
      publications: [bare],
      highlights: [],
      comments: [],
      ratings: [],
      referenced: [],
      shelves: [{ id: 'mine', title: 'From your bookshelves', events: [tagged] }],
      labels: []
    });
    expect(view.subjects).toEqual(['novel', 'classical']);
  });
});

describe('mergeLandingShelves', () => {
  it('keeps prior shelves and unions events during progressive paints', () => {
    const a = ev([['d', 'book-a'], ['title', 'A']], '1');
    a.pubkey = '1'.repeat(64);
    const b = ev([['d', 'book-b'], ['title', 'B']], '2');
    b.pubkey = '2'.repeat(64);
    const c = ev([['d', 'book-c'], ['title', 'C']], '3');
    c.pubkey = '1'.repeat(64);
    const prev: LandingShelfSnap[] = [
      { id: 'network', title: 'Network', events: [a, b] },
      { id: 'mine', title: 'From your bookshelves', events: [a] }
    ];
    const next: LandingShelfSnap[] = [
      { id: 'mine', title: 'From your bookshelves', events: [c] }
    ];
    const merged = mergeLandingShelves(prev, next);
    expect(merged.map((s) => s.id)).toEqual(['mine', 'network']);
    const mine = merged.find((s) => s.id === 'mine')!;
    expect(mine.events.map((e) => e.id).sort()).toEqual([a.id, c.id].sort());
    // a is on mine (same author scrubbed from network) — network only keeps b
    expect(merged.find((s) => s.id === 'network')?.events.map((e) => e.id)).toEqual([b.id]);
  });

  it('keeps Mercury network filler when follows resolve without a network shelf', () => {
    const nested = ev([['d', 'day-1'], ['title', 'Day 1']], '1');
    nested.pubkey = 'a'.repeat(64);
    const followBook = ev([['d', 'jane-eyre'], ['title', 'Jane Eyre']], '2');
    followBook.pubkey = 'f'.repeat(64);
    const prev: LandingShelfSnap[] = [
      { id: 'network', title: 'From the network', events: [nested] }
    ];
    const next: LandingShelfSnap[] = [
      { id: 'follows', title: "From your follows' bookshelves", events: [followBook] },
      { id: 'mine', title: 'From your bookshelves', events: [] }
    ];
    const merged = mergeLandingShelves(prev, next);
    expect(merged.map((s) => s.id)).toEqual(['follows', 'network']);
    expect(merged.find((s) => s.id === 'network')?.events.map((e) => e.id)).toEqual([nested.id]);
  });

  it('dedupes network covers that already appear on follows', () => {
    const shared = ev([['d', 'classic'], ['title', 'Classic']], '1');
    shared.pubkey = 'f'.repeat(64);
    const stranger = ev([['d', 'other'], ['title', 'Other']], '3');
    stranger.pubkey = 'c'.repeat(64);
    const merged = mergeLandingShelves(
      [{ id: 'network', title: 'From the network', events: [shared, stranger] }],
      [
        { id: 'follows', title: "From your follows' bookshelves", events: [shared] },
        { id: 'network', title: 'From the network', events: [shared, stranger] }
      ]
    );
    const network = merged.find((s) => s.id === 'network');
    expect(network?.events.map((e) => e.id)).toEqual([stranger.id]);
  });

  it('keeps prior guide chips when a progressive pack omits them', () => {
    const cover = ev([['d', 'iliad'], ['title', 'Iliad']], '1');
    cover.pubkey = 'c'.repeat(64);
    const chips = [{ d: 'ancient-classics', title: 'Ancient classics', href: '/search?bookshelf=ancient-classics' }];
    const merged = mergeLandingShelves(
      [{ id: 'guides', title: 'From the guides', events: [cover], chips }],
      [{ id: 'guides', title: 'From the guides', events: [cover] }]
    );
    expect(merged.find((s) => s.id === 'guides')?.chips).toEqual(chips);
  });
});

describe('guideCoverTrackCount', () => {
  it('keeps one dense track while covers are still resolving', () => {
    expect(guideCoverTrackCount(6, 3)).toBe(1);
    expect(guideCoverTrackCount(GUIDES_MIN_COVERS_PER_TRACK - 1, 3)).toBe(1);
  });

  it('opens more tracks only when each can hold a full scrollable row', () => {
    expect(guideCoverTrackCount(GUIDES_MIN_COVERS_PER_TRACK, 3)).toBe(1);
    expect(guideCoverTrackCount(GUIDES_MIN_COVERS_PER_TRACK * 2, 3)).toBe(2);
    expect(guideCoverTrackCount(GUIDES_MIN_COVERS_PER_TRACK * 3, 3)).toBe(3);
    expect(guideCoverTrackCount(GUIDES_MIN_COVERS_PER_TRACK * 5, 3)).toBe(3);
  });
});

describe('bookshelfChipsFromDirectories', () => {
  const owner = 'a'.repeat(64);
  const npub = 'npub1example';

  function dir(d: string, childDs: string[] = [], title?: string): Event {
    const tags: string[][] = [['d', d]];
    if (title) tags.push(['title', title]);
    for (const child of childDs) {
      tags.push(['a', `${KIND.DIRECTORY}:${owner}:${child}`, '', 'b'.repeat(64)]);
    }
    return {
      id: d.padEnd(64, '0').slice(0, 64),
      kind: KIND.DIRECTORY,
      pubkey: owner,
      created_at: 1,
      content: '',
      tags,
      sig: 'c'.repeat(128)
    };
  }

  it('lists my-book-collection children in membership order with My bookshelf first', () => {
    const chips = bookshelfChipsFromDirectories(
      [
        dir(MY_BOOK_COLLECTION_D_TAG, ['summer-reads', 'classics']),
        dir('summer-reads', [], 'Summer reads'),
        dir('classics')
      ],
      owner,
      npub
    );
    expect(chips.map((c) => c.d)).toEqual([
      MY_BOOK_COLLECTION_D_TAG,
      'summer-reads',
      'classics'
    ]);
    expect(chips[0]?.title).toBe('My bookshelf');
    expect(chips[1]?.title).toBe('Summer reads');
    expect(chips[2]?.title).toBe('Classics');
    expect(chips[1]?.href).toContain('bookshelf=summer-reads');
    expect(chips[1]?.href).toContain(`npub=${encodeURIComponent(npub)}`);
  });

  it('still chips from a-tags when child directory events are missing', () => {
    const chips = bookshelfChipsFromDirectories(
      [dir(MY_BOOK_COLLECTION_D_TAG, ['orphaned-shelf'])],
      owner,
      npub
    );
    expect(chips.map((c) => c.d)).toEqual([MY_BOOK_COLLECTION_D_TAG, 'orphaned-shelf']);
    expect(chips[1]?.title).toBe('Orphaned shelf');
  });
});

describe('orderLandingShelves', () => {
  it('puts Reading now first, then own bookshelves (folding legacy folders), follows, network, guides', () => {
    const ordered = orderLandingShelves([
      { id: 'network', title: 'From the network', events: [] },
      { id: 'folder:Mystery', title: 'Mystery', events: [] },
      { id: 'follows', title: "From your follows' bookshelves", events: [] },
      { id: 'folder:adventure', title: 'adventure', events: [] },
      { id: 'gitcitadel', title: 'GitCitadel', events: [] },
      { id: 'guides', title: 'From the guides', events: [] },
      { id: 'mine', title: 'From your bookshelves', events: [] },
      { id: 'reading-now', title: 'Reading now', events: [] }
    ]);
    expect(ordered.map((s) => s.id)).toEqual([
      'reading-now',
      'mine',
      'follows',
      'network',
      'guides'
    ]);
  });
});

describe('dedupeLandingShelfEvents', () => {
  function pub(d: string, idNibble: string): Event {
    return {
      id: idNibble.repeat(64).slice(0, 64),
      pubkey: 'b'.repeat(64),
      created_at: 1,
      kind: 30040,
      tags: [['d', d]],
      content: '',
      sig: 'c'.repeat(128)
    };
  }

  it('keeps a cover only on the highest-priority curated shelf that has it', () => {
    const shared = pub('shared', '1');
    const onlyGc = pub('gc-only', '2');
    const onlyNet = pub('net-only', '3');
    const deduped = dedupeLandingShelfEvents([
      { id: 'network', title: 'From the network', events: [shared, onlyNet] },
      { id: 'gitcitadel', title: 'GitCitadel', events: [shared, onlyGc] },
      { id: 'mine', title: 'From your bookshelves', events: [shared] }
    ]);
    expect(deduped.map((s) => s.id)).toEqual(['mine', 'network']);
    expect(deduped.find((s) => s.id === 'mine')?.events.map((e) => e.id)).toEqual([shared.id]);
    expect(deduped.find((s) => s.id === 'network')?.events.map((e) => e.id).sort()).toEqual(
      [onlyGc.id, onlyNet.id].sort()
    );
  });

  it('folds legacy folder rows into From your bookshelves and drops duplicates lower down', () => {
    const shared = pub('shared', '1');
    const onlyMine = pub('mine-only', '2');
    const deduped = dedupeLandingShelfEvents([
      { id: 'folder:summer', title: 'Summer', events: [shared] },
      { id: 'mine', title: 'From your bookshelves', events: [shared, onlyMine] },
      { id: 'network', title: 'From the network', events: [shared] }
    ]);
    expect(deduped.map((s) => s.id)).toEqual(['mine']);
    expect(deduped.find((s) => s.id === 'mine')?.events.map((e) => e.id).sort()).toEqual(
      [shared.id, onlyMine.id].sort()
    );
    expect(deduped.find((s) => s.id === 'folder:summer')).toBeUndefined();
    expect(deduped.find((s) => s.id === 'network')).toBeUndefined();
  });

  it('keeps chip-only From the guides when every cover already sits on mine', () => {
    const shared = pub('shared', '1');
    const chips = [{ d: 'great-books', title: 'Great books' }];
    const deduped = dedupeLandingShelfEvents([
      { id: 'mine', title: 'From your bookshelves', events: [shared] },
      { id: 'guides', title: 'From the guides', events: [shared], chips }
    ]);
    expect(deduped.map((s) => s.id)).toEqual(['mine', 'guides']);
    expect(deduped.find((s) => s.id === 'guides')?.events).toEqual([]);
    expect(deduped.find((s) => s.id === 'guides')?.chips).toEqual(chips);
  });
});

describe('orderShelfCovers', () => {
  function pub(created_at: number, nibble: string): Event {
    return {
      id: nibble.repeat(64).slice(0, 64),
      pubkey: 'b'.repeat(64),
      created_at,
      kind: 30040,
      tags: [['d', nibble]],
      content: '',
      sig: 'c'.repeat(128)
    };
  }

  it('shows every item newest-first when there are fewer than 10', () => {
    const items = [pub(1, '1'), pub(3, '3'), pub(2, '2')];
    expect(orderShelfCovers(items, 99).map((e) => e.created_at)).toEqual([3, 2, 1]);
  });

  it('pins the 3 newest and shuffles the rest from the unix seed', () => {
    const items = Array.from({ length: 10 }, (_, i) => pub(i + 1, i.toString(16)));
    const a = orderShelfCovers(items, 1_700_000_000);
    const b = orderShelfCovers(items, 1_700_000_001);
    const again = orderShelfCovers(items, 1_700_000_000);
    expect(a.slice(0, 3).map((e) => e.created_at)).toEqual([10, 9, 8]);
    expect(b.slice(0, 3).map((e) => e.created_at)).toEqual([10, 9, 8]);
    expect(a.map((e) => e.id)).toEqual(again.map((e) => e.id));
    expect(a.slice(3).map((e) => e.id)).not.toEqual(b.slice(3).map((e) => e.id));
    expect(new Set(a.map((e) => e.id)).size).toBe(10);
  });

  it('reuses one landingCoverSeed for the session', () => {
    const a = landingCoverSeed();
    const b = landingCoverSeed();
    expect(a).toBe(b);
    expect(Number.isInteger(a)).toBe(true);
  });
});

describe('referenced work titles', () => {
  it('uses the resolved event title, else a humanized d-tag', () => {
    const pubkey = '1'.repeat(64);
    const coord = `30040:${pubkey}:jane-eyre`;
    const work = ev([['d', 'jane-eyre'], ['title', 'Jane Eyre']]);
    work.pubkey = pubkey;
    work.kind = 30040;
    expect(titleForAddress(coord, [work])).toBe('Jane Eyre');
    expect(titleForAddress(coord, [])).toBe('Jane Eyre');
    expect(publisherForAddress(coord, [work])).toBe(pubkey);
  });

  it('formats a section reference as Publication Title: Section Title', () => {
    const pubkey = '1'.repeat(64);
    const pubAddr = `30040:${pubkey}:jane-eyre`;
    const secAddr = `30041:${pubkey}:ch-1`;
    const publication = ev([
      ['d', 'jane-eyre'],
      ['title', 'Jane Eyre'],
      ['a', secAddr]
    ]);
    publication.pubkey = pubkey;
    publication.kind = 30040;
    const section = ev([['d', 'ch-1'], ['title', 'Chapter 1']]);
    section.id = 'd'.repeat(64);
    section.pubkey = pubkey;
    section.kind = 30041;
    const comment = {
      ...ev([]),
      kind: 1111,
      tags: [
        ['A', pubAddr],
        ['a', secAddr]
      ]
    };
    const highlight = {
      ...ev([]),
      id: 'd'.repeat(64),
      kind: 9802,
      content: '  It was a cold winter morning on the moor.  ',
      tags: [
        ['A', pubAddr],
        ['a', secAddr]
      ]
    };
    const referenced = [publication, section];
    expect(displayRefTitle(comment, referenced)).toBe('Jane Eyre: Chapter 1');
    expect(topLevelPublicationAddress(secAddr, referenced)).toBe(pubAddr);
    expect(pathForRef(comment, referenced)).toContain('/publication/d/jane-eyre/');
    expect(pathForRef(comment, referenced)).not.toContain('?');
    expect(focusHrefForRef(comment, referenced)).toContain(`comment=${comment.id}`);
    expect(focusHrefForRef(comment, referenced)).not.toContain('section=');
    const href = focusHrefForRef(highlight, referenced)!;
    const q = href.indexOf('?');
    expect(q).toBeGreaterThan(0);
    expect(href.slice(0, q)).toContain('/publication/d/jane-eyre/');
    expect(pathForRef(highlight, referenced)).toBe(href.slice(0, q));
    const params = new URLSearchParams(href.slice(q + 1));
    expect(params.get('section')).toBe(secAddr);
    expect(params.get('quote')).toBe('It was a cold winter morning on the moor.');
    expect(params.get('read')).toBe('1');
  });

  it('hides interactions whose library target was never resolved', () => {
    const pubkey = '1'.repeat(64);
    const pubAddr = `30040:${pubkey}:ghost-book`;
    const comment = {
      ...ev([]),
      kind: 1111,
      tags: [
        ['A', pubAddr],
        ['K', '30040']
      ]
    };
    const highlight = {
      ...ev([]),
      id: 'e'.repeat(64),
      kind: 9802,
      content: 'orphan quote',
      tags: [['a', pubAddr]]
    };
    const rating = {
      ...ev([]),
      id: 'f'.repeat(64),
      kind: 34259,
      tags: [
        ['a', pubAddr],
        ['k', '30040']
      ]
    };
    expect(landingRefHasRenderableTarget(comment, [])).toBe(false);
    expect(landingRefHasRenderableTarget(highlight, [])).toBe(false);
    expect(landingRefHasRenderableTarget(rating, [])).toBe(false);
    expect(pathForRef(comment, [])).toBeNull();
    expect(focusHrefForRef(highlight, [])).toBeNull();

    const publication = ev([
      ['d', 'ghost-book'],
      ['title', 'Ghost Book']
    ]);
    publication.pubkey = pubkey;
    publication.kind = 30040;
    expect(landingRefHasRenderableTarget(comment, [publication])).toBe(true);
    expect(pathForRef(comment, [publication])).toContain('/publication/d/ghost-book/');
  });
});

describe('warm landing revisit', () => {
  const viewer = 'd'.repeat(64);
  const metaKey = 'event-a,event-b';

  afterEach(() => {
    clearWarmLandingVisit();
  });

  it('skips refresh when same viewer, same lists, and cache has My shelf + feeds', () => {
    recordWarmLandingVisit(viewer, metaKey);
    const cached = {
      viewerPubkey: viewer,
      publications: [],
      comments: [],
      highlights: [ev([['a', '30040:x:y']])],
      ratings: [],
      referenced: [],
      subjects: [],
      shelves: [{ id: 'mine', title: 'My shelf', events: [ev([['d', 'book']], '1')] }],
      labels: []
    };
    expect(isWarmLandingRevisit(viewer, metaKey, cached)).toBe(true);
  });

  it('does not skip when cache has shelves but no feeds yet', () => {
    recordWarmLandingVisit(viewer, metaKey);
    const cached = {
      viewerPubkey: viewer,
      publications: [],
      comments: [],
      highlights: [],
      ratings: [],
      referenced: [],
      subjects: [],
      shelves: [{ id: 'mine', title: 'My shelf', events: [ev([['d', 'book']], '1')] }],
      labels: []
    };
    expect(isWarmLandingRevisit(viewer, metaKey, cached)).toBe(false);
  });

  it('does not skip when metadata fingerprint changed', () => {
    recordWarmLandingVisit(viewer, metaKey);
    const cached = {
      viewerPubkey: viewer,
      publications: [],
      comments: [],
      highlights: [ev([['a', '30040:x:y']])],
      ratings: [],
      referenced: [],
      subjects: [],
      shelves: [{ id: 'mine', title: 'My shelf', events: [ev([['d', 'book']], '1')] }],
      labels: []
    };
    expect(isWarmLandingRevisit(viewer, 'event-a,event-c', cached)).toBe(false);
  });

  it('does not skip without a prior warm visit', () => {
    const cached = {
      viewerPubkey: viewer,
      publications: [],
      comments: [],
      highlights: [ev([['a', '30040:x:y']])],
      ratings: [],
      referenced: [],
      subjects: [],
      shelves: [{ id: 'mine', title: 'My shelf', events: [ev([['d', 'book']], '1')] }],
      labels: []
    };
    expect(isWarmLandingRevisit(viewer, metaKey, cached)).toBe(false);
  });

  it('skips refresh when the signed-in fingerprint is empty (no list kinds)', () => {
    recordWarmLandingVisit(viewer, '');
    const cached = {
      viewerPubkey: viewer,
      publications: [],
      comments: [],
      highlights: [ev([['a', '30040:x:y']])],
      ratings: [],
      referenced: [],
      subjects: [],
      shelves: [{ id: 'mine', title: 'My shelf', events: [ev([['d', 'book']], '1')] }],
      labels: []
    };
    expect(isWarmLandingRevisit(viewer, '', cached)).toBe(true);
  });
});
