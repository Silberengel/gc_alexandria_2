import { describe, expect, it } from 'vitest';
import { KIND, MUTED_PARENT_PLACEHOLDER, NIP32_BOOKLIST_LABEL, NIP32_UGC_NAMESPACE } from './constants';
import { nestComments } from './comments';
import { rewriteWikilinks, isAllowedHref, sanitizeHtml } from './markup';
import { parseMuteList, filterMuted, isMutedEvent } from './mute';
import { extractNip32LabelValues, isBooklistEvent, publicationTargets } from './nip32';
import { splitNostrRefs, decodeNostrBech32 } from './nostr-refs';
import { landingLabels } from './labels';
import { assignShelves, membershipsFromEvents, withBookmarkTag } from './shelves';
import { aggregateRating, ratingValue, newestRatingPerAuthor } from './ratings';
import { parseKind0, paymentRows } from './profile-fields';
import { uniqueMedia, contentWithoutMediaUrls } from './media';
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
  it('rewrites djot/markdown/asciidoc wikilinks to /wiki/d', () => {
    expect(rewriteWikilinks('see [[constantinople]]')).toContain('#/wiki/d/constantinople');
    expect(rewriteWikilinks('[[constantinople|Byzantium]]')).toContain('Byzantium');
    expect(rewriteWikilinks('[[constantinople|Byzantium]]')).toContain('#/wiki/d/constantinople');
    expect(rewriteWikilinks('[constantinople][]')).toContain('#/wiki/d/constantinople');
  });
});

describe('sanitize', () => {
  it('rejects javascript: hrefs', () => {
    expect(isAllowedHref('javascript:alert(1)')).toBe(false);
    expect(isAllowedHref('https://example.com')).toBe(true);
    expect(isAllowedHref('#/wiki/d/foo')).toBe(true);
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

  it('uses the shared placeholder for a missing parent', () => {
    const reply = ev({
      id: '2'.repeat(64),
      kind: KIND.COMMENT,
      tags: [['e', '9'.repeat(64)]]
    });
    const tree = nestComments([reply]);
    expect(tree[0]?.placeholder).toBe(MUTED_PARENT_PLACEHOLDER);
    expect(tree[0]?.children[0]?.event?.id).toBe(reply.id);
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

  it('dedupes payment rows by type and authority', () => {
    const fields = parseKind0(
      ev({ kind: 0, content: '{"lud16":"a@b.com"}', tags: [['lud16', 'a@b.com']] })
    );
    const rows = paymentRows(fields, [
      ev({ kind: KIND.PAYMENT, tags: [['lud16', 'a@b.com'], ['payto', 'payto://iban/DE00']] })
    ]);
    expect(rows.filter((r) => r.type === 'lud16')).toHaveLength(1);
    expect(rows.some((r) => r.type === 'payto')).toBe(true);
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
});
