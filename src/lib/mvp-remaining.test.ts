import { describe, expect, it, vi } from 'vitest';
import { KIND, MUTED_PARENT_PLACEHOLDER, MISSING_PARENT_PLACEHOLDER, NIP32_BOOKLIST_LABEL, NIP32_UGC_NAMESPACE } from './constants';
import { nestComments, threadNodeKey } from './comments';
import { commentDraft } from './drafts';
import {
  DEFAULT_LIKE_REACTION_CONTENT,
  DEFAULT_LIKE_REACTION_DISPLAY_EMOJI,
  isPositiveLikeContent,
  likeCount,
  myLikeReaction,
  reactionDraft
} from './reactions';
import { rewriteWikilinks, isAllowedHref, sanitizeHtml } from './markup';
import {
  parseMuteList,
  filterMuted,
  isMutedEvent,
  decryptPrivateMuteTags,
  looksLikeNip04Ciphertext,
  looksLikeNip44Ciphertext
} from './mute';
import { extractNip32LabelValues, isBooklistEvent, publicationTargets } from './nip32';
import { splitNostrRefs, decodeNostrBech32 } from './nostr-refs';
import { landingLabels } from './labels';
import { assignShelves, membershipsFromEvents, withBookmarkTag } from './shelves';
import { aggregateRating, ratingValue, newestRatingPerAuthor, newestRatingPerPublication } from './ratings';
import { parseKind0, paymentRows } from './profile-fields';
import { uniqueMedia, contentWithoutMediaUrls, rewriteBareImageUrls, promoteImageAutolinks } from './media';
import { nip19, type Event } from 'nostr-tools';
import { GITCITADEL_CURATOR_HEX } from './hex';

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

describe('wikilinks', () => {
  it('rewrites djot/markdown wikilinks to d-tag search', () => {
    expect(rewriteWikilinks('see [[constantinople]]', 'markdown')).toContain(
      '#/search?d=constantinople'
    );
    expect(rewriteWikilinks('[[constantinople|Byzantium]]', 'djot')).toContain('Byzantium');
    expect(rewriteWikilinks('[[constantinople|Byzantium]]', 'djot')).toContain(
      '#/search?d=constantinople'
    );
    expect(rewriteWikilinks('[constantinople][]', 'markdown')).toContain('#/search?d=constantinople');
  });

  it('rewrites asciidoc wikilinks as link: macros so they become hyperlinks', () => {
    const out = rewriteWikilinks('see [[NKBIP-01]] and [[nkbip-01|NKBIP-01]]', 'asciidoc');
    expect(out).toContain('link:#/search?d=nkbip-01[NKBIP-01]');
    expect(out).not.toContain('[[NKBIP-01]]');
    expect(out).not.toMatch(/\[[^\]]+\]\(#\//);
  });

  it('normalizes existing wiki hash links to d-tag search', () => {
    expect(rewriteWikilinks('[NKBIP-01](#/wiki/d/nkbip-01)', 'markdown')).toContain(
      '#/search?d=nkbip-01'
    );
    expect(rewriteWikilinks('link:#/wiki/d/nkbip-01[NKBIP-01]', 'asciidoc')).toContain(
      'link:#/search?d=nkbip-01[NKBIP-01]'
    );
  });

  it('rewrites in-page section wikilinks to heading anchors', () => {
    const adoc = rewriteWikilinks(
      "[[#Publications|twenty-three children's tales]]",
      'asciidoc'
    );
    expect(adoc).toContain("link:#_publications[twenty-three children's tales]");
    expect(adoc).not.toContain('[[#Publications');
    expect(rewriteWikilinks('[[#Publications]]', 'markdown')).toContain('[Publications](#_publications)');
    expect(isAllowedHref('#_publications')).toBe(true);
  });
});

describe('sanitize', () => {
  it('rejects javascript: hrefs', () => {
    expect(isAllowedHref('javascript:alert(1)')).toBe(false);
    expect(isAllowedHref('https://example.com')).toBe(true);
    expect(isAllowedHref('#/wiki/d/foo')).toBe(true);
    expect(isAllowedHref('#/search?d=foo')).toBe(true);
    expect(sanitizeHtml('<script>alert(1)</script>hi')).not.toContain('script');
  });
});

describe('nostr refs', () => {
  it('splits npub embeds and ignores nsec', () => {
    const pk = '1'.repeat(64);
    const npub = nip19.npubEncode(pk);
    const nsec = nip19.nsecEncode(new Uint8Array(32));
    const parts = splitNostrRefs(`hello nostr:${npub} and nostr:${nsec} done`);
    expect(parts.some((p) => p.type === 'ref' && p.kind === 'npub')).toBe(true);
    expect(parts.some((p) => p.type === 'ref' && (p as { kind: string }).kind === 'nsec' as never)).toBe(false);
    expect(decodeNostrBech32(nsec)).toBeNull();
  });
});

describe('mute', () => {
  it('drops muted authors without leaving a slot', () => {
    const muted = ev({ pubkey: '1'.repeat(64), kind: 1111 });
    const ok = ev({ pubkey: '2'.repeat(64), id: 'd'.repeat(64), kind: 1111 });
    const state = parseMuteList(ev({ kind: KIND.MUTE, tags: [['p', '1'.repeat(64)]] }));
    expect(isMutedEvent(muted, state)).toBe(true);
    expect(filterMuted([muted, ok], state)).toEqual([ok]);
  });

  it('does not call the signer for non-ciphertext mute content', async () => {
    const nip44 = vi.fn();
    const nip04 = vi.fn();
    const prev = (globalThis as { window?: Window }).window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { nostr: { nip44: { decrypt: nip44 }, nip04: { decrypt: nip04 } } }
    });
    try {
      const rows = await decryptPrivateMuteTags(
        ev({ kind: KIND.MUTE, content: 'Could not decrypt the message', pubkey: 'a'.repeat(64) })
      );
      expect(rows).toEqual([]);
      expect(nip44).not.toHaveBeenCalled();
      expect(nip04).not.toHaveBeenCalled();
      expect(looksLikeNip44Ciphertext('Could not decrypt the message')).toBe(false);
      expect(looksLikeNip04Ciphertext('Could not decrypt the message')).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: prev });
    }
  });

  it('parses plaintext JSON private mute tags without decrypt', async () => {
    const nip44 = vi.fn();
    const prev = (globalThis as { window?: Window }).window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { nostr: { nip44: { decrypt: nip44 } } }
    });
    try {
      const pk = 'b'.repeat(64);
      const rows = await decryptPrivateMuteTags(
        ev({ kind: KIND.MUTE, content: JSON.stringify([['p', pk]]), pubkey: 'a'.repeat(64) })
      );
      expect(rows).toEqual([['p', pk]]);
      expect(nip44).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: prev });
    }
  });

  it('times out a hung NIP-44 mute decrypt', async () => {
    const nip44 = vi.fn(
      () => new Promise<string>(() => {
        /* never resolves */
      })
    );
    const prev = (globalThis as { window?: Window }).window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { nostr: { nip44: { decrypt: nip44 } } }
    });
    try {
      const cipher = 'A'.repeat(64);
      const started = Date.now();
      const rows = await decryptPrivateMuteTags(
        ev({ kind: KIND.MUTE, content: cipher, pubkey: 'a'.repeat(64) })
      );
      expect(rows).toEqual([]);
      expect(nip44).toHaveBeenCalled();
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: prev });
    }
  });
});

describe('comments nest', () => {
  it('nests a reply under its parent', () => {
    const root = ev({ id: '1'.repeat(64), kind: KIND.COMMENT, tags: [['A', '30040:pk:d']] });
    const reply = ev({
      id: '2'.repeat(64),
      kind: KIND.COMMENT,
      tags: [['A', '30040:pk:d'], ['e', root.id]]
    });
    const tree = nestComments([root, reply]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.event?.id).toBe(root.id);
    expect(tree[0]?.children[0]?.event?.id).toBe(reply.id);
  });

  it('nests a kind 1 reply under a kind 1111 parent', () => {
    const rootId = '1'.repeat(64);
    const editionId = 'a'.repeat(64);
    const root = ev({ id: rootId, kind: KIND.COMMENT, tags: [['A', '30040:pk:d']] });
    const reply = ev({
      id: '2'.repeat(64),
      kind: KIND.TEXT_NOTE,
      tags: [
        ['e', editionId, '', 'root'],
        ['e', rootId, '', 'reply']
      ]
    });
    const tree = nestComments([root, reply], undefined, [editionId]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.event?.id).toBe(rootId);
    expect(tree[0]?.children[0]?.event?.id).toBe(reply.id);
  });

  it('treats a kind 1 e-tag of the edition as a root', () => {
    const editionId = 'a'.repeat(64);
    const note = ev({
      id: '2'.repeat(64),
      kind: KIND.TEXT_NOTE,
      tags: [['e', editionId, '', 'root']]
    });
    const tree = nestComments([note], undefined, [editionId]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.event?.id).toBe(note.id);
    expect(tree[0]?.placeholder).toBeNull();
  });

  it('keeps a missing-parent placeholder (does not claim muted, does not promote)', () => {
    const reply = ev({
      id: '2'.repeat(64),
      kind: KIND.COMMENT,
      tags: [['e', '9'.repeat(64)]]
    });
    const other = ev({
      id: '3'.repeat(64),
      kind: KIND.COMMENT,
      tags: [['e', '8'.repeat(64)]]
    });
    const tree = nestComments([reply, other]);
    expect(tree).toHaveLength(2);
    expect(tree[0]?.placeholder).toBe(MISSING_PARENT_PLACEHOLDER);
    expect(tree[0]?.missingParentId).toBe('9'.repeat(64));
    expect(tree[1]?.missingParentId).toBe('8'.repeat(64));
    expect(threadNodeKey(tree[0]!)).not.toBe(threadNodeKey(tree[1]!));
    expect(tree[0]?.children[0]?.event?.id).toBe(reply.id);
  });

  it('uses the muted placeholder only when the parent event is muted', () => {
    const parent = ev({
      id: '9'.repeat(64),
      kind: KIND.COMMENT,
      pubkey: 'aa'.repeat(32),
      tags: []
    });
    const reply = ev({
      id: '2'.repeat(64),
      kind: KIND.COMMENT,
      tags: [['e', parent.id]]
    });
    const mute = { pubkeys: new Set([parent.pubkey]), eventIds: new Set<string>() };
    const tree = nestComments([parent, reply], mute);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.placeholder).toBe(MUTED_PARENT_PLACEHOLDER);
    expect(tree[0]?.missingParentId).toBe(parent.id);
    expect(tree[0]?.children[0]?.event?.id).toBe(reply.id);
  });
});

describe('comment draft kinds', () => {
  it('replies to any kind 1 with kind 1', () => {
    const editionId = 'a'.repeat(64);
    const edition = ev({
      id: editionId,
      kind: KIND.PUBLICATION,
      pubkey: '1'.repeat(64),
      tags: [['d', 'book']]
    });
    const note = ev({
      id: 'b'.repeat(64),
      kind: KIND.TEXT_NOTE,
      pubkey: '2'.repeat(64),
      tags: [['e', editionId, '', 'root']]
    });
    const draft = commentDraft(edition, 'chain', note);
    expect(draft.kind).toBe(KIND.TEXT_NOTE);
    expect(draft.tags).toContainEqual(['e', editionId, '', 'root']);
    expect(draft.tags).toContainEqual(['e', note.id, '', 'reply']);
    expect(draft.tags.some((t) => t[0] === 'p' && t[1] === note.pubkey)).toBe(true);
  });

  it('replies to kind 1111 and 9802 with kind 1111', () => {
    const edition = ev({
      id: 'a'.repeat(64),
      kind: KIND.PUBLICATION,
      pubkey: '1'.repeat(64),
      tags: [['d', 'book']]
    });
    const comment = ev({
      id: 'b'.repeat(64),
      kind: KIND.COMMENT,
      tags: [['A', `30040:${edition.pubkey}:book`]]
    });
    const highlight = ev({
      id: 'c'.repeat(64),
      kind: KIND.HIGHLIGHT,
      tags: [['a', `30041:${edition.pubkey}:ch1`]]
    });
    expect(commentDraft(edition, 'c', comment).kind).toBe(KIND.COMMENT);
    expect(commentDraft(edition, 'h', highlight).kind).toBe(KIND.COMMENT);
  });

  it('replies to a rating with kind 1111 targeted at that rating', () => {
    const rating = ev({
      id: 'd'.repeat(64),
      kind: KIND.RATING,
      pubkey: '2'.repeat(64),
      tags: [['d', `30040:${'1'.repeat(64)}:book`], ['a', `30040:${'1'.repeat(64)}:book`]]
    });
    const draft = commentDraft(rating, 'nice take');
    expect(draft.kind).toBe(KIND.COMMENT);
    expect(draft.tags).toContainEqual(['A', `34259:${rating.pubkey}:30040:${'1'.repeat(64)}:book`]);
    expect(draft.tags).toContainEqual(['K', String(KIND.RATING)]);
  });
});

describe('reactions', () => {
  it('uses jumble + / heart defaults', () => {
    expect(DEFAULT_LIKE_REACTION_CONTENT).toBe('+');
    expect(DEFAULT_LIKE_REACTION_DISPLAY_EMOJI).toBe('\u2665\uFE0F');
    expect(isPositiveLikeContent('+')).toBe(true);
    expect(isPositiveLikeContent('❤️')).toBe(true);
    expect(isPositiveLikeContent('-')).toBe(false);
  });

  it('drafts kind 7 + reactions with e/p and k/a when needed', () => {
    const note = ev({ id: 'a'.repeat(64), kind: KIND.TEXT_NOTE, pubkey: '1'.repeat(64) });
    const noteDraft = reactionDraft(note);
    expect(noteDraft.kind).toBe(KIND.REACTION);
    expect(noteDraft.content).toBe('+');
    expect(noteDraft.tags).toContainEqual(['e', note.id]);
    expect(noteDraft.tags).toContainEqual(['p', note.pubkey]);
    expect(noteDraft.tags.some((t) => t[0] === 'k')).toBe(false);

    const rating = ev({
      id: 'b'.repeat(64),
      kind: KIND.RATING,
      pubkey: '2'.repeat(64),
      tags: [['d', '30040:pk:book']]
    });
    const ratingDraftRx = reactionDraft(rating);
    expect(ratingDraftRx.tags).toContainEqual(['k', String(KIND.RATING)]);
    expect(ratingDraftRx.tags).toContainEqual(['a', `34259:${rating.pubkey}:30040:pk:book`]);

    const highlight = ev({ id: 'c'.repeat(64), kind: KIND.HIGHLIGHT, pubkey: '3'.repeat(64) });
    expect(reactionDraft(highlight).tags).toContainEqual(['k', String(KIND.HIGHLIGHT)]);
    expect(reactionDraft(highlight).tags.some((t) => t[0] === 'a')).toBe(false);
  });

  it('counts one like per pubkey and finds mine', () => {
    const target = 'a'.repeat(64);
    const a = ev({
      id: '1'.repeat(64),
      pubkey: 'p'.repeat(64),
      kind: KIND.REACTION,
      content: '+',
      created_at: 1,
      tags: [['e', target]]
    });
    const aNewer = ev({
      id: '2'.repeat(64),
      pubkey: 'p'.repeat(64),
      kind: KIND.REACTION,
      content: '❤️',
      created_at: 2,
      tags: [['e', target]]
    });
    const b = ev({
      id: '3'.repeat(64),
      pubkey: 'q'.repeat(64),
      kind: KIND.REACTION,
      content: '+',
      created_at: 1,
      tags: [['e', target]]
    });
    const dislike = ev({
      id: '4'.repeat(64),
      pubkey: 'r'.repeat(64),
      kind: KIND.REACTION,
      content: '-',
      tags: [['e', target]]
    });
    expect(likeCount([a, aNewer, b, dislike])).toBe(2);
    expect(myLikeReaction([a, aNewer, b], 'p'.repeat(64))?.id).toBe(aNewer.id);
    expect(myLikeReaction([a, b], null)).toBeNull();
  });
});

describe('booklist and shelves', () => {
  const pubA = ev({
    id: 'a'.repeat(64),
    pubkey: '1'.repeat(64),
    kind: KIND.PUBLICATION,
    tags: [['d', 'a']]
  });
  const pubB = ev({
    id: 'b'.repeat(64),
    pubkey: '2'.repeat(64),
    kind: KIND.PUBLICATION,
    tags: [['d', 'b']]
  });
  const pubC = ev({
    id: 'c'.repeat(64),
    pubkey: '3'.repeat(64),
    kind: KIND.PUBLICATION,
    tags: [['d', 'c']]
  });
  const pubD = ev({
    id: 'd'.repeat(64),
    pubkey: '4'.repeat(64),
    kind: KIND.PUBLICATION,
    tags: [['d', 'd']]
  });
  const pubE = ev({
    id: 'e'.repeat(64),
    pubkey: '5'.repeat(64),
    kind: KIND.PUBLICATION,
    tags: [['d', 'e']]
  });

  function addr(p: Event): string {
    return `30040:${p.pubkey}:${p.tags[0]![1]}`;
  }

  function booklist(author: string, pub: Event, created_at: number): Event {
    return ev({
      id: (author + pub.id).slice(0, 64),
      pubkey: author,
      kind: KIND.LABEL,
      created_at,
      tags: [
        ['L', NIP32_UGC_NAMESPACE],
        ['l', NIP32_BOOKLIST_LABEL, NIP32_UGC_NAMESPACE],
        ['a', addr(pub)]
      ]
    });
  }

  it('detects booklist labels', () => {
    const label = booklist('1'.repeat(64), pubA, 10);
    expect(isBooklistEvent(label)).toBe(true);
    expect(extractNip32LabelValues(label.tags)).toEqual(['booklist']);
    expect(publicationTargets(label).addresses).toEqual([addr(pubA)]);
  });

  it('assigns mine, follows, curator, network with dedup and reference recency', () => {
    const me = '6'.repeat(64);
    const follow = '7'.repeat(64);
    const other = '8'.repeat(64);
    const labels = [
      booklist(me, pubA, 10),
      booklist(follow, pubB, 11),
      booklist(GITCITADEL_CURATOR_HEX, pubC, 12),
      booklist(other, pubD, 13),
      booklist(me, pubE, 1),
      booklist(follow, pubE, 50),
      booklist(GITCITADEL_CURATOR_HEX, pubE, 50),
      booklist(other, pubE, 50),
      booklist(other, pubA, 99)
    ];
    const memberships = membershipsFromEvents(labels);
    const pubs = new Map([
      [addr(pubA), pubA],
      [addr(pubB), pubB],
      [addr(pubC), pubC],
      [addr(pubD), pubD],
      [addr(pubE), pubE]
    ]);
    const shelves = assignShelves(memberships, pubs, me, new Set([follow]));
    expect(shelves.map((s) => s.id)).toEqual(['mine', 'follows', 'gitcitadel', 'network']);
    expect(shelves[0]?.events.map((e) => e.id)).toEqual([pubA.id, pubE.id]);
    expect(shelves[1]?.events.map((e) => e.id)).toEqual([pubB.id]);
    expect(shelves[2]?.events.map((e) => e.id)).toEqual([pubC.id]);
    expect(shelves[3]?.events.map((e) => e.id)).toEqual([pubD.id]);
  });

  it('ranks by the reference event created_at, not the publication', () => {
    const me = '6'.repeat(64);
    const oldPub = { ...pubA, created_at: 1 };
    const newPub = { ...pubB, created_at: 9 };
    const labels = [booklist(me, oldPub, 100), booklist(me, newPub, 50)];
    const pubs = new Map([
      [addr(oldPub), oldPub],
      [addr(newPub), newPub]
    ]);
    const shelves = assignShelves(membershipsFromEvents(labels), pubs, me, new Set());
    expect(shelves[0]?.events.map((e) => e.id)).toEqual([oldPub.id, newPub.id]);
  });

  it('preserves other bookmark tags when adding and removing one', () => {
    const pub = pubA;
    const existing = ev({
      kind: KIND.BOOKMARK,
      tags: [['a', '30040:ff:other'], ['e', '9'.repeat(64)]]
    });
    const added = withBookmarkTag(existing, pub, true);
    expect(added.some((t) => t[0] === 'a' && t[1] === addr(pub))).toBe(true);
    expect(added.some((t) => t[1] === '30040:ff:other')).toBe(true);
    const removed = withBookmarkTag({ ...existing, tags: added }, pub, false);
    expect(removed.some((t) => t[1] === addr(pub))).toBe(false);
    expect(removed.some((t) => t[1] === '30040:ff:other')).toBe(true);
    expect(removed.some((t) => t[1] === '9'.repeat(64))).toBe(true);
  });
});

describe('landing labels', () => {
  it('ranks distinct publication labels and caps at 25', () => {
    const labels: Event[] = [];
    for (let i = 0; i < 3; i++) {
      labels.push(
        ev({
          id: i.toString(16).repeat(64).slice(0, 64),
          kind: KIND.LABEL,
          tags: [
            ['l', 'booklist', 'ugc'],
            ['a', `30040:${'1'.repeat(64)}:p${i}`]
          ]
        })
      );
    }
    labels.push(
      ev({
        id: 'f'.repeat(64),
        kind: KIND.LABEL,
        tags: [['l', 'English literature'], ['a', `30040:${'1'.repeat(64)}:p0`]]
      })
    );
    expect(landingLabels(labels)[0]).toBe('booklist');
  });
});

describe('ratings', () => {
  it('aggregates 0-1 ratings and keeps the newest per author', () => {
    const addr = `30040:${'1'.repeat(64)}:d`;
    const a = ev({
      pubkey: '2'.repeat(64),
      kind: KIND.RATING,
      created_at: 1,
      tags: [['a', addr], ['m', 'book'], ['rating', '0.200']]
    });
    const a2 = ev({
      id: '3'.repeat(64),
      pubkey: '2'.repeat(64),
      kind: KIND.RATING,
      created_at: 2,
      tags: [['a', addr], ['m', 'book'], ['rating', '1.000']]
    });
    const newest = newestRatingPerAuthor([a, a2], addr);
    expect(newest).toHaveLength(1);
    expect(ratingValue(newest[0]!)).toBe(1);
    expect(aggregateRating(newest).average).toBe(1);
  });

  it('keeps the newest scored rating per publication for landing', () => {
    const addr = `30040:${'aa'.repeat(32)}:republic`;
    const older = ev({
      id: '11'.repeat(32),
      kind: KIND.RATING,
      pubkey: 'bb'.repeat(32),
      created_at: 100,
      tags: [['a', addr], ['m', 'book'], ['rating', '0.200']]
    });
    const newer = ev({
      id: '22'.repeat(32),
      kind: KIND.RATING,
      pubkey: 'cc'.repeat(32),
      created_at: 200,
      tags: [['a', addr], ['m', 'book'], ['rating', '1.000']]
    });
    const other = ev({
      id: '33'.repeat(32),
      kind: KIND.RATING,
      pubkey: 'ee'.repeat(32),
      created_at: 150,
      tags: [['a', `30040:${'ff'.repeat(32)}:iliad`], ['m', 'book'], ['rating', '0.800']]
    });
    const rows = newestRatingPerPublication([older, newer, other]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).toBe(newer.id);
  });
});

describe('kind 0 fields', () => {
  it('lets tags win over JSON and ignores invalid JSON', () => {
    const profile = ev({
      kind: 0,
      tags: [['name', 'Tagged']],
      content: '{"name":"Json","about":"Hello"}'
    });
    expect(parseKind0(profile).name).toBe('Tagged');
    expect(parseKind0(profile).about).toBe('Hello');
    expect(parseKind0(ev({ kind: 0, content: 'not-json' })).name).toBe('');
  });

  it('uses name as title when display_name is missing', () => {
    const fields = parseKind0(ev({ kind: 0, tags: [['name', 'Ada']], content: '{}' }));
    expect(fields.title).toBe('Ada');
    expect(fields.displayName).toBe('');
  });

  it('does not leak displayName aliases into extra JSON', () => {
    const fields = parseKind0(
      ev({
        kind: 0,
        content: '{"displayName":"Ada","display_name":"Ada","name":"ada","custom":"x"}'
      })
    );
    expect(fields.title).toBe('Ada');
    expect(fields.extra).toEqual({ custom: 'x' });
  });

  it('lists all website and nip05 tags', () => {
    const fields = parseKind0(
      ev({
        kind: 0,
        tags: [
          ['website', 'https://a.example'],
          ['website', 'https://b.example'],
          ['nip05', 'a@x.com'],
          ['nip05', 'b@y.com']
        ],
        content: '{}'
      })
    );
    expect(fields.websites).toEqual(['https://a.example', 'https://b.example']);
    expect(fields.nip05List).toEqual(['a@x.com', 'b@y.com']);
  });

  it('dedupes payment rows by type and authority', () => {
    const profile = ev({ kind: 0, content: '{"lud16":"a@b.com"}', tags: [['lud16', 'a@b.com']] });
    const fields = parseKind0(profile);
    const rows = paymentRows(
      fields,
      [ev({ kind: KIND.PAYMENT, tags: [['lud16', 'a@b.com'], ['payto', 'iban', 'DE00']] })],
      profile
    );
    expect(rows.filter((r) => r.type === 'lud16')).toHaveLength(1);
    expect(rows.some((r) => r.type === 'iban')).toBe(true);
  });

  it('reads jumble-style payto and wallet w tags from kind 0', () => {
    const profile = ev({
      kind: 0,
      tags: [
        ['payto', 'monero', '4abc'],
        ['w', 'XMR', '4wallet', 'monero'],
        ['lud16', 'zap@example.com']
      ],
      content: '{}'
    });
    const rows = paymentRows(parseKind0(profile), [], profile);
    const monero = rows.find((r) => r.type === 'monero');
    expect(monero?.label).toBe('4abc');
    expect(monero?.label).not.toMatch(/^monero:/i);
    expect(rows.some((r) => r.type === 'lud16' && r.label === 'zap@example.com')).toBe(true);
  });

  it('hides client tags and published_at and linkifies about URLs and hashtags', async () => {
    const { aboutHtml, cropPaymentAddress } = await import('./profile-fields');
    const fields = parseKind0(
      ev({
        kind: 0,
        tags: [
          ['client', 'jumble'],
          ['name', 'Ada'],
          ['published_at', '1706421930']
        ],
        content:
          '{"about":"building #Alexandria, #MedSchlr\\nhttps://example.com/docs for more.","published_at":"1706421930"}'
      })
    );
    expect(fields.extraTags.some((t) => t.name === 'client')).toBe(false);
    expect(fields.extraTags.some((t) => t.name === 'published_at')).toBe(false);
    expect(fields.extra.published_at).toBeUndefined();
    const html = aboutHtml(fields.about);
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('href="#/search?subject=Alexandria"');
    expect(html).toContain('>#Alexandria</a>');
    expect(html).toContain('href="#/search?subject=MedSchlr"');
    expect(html).not.toMatch(/https:\/\/example\.com\/docs[^"]*#Alexandria/);
    expect(cropPaymentAddress('a'.repeat(60)).length).toBe(50);
  });
});

describe('media once', () => {
  it('renders a repeated image url only once and strips it from leftover content', () => {
    const url = 'https://cdn.example/pic.jpg';
    const event = ev({
      kind: 20,
      content: `see ${url}`,
      tags: [['image', url], ['imeta', `url ${url}`]]
    });
    const media = uniqueMedia(event);
    expect(media).toHaveLength(1);
    expect(contentWithoutMediaUrls(event.content, media)).toBe('see');
  });

  it('rewrites bare image urls into inline image markup', () => {
    const gif = 'https://c.tenor.com/slhfg2cHPXgAAAAd/tenor.gif';
    expect(rewriteBareImageUrls(`before\n${gif}\nafter`, 'markdown')).toContain(`![](${gif})`);
    expect(rewriteBareImageUrls(gif, 'asciidoc')).toContain(`image::${gif}[]`);
    expect(rewriteBareImageUrls(`![](${gif})`, 'markdown')).toBe(`![](${gif})`);
  });

  it('promotes linkified image autolinks to img tags', () => {
    const url = 'https://i.nostr.build/cover.webp';
    const html = `<p><a href="${url}">${url}</a></p>`;
    expect(promoteImageAutolinks(html)).toContain(`<img src="${url}"`);
    expect(promoteImageAutolinks(html)).not.toContain('<a ');
  });
});
