import { describe, expect, it, vi } from 'vitest';
import { KIND, MUTED_PARENT_PLACEHOLDER, NIP32_BOOKLIST_LABEL, NIP32_UGC_NAMESPACE } from './constants';
import { nestComments, threadNodeKey, threadRootKeys, isQuoteOfTarget, referencesTarget, canOfferKind1Reply, nip10ReplyTags, nip22TagsForTarget, partitionWorkResponses, missingCommentParentIds, eTagRelayHints } from './comments';
import { commentDraft } from './drafts';
import {
  DEFAULT_LIKE_REACTION_CONTENT,
  DEFAULT_LIKE_REACTION_DISPLAY_EMOJI,
  isPositiveLikeContent,
  likeCount,
  likePubkeys,
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
import { assignShelves, collapseSameCoverEditions, membershipsFromEvents, topLevelShelfEvents, withBookmarkTag } from './shelves';
import { aggregateRating, ratingValue, newestRatingPerAuthor, newestRatingPerPublication } from './ratings';
import { parseKind0, paymentRows } from './profile-fields';
import { uniqueMedia, contentWithoutMediaUrls, imetaMedia, omitMediaUrls, rewriteBareImageUrls, promoteImageAutolinks, sameMedia, stripRenderedMedia } from './media';
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
    expect(rewriteWikilinks('see [[constantinople]]', 'djot')).toContain(
      '#/search?d=constantinople'
    );
    expect(rewriteWikilinks('[[constantinople|Byzantium]]', 'djot')).toContain('Byzantium');
    expect(rewriteWikilinks('[[constantinople|Byzantium]]', 'djot')).toContain(
      '#/search?d=constantinople'
    );
    expect(rewriteWikilinks('[constantinople][]', 'djot')).toContain('#/search?d=constantinople');
  });

  it('rewrites asciidoc wikilinks as link: macros so they become hyperlinks', () => {
    const out = rewriteWikilinks('see [[NKBIP-01]] and [[nkbip-01|NKBIP-01]]', 'asciidoc');
    expect(out).toContain('link:#/search?d=nkbip-01[NKBIP-01]');
    expect(out).not.toContain('[[NKBIP-01]]');
    expect(out).not.toMatch(/\[[^\]]+\]\(#\//);
  });

  it('normalizes existing wiki hash links to d-tag search', () => {
    expect(rewriteWikilinks('[NKBIP-01](#/wiki/d/nkbip-01)', 'djot')).toContain(
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
    expect(rewriteWikilinks('[[#Publications]]', 'djot')).toContain('[Publications](#_publications)');
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

  it('recognizes kind 1 q-tag quotes of a work', () => {
    const edition = ev({
      id: 'a'.repeat(64),
      kind: KIND.PUBLICATION,
      pubkey: 'b'.repeat(64),
      tags: [['d', 'jane-eyre']]
    });
    const quote = ev({
      id: 'c'.repeat(64),
      kind: KIND.TEXT_NOTE,
      tags: [['q', edition.id]]
    });
    const reply = ev({
      id: 'd'.repeat(64),
      kind: KIND.TEXT_NOTE,
      tags: [['e', edition.id, '', 'root']]
    });
    expect(isQuoteOfTarget(quote, edition)).toBe(true);
    expect(isQuoteOfTarget(reply, edition)).toBe(false);
    expect(referencesTarget(quote, edition)).toBe(true);
    expect(referencesTarget(reply, edition)).toBe(true);
  });

  it('treats kind 1 notes that embed the OP naddr as quotes', async () => {
    const { nip19 } = await import('nostr-tools');
    const pk = 'b'.repeat(64);
    const edition = ev({
      id: 'a'.repeat(64),
      kind: KIND.LONG_FORM,
      pubkey: pk,
      tags: [['d', 'project-alexandria']]
    });
    const naddr = nip19.naddrEncode({
      kind: KIND.LONG_FORM,
      pubkey: pk,
      identifier: 'project-alexandria'
    });
    const share = ev({
      id: 'c'.repeat(64),
      kind: KIND.TEXT_NOTE,
      content: `Getting closer.\n\nnostr:${naddr}`,
      tags: [['a', `${KIND.LONG_FORM}:${pk}:project-alexandria`]]
    });
    const bareReply = ev({
      id: 'd'.repeat(64),
      kind: KIND.TEXT_NOTE,
      content: 'Nice article.',
      tags: [['e', edition.id, '', 'root']]
    });
    expect(isQuoteOfTarget(share, edition)).toBe(true);
    expect(isQuoteOfTarget(bareReply, edition)).toBe(false);
  });

  it('collects q and kind 1 a-tags as embed pointers', async () => {
    const { embedPointersFromTags } = await import('./event-embeds');
    const note = ev({
      kind: KIND.TEXT_NOTE,
      tags: [
        ['q', 'c'.repeat(64)],
        ['a', `30023:${'b'.repeat(64)}:project-alexandria`]
      ]
    });
    const pointers = embedPointersFromTags(note);
    expect(pointers).toContainEqual({ kind: 'id', id: 'c'.repeat(64) });
    expect(pointers).toContainEqual({
      kind: 'addr',
      addr: `30023:${'b'.repeat(64)}:project-alexandria`
    });
    const comment = ev({
      kind: KIND.COMMENT,
      tags: [['A', `30040:${'b'.repeat(64)}:book`], ['q', 'd'.repeat(64)]]
    });
    expect(embedPointersFromTags(comment)).toEqual([{ kind: 'id', id: 'd'.repeat(64) }]);
    const replyToReplaceable = ev({
      kind: KIND.TEXT_NOTE,
      tags: [
        ['a', `30023:${'d'.repeat(64)}:1719204947236`, '', 'root'],
        ['e', 'e'.repeat(64), '', 'root']
      ]
    });
    expect(embedPointersFromTags(replyToReplaceable)).toEqual([]);
  });

  it('treats a content-only nostr:naddr of the OP as a quote, not an other-response', async () => {
    const { nip19 } = await import('nostr-tools');
    const pk = 'b'.repeat(64);
    const edition = ev({
      id: 'a'.repeat(64),
      kind: KIND.LONG_FORM,
      pubkey: pk,
      tags: [['d', 'project-alexandria']]
    });
    const naddr = nip19.naddrEncode({
      kind: KIND.LONG_FORM,
      pubkey: pk,
      identifier: 'project-alexandria'
    });
    const share = ev({
      id: 'c'.repeat(64),
      kind: KIND.TEXT_NOTE,
      content: `Look:\nnostr:${naddr}`,
      tags: []
    });
    expect(isQuoteOfTarget(share, edition)).toBe(true);
  });

  it('treats a legacy nostr:note1 embed with no tags as a quote, not other', async () => {
    const { nip19 } = await import('nostr-tools');
    const quotedId = '0d8a05e212f8edeb47195ac995351b5af063ba20854241b62eb9ecbdd269cb88';
    const note1 = nip19.noteEncode(quotedId);
    expect(note1).toBe('note1pk9qtcsjlrk7k3cettye2dgmttcx8w3qs4pyrd3wh8ktm5nfewyqpnk5q7');
    const quoted = ev({ id: quotedId, kind: KIND.TEXT_NOTE, tags: [] });
    const share = ev({
      id: '0f38d6f1f2ee1a2b1c5863be06f6aaab87e6d28b947984653a860987b4be8b93',
      pubkey: 'dd664d5e4016433a8cd69f005ae1480804351789b59de5af06276de65633d319',
      kind: KIND.TEXT_NOTE,
      tags: [],
      content:
        'Today was the day that Nostr moved into the book market. And Highlighter was the first to get there.\n\nLFG 🚀\n\nnostr:' +
        note1
    });
    const otherWork = ev({
      id: 'a'.repeat(64),
      kind: KIND.LONG_FORM,
      pubkey: 'b'.repeat(64),
      tags: [['d', 'unrelated']]
    });
    expect(isQuoteOfTarget(share, quoted)).toBe(true);
    expect(isQuoteOfTarget(share, otherWork)).toBe(false);

    const stray = ev({
      id: '70691c5a055aeffa28eed43643ad4c83350787ab94bce1d012f8af1f3dbee1a1',
      pubkey: 'e88a691e98d9987c964521dff60025f60700378a4879180dcbbb4a5027850411',
      kind: KIND.TEXT_NOTE,
      tags: [],
      content:
        'A great way to advertise Nostr is to write long form here then post link to the outside.\n\nWhat are your favorite long form posts on Nostr?'
    });
    const article = ev({
      id: 'e'.repeat(64),
      kind: KIND.LONG_FORM,
      pubkey: 'f'.repeat(64),
      tags: [['d', '1719204947236']]
    });
    const replies = partitionWorkResponses([share, stray, quoted], article);
    expect(replies.quotes.map((e) => e.id)).not.toContain(stray.id);
    expect(replies.other.map((e) => e.id)).not.toContain(stray.id);
    expect(replies.thread.map((e) => e.id)).not.toContain(stray.id);
    expect(replies.quotes.map((e) => e.id)).not.toContain(share.id);
  });

  it('treats a kind 1 that a-tags the OP but replies in another thread as a quote', () => {
    const pk = 'dd664d5e4016433a8cd69f005ae1480804351789b59de5af06276de65633d319';
    const article = ev({
      id: 'e'.repeat(64),
      kind: KIND.LONG_FORM,
      pubkey: pk,
      tags: [['d', '1719204947236']]
    });
    const share = ev({
      id: '18476c17c91fc68930a6b1511e029cc3af96cee1c71b19f6828b91e21845007a',
      pubkey: 'fd208ee8c8f283780a9552896e4823cc9dc6bfd442063889577106940fd927c1',
      kind: KIND.TEXT_NOTE,
      content: 'https://next-alexandria.gitcitadel.eu/',
      tags: [
        ['e', '70691c5a055aeffa28eed43643ad4c83350787ab94bce1d012f8af1f3dbee1a1', '', 'root'],
        ['e', '19db27b988b7ae0ee56812653c23ae20c0dcc3a5c686558cebde26a51a630057'],
        ['e', 'a093fb4f8bd62fbc83c2e1db482dfa3f3ab4fd57df72fcbe931844ad3190081f', '', 'reply'],
        ['a', `30023:${pk}:1719204947236`],
        ['r', 'https://next-alexandria.gitcitadel.eu/']
      ]
    });
    const replyHere = ev({
      id: '1'.repeat(64),
      kind: KIND.TEXT_NOTE,
      tags: [
        ['e', article.id, '', 'root'],
        ['a', `30023:${pk}:1719204947236`]
      ]
    });
    expect(isQuoteOfTarget(share, article)).toBe(true);
    expect(isQuoteOfTarget(replyHere, article)).toBe(false);
    const parts = partitionWorkResponses([share, replyHere], article);
    expect(parts.quotes.map((e) => e.id)).toEqual([share.id]);
    expect(parts.thread.map((e) => e.id)).toEqual([replyHere.id]);
  });

  it('keeps that quote as a quote even when a comment e-tags it', () => {
    const pk = 'dd664d5e4016433a8cd69f005ae1480804351789b59de5af06276de65633d319';
    const article = ev({
      id: 'e'.repeat(64),
      kind: KIND.LONG_FORM,
      pubkey: pk,
      tags: [['d', '1719204947236']]
    });
    const share = ev({
      id: '18476c17c91fc68930a6b1511e029cc3af96cee1c71b19f6828b91e21845007a',
      pubkey: 'fd208ee8c8f283780a9552896e4823cc9dc6bfd442063889577106940fd927c1',
      kind: KIND.TEXT_NOTE,
      content: 'https://next-alexandria.gitcitadel.eu/',
      tags: [
        ['e', '70691c5a055aeffa28eed43643ad4c83350787ab94bce1d012f8af1f3dbee1a1', '', 'root'],
        ['e', '19db27b988b7ae0ee56812653c23ae20c0dcc3a5c686558cebde26a51a630057'],
        ['e', 'a093fb4f8bd62fbc83c2e1db482dfa3f3ab4fd57df72fcbe931844ad3190081f', '', 'reply'],
        ['a', `30023:${pk}:1719204947236`],
        ['r', 'https://next-alexandria.gitcitadel.eu/']
      ]
    });
    const replyHere = ev({
      id: '1'.repeat(64),
      kind: KIND.TEXT_NOTE,
      tags: [
        ['e', article.id, '', 'root'],
        ['e', share.id, '', 'reply'],
        ['a', `30023:${pk}:1719204947236`]
      ]
    });
    expect(isQuoteOfTarget(share, article)).toBe(true);
    const parts = partitionWorkResponses([share, replyHere], article);
    expect(parts.quotes.map((e) => e.id)).toEqual([share.id]);
    expect(parts.thread.map((e) => e.id)).toEqual([replyHere.id]);
  });

  it('treats a kind 1 a-tag with root marker as a comment, not a quote', () => {
    const pk = 'dd664d5e4016433a8cd69f005ae1480804351789b59de5af06276de65633d319';
    const article = ev({
      id: 'e'.repeat(64),
      kind: KIND.LONG_FORM,
      pubkey: pk,
      tags: [['d', '1719204947236']]
    });
    const note = ev({
      id: 'b50ba0c6cec520e3236eead41240ab99cbb5d4b38a00481b1cfed77bb25e632d',
      pubkey: '9ca0bd7450742d6a20319c0e3d4c679c9e046a9dc70e8ef55c2905e24052340b',
      kind: KIND.TEXT_NOTE,
      content:
        "Boosted. I barely understand, but I know this is cool. Let's get that Minecraft library thing on here somehow too:)",
      tags: [
        ['p', pk],
        ['a', `30023:${pk}:1719204947236`, '', 'root']
      ]
    });
    expect(isQuoteOfTarget(note, article)).toBe(false);
    const parts = partitionWorkResponses([note], article);
    expect(parts.thread.map((e) => e.id)).toEqual([note.id]);
    expect(parts.quotes).toHaveLength(0);
  });

  it('treats a kind 1 that only a-tags the article as a root reply', () => {
    const pk = 'dd664d5e4016433a8cd69f005ae1480804351789b59de5af06276de65633d319';
    const article = ev({
      id: 'e'.repeat(64),
      kind: KIND.LONG_FORM,
      pubkey: pk,
      tags: [['d', '1719204947236']]
    });
    const note = ev({
      id: 'ee0c9455835e83a72019078b8d6b84cd1c6fe5252559b0465967de8060cdab7b',
      pubkey: '3c9849383bdea883b0bd16fece1ed36d37e37cdde3ce43b17ea4e9192ec11289',
      kind: KIND.TEXT_NOTE,
      content: 'Can this be monetized?',
      tags: [
        ['p', pk],
        ['a', `30023:${pk}:1719204947236`, '', 'root']
      ]
    });
    expect(isQuoteOfTarget(note, article)).toBe(false);
    const parts = partitionWorkResponses([note], article);
    expect(parts.thread.map((e) => e.id)).toEqual([note.id]);
    expect(parts.quotes).toHaveLength(0);
  });

  it('rebuilds a kind 1 reply branch from a-root plus e-tag ancestors', () => {
    const pk = 'dd664d5e4016433a8cd69f005ae1480804351789b59de5af06276de65633d319';
    const article = ev({
      id: 'f'.repeat(64),
      kind: KIND.LONG_FORM,
      pubkey: pk,
      tags: [['d', '1719204947236']]
    });
    const addr = `30023:${pk}:1719204947236`;
    const rootNote = ev({
      id: 'a3e18d102baea9826bba4eed3bbac6fa0236e3fe3e4f6d3ead7fa2c7ad444878',
      kind: KIND.TEXT_NOTE,
      content: 'root of the kind 1 branch',
      tags: [['a', addr, '', 'root']]
    });
    const mid = ev({
      id: '9bed3f525e1210c55ae2029403b06ec7849b9f37b72abf87282f349f3286ca42',
      kind: KIND.TEXT_NOTE,
      content: 'mid reply',
      tags: [
        ['e', rootNote.id],
        ['a', addr, '', 'root']
      ]
    });
    const leaf = ev({
      id: '32190b5a617866abab290244a21ad284696b7a73edce0f6ee58551dd8f3ba06b',
      pubkey: pk,
      kind: KIND.TEXT_NOTE,
      content: 'Hierarchical levels.',
      tags: [
        ['e', rootNote.id],
        ['e', mid.id, '', 'reply'],
        ['a', addr, '', 'root']
      ]
    });
    expect(
      missingCommentParentIds([leaf], new Set([leaf.id]), [article.id], article).sort()
    ).toEqual([rootNote.id, mid.id].sort());
    const parts = partitionWorkResponses([leaf, mid, rootNote], article);
    expect(parts.thread.map((e) => e.id).sort()).toEqual([leaf.id, mid.id, rootNote.id].sort());
    expect(parts.quotes).toHaveLength(0);
    const tree = nestComments(parts.thread, undefined, threadRootKeys(article));
    expect(tree).toHaveLength(1);
    expect(tree[0]?.event?.id).toBe(rootNote.id);
    expect(tree[0]?.children[0]?.event?.id).toBe(mid.id);
    expect(tree[0]?.children[0]?.children[0]?.event?.id).toBe(leaf.id);
  });

  it('nests a kind 1 reply under its NIP-10 parent when both e-tag the OP as root', () => {
    const op = ev({
      id: '30c8bea38000a4a634fbeb0d386a83af36cb49de353657cb16f7de6c8bcc2166',
      kind: KIND.TEXT_NOTE,
      tags: []
    });
    const parent = ev({
      id: '7d72daec3cc34b14267dd18ac5d1fa2d33d6169480a4d4de429de14cfc0bb959',
      kind: KIND.TEXT_NOTE,
      content: 'We’ve been doing that for well over a month already! https://nips.wiki',
      tags: [['e', op.id, 'wss://nostr.mom', 'root']]
    });
    const leaf = ev({
      id: 'b23b4012a254485116608aaacba16c096d52d6680c5cebea48e508f6e34bad5b',
      kind: KIND.TEXT_NOTE,
      content: 'Brilliant 🫡 ',
      tags: [
        ['e', op.id, 'wss://nostr.mom/', 'root'],
        ['e', parent.id, 'wss://relay.damus.io/', 'reply']
      ]
    });
    expect(missingCommentParentIds([leaf], new Set([leaf.id]), [op.id], op)).toEqual([parent.id]);
    expect([...eTagRelayHints([leaf]).get(parent.id)!]).toContain('wss://relay.damus.io/');
    const parts = partitionWorkResponses([leaf, parent], op);
    expect(parts.thread.map((e) => e.id).sort()).toEqual([leaf.id, parent.id].sort());
    const tree = nestComments(parts.thread, undefined, threadRootKeys(op));
    expect(tree).toHaveLength(1);
    expect(tree[0]?.event?.id).toBe(parent.id);
    expect(tree[0]?.children[0]?.event?.id).toBe(leaf.id);
  });

  it('treats a kind 1 that a-tags the OP and e-tags another thread as a quote', () => {
    const pk = 'dd664d5e4016433a8cd69f005ae1480804351789b59de5af06276de65633d319';
    const article = ev({
      id: 'e'.repeat(64),
      kind: KIND.LONG_FORM,
      pubkey: pk,
      tags: [['d', '1719204947236']]
    });
    const addr = `30023:${pk}:1719204947236`;
    const parent = ev({
      id: '78603fc5bcf44a0d1f14a51eea93f22fccf4a3fff28c7bc3e8a1a1755e5f230c',
      kind: KIND.TEXT_NOTE,
      tags: [
        ['e', '5bffa3578b29401471ca2d7f2183c2fe1fda28fb69343f4852678c6c24db47cb'],
        ['a', addr]
      ]
    });
    const nested = ev({
      id: 'f7978a0c9379d4e97e01bdd4a765dac234762ff65036a3a90fdb7d0d833e289e',
      kind: KIND.TEXT_NOTE,
      content: "...I don't know how to pandoc",
      tags: [
        ['e', '5bffa3578b29401471ca2d7f2183c2fe1fda28fb69343f4852678c6c24db47cb'],
        ['e', parent.id, '', 'reply'],
        ['a', addr]
      ]
    });
    const related = new Set([article.id, parent.id, nested.id]);
    expect(isQuoteOfTarget(parent, article)).toBe(true);
    expect(isQuoteOfTarget(nested, article, related)).toBe(false);
    const parts = partitionWorkResponses([parent, nested], article);
    expect(parts.quotes.map((e) => e.id)).toEqual([parent.id]);
    expect(parts.thread.map((e) => e.id)).toEqual([nested.id]);
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

    const edition = ev({
      id: editionId,
      kind: KIND.PUBLICATION,
      pubkey: 'b'.repeat(64),
      tags: [['d', 'book']]
    });
    const comment = ev({
      id: rootId,
      kind: KIND.COMMENT,
      tags: [
        ['A', `${KIND.PUBLICATION}:${'b'.repeat(64)}:book`],
        ['K', String(KIND.PUBLICATION)],
        ['a', `${KIND.PUBLICATION}:${'b'.repeat(64)}:book`],
        ['e', editionId],
        ['k', String(KIND.PUBLICATION)]
      ]
    });
    const nestedOnly = ev({
      id: '3'.repeat(64),
      kind: KIND.TEXT_NOTE,
      tags: [['e', rootId, '', 'reply']]
    });
    const parts = partitionWorkResponses([comment, nestedOnly], edition);
    expect(parts.thread.map((e) => e.id).sort()).toEqual([comment.id, nestedOnly.id].sort());
  });

  it('does not put ratings, catalog documents, wiki redirects, or draft wraps in other responses', () => {
    const pk = 'b'.repeat(64);
    const edition = ev({
      id: 'a'.repeat(64),
      kind: KIND.PUBLICATION,
      pubkey: pk,
      tags: [['d', 'book'], ['title', 'Am Fluss der Zeiten']]
    });
    const rating = ev({
      id: '1'.repeat(64),
      kind: KIND.RATING,
      content: 'Great historical novel.',
      tags: [
        ['a', `30040:${pk}:book`],
        ['m', 'book'],
        ['rating', '1']
      ]
    });
    const catalogCopy = ev({
      id: '2'.repeat(64),
      kind: KIND.PUBLICATION,
      pubkey: 'c'.repeat(64),
      tags: [
        ['d', 'copy'],
        ['a', `30040:${pk}:book`],
        ['title', 'Am Fluss der Zeiten']
      ]
    });
    const review = ev({
      id: '3'.repeat(64),
      kind: 1244,
      content: 'A proper other response.',
      tags: [['a', `30040:${pk}:book`]]
    });
    const draftWrap = ev({
      id: '7'.repeat(64),
      kind: KIND.DRAFT_WRAP,
      pubkey: pk,
      content: '',
      tags: [
        ['d', 'book-draft'],
        ['k', '30040'],
        ['e', edition.id]
      ]
    });
    const wiki = ev({
      id: '4'.repeat(64),
      kind: KIND.WIKI,
      pubkey: pk,
      tags: [['d', 'bitcoin'], ['title', 'Bitcoin']]
    });
    const redirect = ev({
      id: '5'.repeat(64),
      kind: KIND.WIKI_REDIRECT,
      pubkey: 'd'.repeat(64),
      tags: [['d', 'btc'], ['a', `30818:${pk}:bitcoin`]]
    });
    const wikiNote = ev({
      id: '6'.repeat(64),
      kind: 1244,
      content: 'A wiki other response.',
      tags: [['a', `30818:${pk}:bitcoin`]]
    });
    const parts = partitionWorkResponses(
      [edition, rating, catalogCopy, review, draftWrap],
      edition
    );
    expect(parts.other.map((e) => e.id)).toEqual([review.id]);
    expect(parts.thread).toHaveLength(0);
    expect(parts.other.some((e) => e.kind === KIND.DRAFT_WRAP)).toBe(false);
    const wikiParts = partitionWorkResponses([wiki, redirect, wikiNote], wiki);
    expect(wikiParts.other.map((e) => e.id)).toEqual([wikiNote.id]);
    expect(wikiParts.other.some((e) => e.kind === KIND.WIKI_REDIRECT)).toBe(false);
  });

  it('lists bookmark, pin, and label authors separately from other responses', () => {
    const pk = 'b'.repeat(64);
    const note = ev({
      id: 'a'.repeat(64),
      kind: KIND.TEXT_NOTE,
      pubkey: pk,
      content: 'hello'
    });
    const bookmark = ev({
      id: '1'.repeat(64),
      kind: KIND.BOOKMARK,
      pubkey: 'c'.repeat(64),
      created_at: 3,
      tags: [['e', note.id]]
    });
    const pin = ev({
      id: '2'.repeat(64),
      kind: KIND.PIN,
      pubkey: 'd'.repeat(64),
      created_at: 2,
      tags: [['e', note.id]]
    });
    const label = ev({
      id: '3'.repeat(64),
      kind: KIND.LABEL,
      pubkey: 'e'.repeat(64),
      created_at: 1,
      tags: [
        ['e', note.id],
        ['l', 'booklist', 'ugc']
      ]
    });
    const parts = partitionWorkResponses([note, bookmark, pin, label], note);
    expect(parts.bookmarks.map((e) => e.id)).toEqual([bookmark.id]);
    expect(parts.pins.map((e) => e.id)).toEqual([pin.id]);
    expect(parts.labels.map((e) => e.id)).toEqual([label.id]);
    expect(parts.other).toEqual([]);
  });

  it('lists bookmark sets and curations as attributions, not other', () => {
    const note = ev({
      id: 'a'.repeat(64),
      kind: KIND.TEXT_NOTE,
      pubkey: 'b'.repeat(64),
      content: 'hello'
    });
    const bookmarkSet = ev({
      id: '4'.repeat(64),
      kind: KIND.BOOKMARK_SET,
      pubkey: 'c'.repeat(64),
      created_at: 4,
      tags: [
        ['d', 'reads'],
        ['e', note.id]
      ]
    });
    const curation = ev({
      id: '5'.repeat(64),
      kind: KIND.CURATION_ARTICLE,
      pubkey: 'd'.repeat(64),
      created_at: 3,
      tags: [
        ['d', 'yaks'],
        ['e', note.id]
      ]
    });
    const videoSet = ev({
      id: '6'.repeat(64),
      kind: KIND.CURATION_VIDEO,
      pubkey: 'e'.repeat(64),
      created_at: 2,
      tags: [
        ['d', 'clips'],
        ['e', note.id]
      ]
    });
    const parts = partitionWorkResponses([note, bookmarkSet, curation, videoSet], note);
    expect(parts.bookmarkSets.map((e) => e.id)).toEqual([bookmarkSet.id]);
    expect(parts.curations.map((e) => e.id).sort()).toEqual([curation.id, videoSet.id].sort());
    expect(parts.other).toEqual([]);
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

  it('lists earlier responses before later ones', () => {
    const parent = ev({
      id: 'a'.repeat(64),
      kind: KIND.COMMENT,
      created_at: 10
    });
    const early = ev({
      id: 'b'.repeat(64),
      kind: KIND.COMMENT,
      created_at: 20,
      tags: [['e', parent.id]]
    });
    const late = ev({
      id: 'c'.repeat(64),
      kind: KIND.COMMENT,
      created_at: 30,
      tags: [['e', parent.id]]
    });
    const laterRoot = ev({
      id: 'd'.repeat(64),
      kind: KIND.COMMENT,
      created_at: 40
    });
    const tree = nestComments([late, laterRoot, parent, early]);
    expect(tree.map((node) => node.event?.id)).toEqual([parent.id, laterRoot.id]);
    expect(tree[0]?.children.map((node) => node.event?.id)).toEqual([early.id, late.id]);
  });

  it('shows a missing parent as a top-level row', () => {
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
    expect(tree[0]?.event?.id).toBe(reply.id);
    expect(tree[0]?.placeholder).toBeNull();
    expect(tree[1]?.event?.id).toBe(other.id);
    expect(threadNodeKey(tree[0]!)).not.toBe(threadNodeKey(tree[1]!));
  });

  it('treats a lowercase a-tag of the OP as a thread root', () => {
    const edition = ev({
      id: 'a'.repeat(64),
      kind: KIND.PUBLICATION,
      pubkey: 'bb'.repeat(32),
      tags: [['d', 'book']]
    });
    const onEdition = ev({
      id: '2'.repeat(64),
      kind: KIND.COMMENT,
      tags: [['a', `30040:${edition.pubkey}:book`]]
    });
    const tree = nestComments([onEdition], undefined, threadRootKeys(edition));
    expect(tree).toHaveLength(1);
    expect(tree[0]?.event?.id).toBe(onEdition.id);
    expect(tree[0]?.placeholder).toBeNull();
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
    const mute = {
      pubkeys: new Set([parent.pubkey]),
      eventIds: new Set<string>(),
      hashtags: new Set<string>(),
      words: new Set<string>()
    };
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
    expect(draft.tags).toContainEqual(['e', note.id, '', 'reply', note.pubkey]);
    expect(draft.tags.some((t) => t[0] === 'p' && t[1] === note.pubkey)).toBe(true);
  });

  it('defaults kind 1 originals to 1111 and can emit a single root e as a reply', () => {
    const note = ev({
      id: 'b'.repeat(64),
      kind: KIND.TEXT_NOTE,
      pubkey: '2'.repeat(64),
      tags: []
    });
    expect(canOfferKind1Reply(note)).toBe(true);
    expect(commentDraft(note, 'comment').kind).toBe(KIND.COMMENT);
    const asReply = commentDraft(note, 'reply', undefined, { asKind1Reply: true });
    expect(asReply.kind).toBe(KIND.TEXT_NOTE);
    expect(asReply.tags.filter((t) => t[0] === 'e')).toEqual([
      ['e', note.id, '', 'root', note.pubkey]
    ]);
    expect(nip10ReplyTags(note)).toContainEqual(['e', note.id, '', 'root', note.pubkey]);
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
    expect(draft.tags).toContainEqual(['e', rating.id, '', rating.pubkey]);
    expect(nip22TagsForTarget(rating).some((t) => t[0] === 'a')).toBe(true);
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

    const publicMsg = ev({
      id: 'd'.repeat(64),
      kind: KIND.PUBLIC_MESSAGE,
      pubkey: '4'.repeat(64),
      tags: [['p', '5'.repeat(64)]]
    });
    expect(reactionDraft(publicMsg).tags).toContainEqual(['k', String(KIND.PUBLIC_MESSAGE)]);
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
    expect(likePubkeys([a, aNewer, b, dislike])).toEqual(['p'.repeat(64), 'q'.repeat(64)]);
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

  it('assigns mine, follows, curator guides with dedup and reference recency', () => {
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
    expect(shelves.map((s) => s.id)).toEqual(['mine', 'follows', 'guides']);
    expect(shelves[0]?.events.map((e) => e.id)).toEqual([pubA.id, pubE.id]);
    // Follow keeps pubB; pubE is mine-exclusive so not duplicated onto follows.
    expect(shelves[1]?.events.map((e) => e.id)).toEqual([pubB.id]);
    // Guides keeps curator pubC; pubE also had a curator membership but mine won.
    expect(shelves[2]?.events.map((e) => e.id)).toEqual([pubC.id]);
    // Stranger booklists (pubD) no longer get a landing shelf.
  });

  it('gives guides the edition when both a follow and the curator list it', () => {
    const me = '6'.repeat(64);
    const follow = '7'.repeat(64);
    const labels = [
      booklist(follow, pubA, 10),
      booklist(GITCITADEL_CURATOR_HEX, pubA, 12)
    ];
    const memberships = membershipsFromEvents(labels);
    const pubs = new Map([[addr(pubA), pubA]]);
    const shelves = assignShelves(memberships, pubs, me, new Set([follow]));
    expect(shelves.map((s) => s.id)).toEqual(['guides']);
    expect(shelves[0]?.events.map((e) => e.id)).toEqual([pubA.id]);
  });

  it('always puts curator memberships on From the guides, even when the curator is followed', () => {
    const me = '6'.repeat(64);
    const labels = [booklist(GITCITADEL_CURATOR_HEX, pubC, 12)];
    const memberships = membershipsFromEvents(labels);
    const pubs = new Map([[addr(pubC), pubC]]);
    expect(
      assignShelves(memberships, pubs, me, new Set([GITCITADEL_CURATOR_HEX])).map((s) => s.id)
    ).toEqual(['guides']);
    expect(assignShelves(memberships, pubs, me, new Set()).map((s) => s.id)).toEqual(['guides']);
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

  it('omits nested chapter 30040s when a parent edition is known', () => {
    const me = '6'.repeat(64);
    const pk = '1'.repeat(64);
    const chapter = ev({
      id: 'f'.repeat(64),
      pubkey: pk,
      kind: KIND.PUBLICATION,
      tags: [['d', 'gen-ch-1'], ['title', 'Chapter 1']]
    });
    const edition = ev({
      id: 'a'.repeat(64),
      pubkey: pk,
      kind: KIND.PUBLICATION,
      tags: [['d', 'genesis'], ['title', 'Genesis'], ['a', addr(chapter)]]
    });
    const labels = [booklist(me, chapter, 10), booklist(me, edition, 11)];
    const pubs = new Map([
      [addr(chapter), chapter],
      [addr(edition), edition]
    ]);
    const shelves = assignShelves(membershipsFromEvents(labels), pubs, me, new Set());
    expect(shelves[0]?.events.map((e) => e.id)).toEqual([edition.id]);
    expect(topLevelShelfEvents([chapter, edition], [chapter, edition]).map((e) => e.id)).toEqual([
      edition.id
    ]);
  });

  it('promotes a lone chapter membership to its parent edition', () => {
    const me = '6'.repeat(64);
    const pk = '1'.repeat(64);
    const chapter = ev({
      id: 'f'.repeat(64),
      pubkey: pk,
      kind: KIND.PUBLICATION,
      tags: [['d', 'gen-ch-1'], ['title', 'Chapter 1']]
    });
    const edition = ev({
      id: 'a'.repeat(64),
      pubkey: pk,
      kind: KIND.PUBLICATION,
      tags: [['d', 'genesis'], ['title', 'Genesis'], ['a', addr(chapter)]]
    });
    const labels = [booklist(me, chapter, 10)];
    const pubs = new Map([
      [addr(chapter), chapter],
      [addr(edition), edition]
    ]);
    const shelves = assignShelves(membershipsFromEvents(labels), pubs, me, new Set());
    expect(shelves[0]?.events.map((e) => e.id)).toEqual([edition.id]);
  });

  it('collapses same-author same-cover chapters when no parent is known', () => {
    const pk = '1'.repeat(64);
    const cover = 'https://example.com/bible.jpg';
    const ch1 = ev({
      id: 'a'.repeat(64),
      pubkey: pk,
      kind: KIND.PUBLICATION,
      tags: [
        ['d', 'bible-douay-rheims-version-ot-the-bk-numbers-numbers-ch-1'],
        ['title', 'Numbers 1'],
        ['image', cover]
      ]
    });
    const ch7 = ev({
      id: 'b'.repeat(64),
      pubkey: pk,
      kind: KIND.PUBLICATION,
      tags: [
        ['d', 'bible-douay-rheims-version-ot-the-bk-numbers-numbers-ch-7'],
        ['title', 'Numbers 7'],
        ['image', cover]
      ]
    });
    const rootish = ev({
      id: 'c'.repeat(64),
      pubkey: pk,
      kind: KIND.PUBLICATION,
      tags: [
        ['d', 'bible-douay-rheims'],
        ['title', 'The Holie Bible'],
        ['image', cover]
      ]
    });
    expect(collapseSameCoverEditions([ch1, ch7, rootish]).map((e) => e.id)).toEqual([rootish.id]);
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

  it('folds deprecated monero_address into payment targets and drops it from extras', () => {
    const xmr =
      '45meWoaPdsEbqEzR5VexxH3J3WfRp44s2a9XwxkMzrTqZv2b3SqhG9jLk5CoaBmoq8PNo1BhGT8QqW2U6cedSkDaEgZGk7g';
    const profile = ev({
      kind: 0,
      content: JSON.stringify({
        name: 'Matt',
        lud16: 'mattyb@plume.website',
        monero_address: xmr
      }),
      tags: [
        ['name', 'Matt'],
        ['lud16', 'mattyb@plume.website'],
        ['payto', 'monero', xmr]
      ]
    });
    const fields = parseKind0(profile);
    expect(fields.extra.monero_address).toBeUndefined();
    expect(fields.moneroAddress).toBe(xmr);
    const rows = paymentRows(fields, [], profile);
    expect(rows.filter((r) => r.type === 'monero')).toHaveLength(1);
    expect(rows.find((r) => r.type === 'monero')?.label).toBe(xmr);
  });

  it('does not invent a blank monero row when monero_address is empty', () => {
    const xmr =
      '467NQj2pchUdA4S3TrB5aA6KJZ2Q5NAMt7tFqwwB2Vofgbo24Hbntg8evTN3E9V2rj8AM4LShL8PQCcuZSZwgR8uAAxFmir';
    const profile = ev({
      kind: 0,
      content: JSON.stringify({ name: 'verbiricha', lud16: 'verbiricha@rizful.com' }),
      tags: [['lud16', 'verbiricha@rizful.com']]
    });
    const payment = ev({
      kind: 10133,
      tags: [
        ['payto', 'lightning', 'verbiricha@rizful.com'],
        ['payto', 'monero', xmr]
      ],
      content: ''
    });
    const rows = paymentRows(parseKind0(profile), [payment], profile);
    expect(rows.filter((r) => r.type === 'monero')).toHaveLength(1);
    expect(rows.find((r) => r.type === 'monero')?.label).toBe(xmr);
    expect(rows.some((r) => !r.label.trim())).toBe(false);
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

  it('linkifies nostr: addresses in about text', async () => {
    const { aboutHtml } = await import('./profile-fields');
    const { nip19 } = await import('nostr-tools');
    const pk = 'a'.repeat(64);
    const npub = nip19.npubEncode(pk);
    const html = aboutHtml(`Sponsors: nostr:${npub} and https://example.com/x`);
    expect(html).toContain(`href="#/p/${npub}"`);
    expect(html).toContain('class="profile-about-nostr"');
    expect(html).toContain('href="https://example.com/x"');
    expect(html).not.toContain(`nostr:${npub}</a>`);
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
    expect(rewriteBareImageUrls(`before\n${gif}\nafter`, 'djot')).toContain(`![](${gif})`);
    expect(rewriteBareImageUrls(gif, 'asciidoc')).toContain(`image::${gif}[]`);
    expect(rewriteBareImageUrls(`![](${gif})`, 'djot')).toBe(`![](${gif})`);
  });

  it('renders a NIP-92 imeta file instead of leaving the URL as text', () => {
    const url =
      'https://npub1uwjejfyn8j0e7t0cx3ys2h4nsk83fq8a6rz7mw2a7z97mnfwvcjqcvaxfl.blossom.band/39a8333ea419edbd9afd4da15d97f701547e29c71817b4725b1f8332d21af272.jpg';
    const event = ev({
      kind: 1,
      content: url,
      tags: [
        [
          'imeta',
          `url ${url}`,
          'm image/jpeg',
          'alt A plate of pasta',
          'thumbhash YFkKJwZflVdteHhjeHh5WHeH9pt44KAH',
          'dim 1229x1280'
        ]
      ]
    });
    expect(imetaMedia(event)).toEqual([
      { type: 'image', url, alt: 'A plate of pasta', width: 1229, height: 1280 }
    ]);
    expect(uniqueMedia(event)).toEqual([
      { type: 'image', url, alt: 'A plate of pasta', width: 1229, height: 1280 }
    ]);
    expect(omitMediaUrls(event.content, imetaMedia(event))).toBe('');
    expect(omitMediaUrls(`line one\n\n${url}`, imetaMedia(event))).toBe('line one');
  });

  it('plays a bare content mp4 without an imeta tag', () => {
    const video =
      'https://blossom.primal.net/a0aab4383c0320f19aaa84525e99d8edf4ff9300acee5872c4ae4b43a6bcc336.mp4';
    const event = ev({
      kind: 1,
      content: `⚡️🇺🇸 NEW - Obama: Iran didn't have nuclear weapons.\n${video}`,
      tags: [['client', 'Primal iOS']]
    });
    expect(uniqueMedia(event)).toEqual([{ type: 'video', url: video }]);
    expect(omitMediaUrls(event.content, uniqueMedia(event))).toBe(
      "⚡️🇺🇸 NEW - Obama: Iran didn't have nuclear weapons."
    );
  });

  it('uses the imeta mime when the file URL has no extension', () => {
    const url = 'https://blossom.example/abcdef';
    const video = 'https://blossom.example/clip.mp4';
    const event = ev({
      kind: 1,
      content: `caption ${url}`,
      tags: [
        ['imeta', 'url', url, 'm', 'image/jpeg'],
        ['imeta', `url ${video}`, 'm video/mp4', 'image https://blossom.example/poster.jpg']
      ]
    });
    expect(imetaMedia(event)).toEqual([
      { type: 'image', url },
      { type: 'video', url: video, poster: 'https://blossom.example/poster.jpg' }
    ]);
  });

  it('treats a resized or extensionless copy as the same file', () => {
    const url = 'https://cdn.example/pic.jpg';
    const hash =
      '39a8333ea419edbd9afd4da15d97f701547e29c71817b4725b1f8332d21af272';
    const blossom = `https://blossom.example/${hash}.jpg`;
    const bare = `https://cdn.example/${hash}`;
    expect(sameMedia(url, `${url}?w=800`)).toBe(true);
    expect(sameMedia('https://i.nostr.build/plate.jpg', 'https://i.nostr.build/thumb/plate.jpg')).toBe(
      true
    );
    expect(sameMedia(blossom, bare)).toBe(true);
    expect(sameMedia('https://cdn.example/view?id=1', 'https://cdn.example/view?id=2')).toBe(false);

    const event = ev({
      kind: 1,
      content: `look ${url}?w=800\n\nhttps://i.nostr.build/thumb/plate.jpg`,
      tags: [
        ['imeta', `url ${url}`, 'm image/jpeg'],
        ['imeta', 'url https://i.nostr.build/plate.jpg', 'm image/jpeg'],
        ['imeta', `url ${bare}`, 'm image/jpeg']
      ]
    });
    expect(imetaMedia(event)).toHaveLength(3);
    expect(uniqueMedia(event)).toHaveLength(3);
    expect(omitMediaUrls(event.content, imetaMedia(event))).toBe('look');
    const html = `<p>look</p><p><img src="${url}?w=800" alt=""></p><p><a href="${blossom}">${blossom}</a></p>`;
    expect(stripRenderedMedia(html, imetaMedia(event).map((item) => item.url))).toBe('<p>look</p>');
  });

  it('promotes linkified image autolinks to img tags', () => {
    const url = 'https://i.nostr.build/cover.webp';
    const html = `<p><a href="${url}">${url}</a></p>`;
    expect(promoteImageAutolinks(html)).toContain(`<img src="${url}"`);
    expect(promoteImageAutolinks(html)).not.toContain('<a ');
  });
});
