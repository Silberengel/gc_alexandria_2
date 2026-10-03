import type { Event, Filter } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { KIND, MUTED_PARENT_PLACEHOLDER } from './constants';
import { type MuteState, isMutedEvent } from './mute';
import { publicationCoordinateLookupKeys, coordinatesOverlap } from './publication-coordinate';
import { fetchByIds } from './nostr/fetch';
import { relayPool } from './nostr/pool';
import { documentStack, highlightStack, socialSearchStack, socialStack } from './nostr/selector';
import { eventAddress } from './nostr/verify';
import { splitNostrRefs } from './nostr-refs';

export type ThreadNode = {
  event: Event | null;
  placeholder: string | null;
  /** Parent event id when this node is a muted/missing-parent placeholder. */
  missingParentId?: string;
  children: ThreadNode[];
};

/** Stable keyed-each id for a thread node (placeholders share the same label text). */
export function threadNodeKey(node: ThreadNode): string {
  if (node.event?.id) return node.event.id.toLowerCase();
  if (node.missingParentId) return `ph:${node.missingParentId}`;
  return `ph:${node.placeholder ?? 'unknown'}`;
}

const HEX_ID = /^[0-9a-f]{64}$/;

/** Kind 1111 NIP-22 comments and kind 1 NIP-10 notes that participate in a thread. */
export function isThreadEvent(event: Event): boolean {
  return event.kind === KIND.COMMENT || event.kind === KIND.TEXT_NOTE;
}

function tagHasThreadMarker(t: string[]): boolean {
  const marked = (v: string | undefined) => v === 'root' || v === 'reply';
  return marked(t[2]) || marked(t[3]);
}

/** Kind 1 with NIP-10 `e` tags, or an `a`/`A` tag marked `root`/`reply` (comment on an addressable). */
export function isKind1Reply(event: Event): boolean {
  if (event.kind !== KIND.TEXT_NOTE) return false;
  return event.tags.some(
    (t) => (t[0] === 'e' && t[1]) || ((t[0] === 'a' || t[0] === 'A') && t[1] && tagHasThreadMarker(t))
  );
}

/** Kind 1 original: offer 1111 by default, plus an optional kind 1 reply. */
export function canOfferKind1Reply(parent: Event): boolean {
  return parent.kind === KIND.TEXT_NOTE && !isKind1Reply(parent);
}

function nip22Coordinate(event: Event): string | null {
  const pk = event.pubkey.toLowerCase();
  if (event.kind >= 30000 && event.kind < 40000) {
    const d = event.tags.find((t) => t[0] === 'd')?.[1] ?? '';
    return `${event.kind}:${pk}:${d}`;
  }
  if (event.kind === 0 || event.kind === 3 || (event.kind >= 10000 && event.kind < 20000)) {
    return `${event.kind}:${pk}:`;
  }
  return null;
}

/**
 * Parent pointer for nesting.
 * NIP-22: lowercase `e` / `a` / `i` (ignore uppercase when those exist).
 * NIP-10: `reply` when both `root` and `reply` exist, else last `e` (positional parent).
 */
export function commentParentId(event: Event): string | null {
  if (event.kind === KIND.TEXT_NOTE) {
    const eTags = event.tags.filter((t) => t[0] === 'e' && t[1]);
    if (eTags.length) {
      const hasRoot = eTags.some((t) => t[3] === 'root');
      const reply = eTags.find((t) => t[3] === 'reply');
      if (hasRoot && reply?.[1]) return reply[1].toLowerCase();
      const marked = reply ?? eTags[eTags.length - 1];
      return marked?.[1]?.toLowerCase() ?? null;
    }
    const aTags = event.tags.filter(
      (t) => (t[0] === 'a' || t[0] === 'A') && t[1] && tagHasThreadMarker(t)
    );
    const aReply = aTags.find((t) => t[3] === 'reply');
    const aRoot = aTags.find((t) => t[3] === 'root');
    return aReply?.[1] ?? aRoot?.[1] ?? null;
  }
  const e = event.tags.find((t) => t[0] === 'e' && t[1]);
  if (e?.[1]) return e[1].toLowerCase();
  const a = event.tags.find((t) => t[0] === 'a' && t[1]);
  if (a?.[1]) return a[1];
  const i = event.tags.find((t) => t[0] === 'i' && t[1]);
  if (i?.[1]) return i[1];
  return null;
}

/** Ids, addresses, and NIP-73 scopes that count as this OP for nesting. */
export function threadRootKeys(target: Event): string[] {
  const keys = new Set<string>();
  keys.add(target.id.toLowerCase());
  const addr = eventAddress(target);
  keys.add(addr);
  for (const k of publicationCoordinateLookupKeys(addr)) keys.add(k);
  const coord = nip22Coordinate(target);
  if (coord) keys.add(coord);
  for (const t of target.tags) {
    if ((t[0] === 'i' || t[0] === 'I') && t[1]) keys.add(t[1]);
  }
  return [...keys];
}

function kind1ETagIds(event: Event): string[] {
  const ids: string[] = [];
  for (const t of event.tags) {
    if ((t[0] === 'e' || t[0] === 'E') && t[1] && HEX_ID.test(t[1])) ids.push(t[1].toLowerCase());
  }
  return ids;
}

/** `wss://` / `ws://` from NIP-10 `e`/`E` tags — where that parent was seen. */
export function eTagRelayHints(events: Event[]): Map<string, string[]> {
  const hints = new Map<string, string[]>();
  for (const event of events) {
    for (const t of event.tags) {
      if ((t[0] !== 'e' && t[0] !== 'E') || !t[1] || !HEX_ID.test(t[1])) continue;
      const relay = t[2]?.trim();
      if (!relay || !/^wss?:\/\//i.test(relay)) continue;
      const id = t[1].toLowerCase();
      const key = relay.replace(/\/+$/, '').toLowerCase();
      const list = hints.get(id) ?? [];
      if (!list.some((u) => u.replace(/\/+$/, '').toLowerCase() === key)) {
        list.push(relay);
        hints.set(id, list);
      }
    }
  }
  return hints;
}

/** Parent ids referenced by thread events that are not yet in `have`. */
export function missingCommentParentIds(
  events: Event[],
  have: ReadonlySet<string>,
  rootEventIds: Iterable<string> = [],
  target?: Event
): string[] {
  const roots = new Set(
    [...rootEventIds].map((id) => id.toLowerCase()).filter((id) => HEX_ID.test(id))
  );
  let follow: Event[];
  if (target) {
    const threadIds = workThreadIds(events, target);
    follow = events.filter((event) => event?.id && threadIds.has(event.id.toLowerCase()));
  } else {
    follow = events.filter((event) => isThreadEvent(event));
  }
  const missing = new Set<string>();
  for (const event of follow) {
    const refs = kind1ETagIds(event);
    const parentId = commentParentId(event);
    if (parentId && HEX_ID.test(parentId)) refs.push(parentId);
    for (const id of refs) {
      if (!id || roots.has(id) || have.has(id)) continue;
      missing.add(id);
    }
  }
  return [...missing];
}

export function nestComments(
  comments: Event[],
  mute?: MuteState,
  /** OP event ids, addresses, and `i` scopes — replies to these are roots. */
  rootKeys: Iterable<string> = []
): ThreadNode[] {
  const rootsSet = new Set(
    [...rootKeys].map((k) => (HEX_ID.test(k.toLowerCase()) ? k.toLowerCase() : k))
  );
  const visible = comments.filter((c) => isThreadEvent(c) && !(mute && isMutedEvent(c, mute)));
  const visibleIds = new Set(visible.map((c) => c.id.toLowerCase()));
  const allById = new Map(comments.map((c) => [c.id.toLowerCase(), c]));
  const byAddress = new Map<string, Event>();
  for (const event of comments) {
    const addr = eventAddress(event);
    byAddress.set(addr, event);
    const coord = nip22Coordinate(event);
    if (coord) byAddress.set(coord, event);
  }
  const nodes = new Map<string, ThreadNode>();
  const placeholders = new Map<string, ThreadNode>();

  function nodeFor(event: Event): ThreadNode {
    const id = event.id.toLowerCase();
    let node = nodes.get(id);
    if (!node) {
      node = { event, placeholder: null, children: [] };
      nodes.set(id, node);
    }
    return node;
  }

  function attachUnderPlaceholder(parentId: string, node: ThreadNode, label: string): void {
    let placeholder = placeholders.get(parentId);
    if (!placeholder) {
      placeholder = {
        event: null,
        placeholder: label,
        missingParentId: parentId,
        children: []
      };
      placeholders.set(parentId, placeholder);
      roots.push(placeholder);
    }
    placeholder.children.push(node);
  }

  function resolveParent(parentRef: string): Event | undefined {
    if (HEX_ID.test(parentRef)) return allById.get(parentRef);
    return byAddress.get(parentRef);
  }

  const roots: ThreadNode[] = [];
  const seenRoot = new Set<ThreadNode>();

  function pushRoot(node: ThreadNode): void {
    if (seenRoot.has(node)) return;
    seenRoot.add(node);
    roots.push(node);
  }

  for (const comment of visible) {
    const node = nodeFor(comment);
    const parentRef = commentParentId(comment);
    if (!parentRef || rootsSet.has(parentRef)) {
      pushRoot(node);
      continue;
    }
    const parent = resolveParent(parentRef);
    if (parent && visibleIds.has(parent.id.toLowerCase())) {
      nodeFor(parent).children.push(node);
      continue;
    }
    if (parent && mute && isMutedEvent(parent, mute)) {
      attachUnderPlaceholder(parent.id.toLowerCase(), node, MUTED_PARENT_PLACEHOLDER);
      continue;
    }
    pushRoot(node);
  }

  return roots;
}

/** Continue a NIP-10 kind 1 reply with kind 1; kind 1 originals and everything else get 1111. */
export function shouldReplyWithKind1(replyTo: Event): boolean {
  return isKind1Reply(replyTo);
}

function nip10ETag(id: string, marker: 'root' | 'reply', pubkey?: string): string[] {
  const tag = ['e', id.toLowerCase(), '', marker];
  if (pubkey && HEX_ID.test(pubkey.toLowerCase())) tag.push(pubkey.toLowerCase());
  return tag;
}

function copyPTags(from: Event): string[][] {
  const tags: string[][] = [];
  const seenP = new Set<string>();
  for (const t of from.tags) {
    if (t[0] !== 'p' || !t[1]) continue;
    const pk = t[1].toLowerCase();
    if (seenP.has(pk)) continue;
    seenP.add(pk);
    tags.push(t.length > 2 ? ['p', pk, t[2]!] : ['p', pk]);
  }
  const author = from.pubkey.toLowerCase();
  if (!seenP.has(author)) tags.push(['p', author]);
  return tags;
}

/** NIP-10 e/p tags for a kind 1 reply to another kind 1. */
export function nip10ReplyTags(
  replyTo: Event,
  workEventIds: Iterable<string> = []
): string[][] {
  const work = new Set(
    [...workEventIds].map((id) => id.toLowerCase()).filter((id) => HEX_ID.test(id))
  );
  const eTags = replyTo.tags.filter((t) => t[0] === 'e' && t[1]);
  if (!eTags.length) {
    return [nip10ETag(replyTo.id, 'root', replyTo.pubkey), ...copyPTags(replyTo)];
  }
  const markedRoot = eTags.find((t) => t[3] === 'root');
  const rootId =
    markedRoot?.[1]?.toLowerCase() ??
    eTags.find((t) => t[1] && work.has(t[1].toLowerCase()))?.[1]?.toLowerCase() ??
    eTags[0]?.[1]?.toLowerCase() ??
    replyTo.id.toLowerCase();
  const rootPk = markedRoot?.[4] || (rootId === replyTo.id.toLowerCase() ? replyTo.pubkey : '');
  return [
    nip10ETag(rootId, 'root', rootPk),
    nip10ETag(replyTo.id, 'reply', replyTo.pubkey),
    ...copyPTags(replyTo)
  ];
}

function copyNip22Root(from: Event): string[][] | null {
  const A = from.tags.find((t) => t[0] === 'A' && t[1]);
  const E = from.tags.find((t) => t[0] === 'E' && t[1]);
  const I = from.tags.find((t) => t[0] === 'I' && t[1]);
  if (!A && !E && !I) return null;
  const tags: string[][] = [];
  if (A) tags.push(['A', A[1]!]);
  else if (E) {
    const id = E[1]!.toLowerCase();
    const relay = E[2] ?? '';
    const pk = E[3] ?? '';
    tags.push(pk ? ['E', id, relay, pk.toLowerCase()] : ['E', id, relay]);
  } else if (I) tags.push(['I', I[1]!]);
  const K = from.tags.find((t) => t[0] === 'K' && t[1]);
  const P = from.tags.find((t) => t[0] === 'P' && t[1]);
  if (K) tags.push(['K', K[1]!]);
  if (P && (A || E)) tags.push(['P', P[1]!.toLowerCase()]);
  return tags;
}

function buildNip22Root(target: Event): string[][] {
  const pk = target.pubkey.toLowerCase();
  const coord = nip22Coordinate(target);
  if (coord) return [['A', coord], ['K', String(target.kind)], ['P', pk]];
  return [['E', target.id.toLowerCase(), '', pk], ['K', String(target.kind)], ['P', pk]];
}

function nip22ParentTags(parent: Event): string[][] {
  const pk = parent.pubkey.toLowerCase();
  return [
    ['e', parent.id.toLowerCase(), '', pk],
    ['k', String(parent.kind)],
    ['p', pk]
  ];
}

export function nip22TagsForTarget(target: Event, replyTo?: Event): string[][] {
  const pk = target.pubkey.toLowerCase();
  if (replyTo) {
    const root = copyNip22Root(replyTo) ?? buildNip22Root(target);
    return [...root, ...nip22ParentTags(replyTo)];
  }
  const coord = nip22Coordinate(target);
  if (coord) {
    return [
      ...buildNip22Root(target),
      ['a', coord],
      ['e', target.id.toLowerCase(), '', pk],
      ['k', String(target.kind)],
      ['p', pk]
    ];
  }
  return [...buildNip22Root(target), ...nip22ParentTags(target)];
}

/** Social + document (+ inbox/outbox when signed in). Kind 1 search relays are a follow-up. */
function threadRelayUniverse(): string[] {
  const urls = [...new Set([...highlightStack(), ...socialStack(), ...documentStack()])];
  const key = (u: string) => u.replace(/\/+$/, '').toLowerCase();
  const aggr = urls.find((u) => key(u).includes('aggr.nostr.land'));
  if (!aggr) return urls;
  return [aggr, ...urls.filter((u) => key(u) !== key(aggr))];
}

/**
 * Pull missing parent events by id from `e`-tag hints and SOCIAL_SEARCH_RELAYS,
 * then the rest of the thread relay universe.
 */
export async function resolveMissingCommentParents(
  events: Event[],
  rootEventIds: Iterable<string> = [],
  maxHops = 4,
  target?: Event
): Promise<Event[]> {
  const byId = new Map<string, Event>();
  for (const e of events) {
    if (e?.id) byId.set(e.id.toLowerCase(), e);
  }
  const roots = [...rootEventIds];

  for (let hop = 0; hop < maxHops; hop++) {
    const batch = [...byId.values()];
    const missing = missingCommentParentIds(batch, new Set(byId.keys()), roots, target).slice(0, 24);
    if (!missing.length) break;

    const hintMap = eTagRelayHints(batch);
    const hintRelays = [...new Set(missing.flatMap((id) => hintMap.get(id) ?? []))];
    const searchRelays = [...new Set([...hintRelays, ...socialSearchStack()])];
    const fromSearch = await relayPool.query(
      searchRelays,
      [{ ids: missing, limit: missing.length }],
      4000,
      6
    );
    for (const e of fromSearch) {
      if (e?.id) byId.set(e.id.toLowerCase(), e);
    }

    let still = missing.filter((id) => !byId.has(id));
    if (still.length) {
      const fromThread = await relayPool.query(
        threadRelayUniverse(),
        [{ ids: still, limit: still.length }],
        4000,
        4
      );
      for (const e of fromThread) {
        if (e?.id) byId.set(e.id.toLowerCase(), e);
      }
      still = missing.filter((id) => !byId.has(id));
    }
    if (!still.length) continue;

    const found = await fetchByIds(still, 8);
    for (const e of found) byId.set(e.id.toLowerCase(), e);
  }

  return [...byId.values()];
}

/** True when a `q` tag value points at this work (hex id, address, or bech32). */
export function qTagMatchesTarget(raw: string, target: Event): boolean {
  const v = raw.trim();
  if (!v) return false;
  const id = target.id.toLowerCase();
  if (v.toLowerCase() === id) return true;
  const addr = eventAddress(target);
  const addrKeys = new Set(publicationCoordinateLookupKeys(addr));
  if (addrKeys.has(v) || coordinatesOverlap(v, addr)) return true;
  try {
    const decoded = nip19.decode(v.replace(/^nostr:/i, '').trim());
    if (decoded.type === 'note' && String(decoded.data).toLowerCase() === id) return true;
    if (decoded.type === 'nevent' && decoded.data.id.toLowerCase() === id) return true;
    if (decoded.type === 'naddr') {
      const pk = String(decoded.data.pubkey).toLowerCase();
      const key = `${decoded.data.kind}:${pk}:${decoded.data.identifier}`;
      return addrKeys.has(key) || coordinatesOverlap(key, addr);
    }
  } catch {
    /* not bech32 */
  }
  return false;
}

/** True when note content embeds this work as naddr / nevent / note. Embedding is quoting. */
export function contentEmbedsTarget(event: Event, target: Event): boolean {
  const text = event.content ?? '';
  if (!text) return false;
  const id = target.id.toLowerCase();
  const addr = eventAddress(target);
  for (const part of splitNostrRefs(text)) {
    if (part.type !== 'ref') continue;
    if (part.kind === 'note' || part.kind === 'nevent') {
      if (part.id?.toLowerCase() === id) return true;
      if (part.raw && qTagMatchesTarget(part.raw, target)) return true;
      if (part.bech32 && qTagMatchesTarget(part.bech32, target)) return true;
    }
    if (part.kind === 'naddr' && part.naddr) {
      const key = `${part.naddr.kind}:${part.naddr.pubkey.toLowerCase()}:${part.naddr.identifier}`;
      if (coordinatesOverlap(key, addr)) return true;
    }
  }
  return false;
}

function hasEventIdTag(event: Event): boolean {
  return event.tags.some((t) => (t[0] === 'e' || t[0] === 'E') && t[1]);
}

function eTagsIncludeId(event: Event, id: string): boolean {
  const want = id.toLowerCase();
  return event.tags.some((t) => (t[0] === 'e' || t[0] === 'E') && t[1]?.toLowerCase() === want);
}

function addressTagsTarget(event: Event, target: Event): boolean {
  const addr = eventAddress(target);
  const addrKeys = new Set(publicationCoordinateLookupKeys(addr));
  return event.tags.some(
    (t) => (t[0] === 'a' || t[0] === 'A') && t[1] && (addrKeys.has(t[1]) || coordinatesOverlap(t[1], addr))
  );
}

/** Kind 1 that `a`/`A`-tags this OP with NIP-10 `root`/`reply` — a comment, not a quote. */
function addressThreadMarker(event: Event, target: Event): boolean {
  const addr = eventAddress(target);
  const addrKeys = new Set(publicationCoordinateLookupKeys(addr));
  return event.tags.some(
    (t) =>
      (t[0] === 'a' || t[0] === 'A') &&
      t[1] &&
      tagHasThreadMarker(t) &&
      (addrKeys.has(t[1]) || coordinatesOverlap(t[1], addr))
  );
}

function nip10HitsIds(event: Event, ids: ReadonlySet<string>): boolean {
  return event.tags.some((t) => (t[0] === 'e' || t[0] === 'E') && t[1] && ids.has(t[1].toLowerCase()));
}

function qTagsTarget(event: Event, target: Event): boolean {
  return event.tags.some((t) => t[0] === 'q' && t[1] && qTagMatchesTarget(t[1], target));
}

/** Citation of this OP (`q` or `nostr:` embed) — not the same as a thread pointer. */
function citesTarget(event: Event, target: Event): boolean {
  return qTagsTarget(event, target) || contentEmbedsTarget(event, target);
}

function relatedEventIds(events: Event[], target: Event): Set<string> {
  const ids = new Set<string>([target.id.toLowerCase()]);
  for (const event of events) {
    if (!event?.id) continue;
    if (referencesTarget(event, target)) ids.add(event.id.toLowerCase());
  }
  return ids;
}

/**
 * Quote of this OP: cites it (`q`, content embed, or unmarked `a` from another thread)
 * and is not a comment on it. Citations win over a-only address tags.
 */
export function isQuoteOfTarget(
  event: Event,
  target: Event,
  relatedIds?: ReadonlySet<string>
): boolean {
  if (event.kind !== KIND.TEXT_NOTE) return false;
  if (eTagsIncludeId(event, target.id)) return false;
  if (addressThreadMarker(event, target)) return false;
  if (relatedIds && nip10HitsIds(event, relatedIds)) return false;
  if (citesTarget(event, target)) return true;
  if (addressTagsTarget(event, target) && !hasEventIdTag(event)) return false;
  return addressTagsTarget(event, target);
}

/** Kind 1111 / kind 1 / 9802 that points at this work with e/E and/or a/A (or q). */
export function referencesTarget(event: Event, target: Event): boolean {
  const id = target.id.toLowerCase();
  const addrKeys = new Set(publicationCoordinateLookupKeys(eventAddress(target)));
  const iKeys = new Set(
    target.tags.filter((t) => (t[0] === 'i' || t[0] === 'I') && t[1]).map((t) => t[1]!)
  );
  for (const t of event.tags) {
    const name = t[0];
    const v = t[1]?.trim();
    if (!v) continue;
    if ((name === 'e' || name === 'E') && v.toLowerCase() === id) return true;
    if ((name === 'a' || name === 'A') && addrKeys.has(v)) return true;
    if ((name === 'i' || name === 'I') && iKeys.has(v)) return true;
    if (name === 'q' && qTagMatchesTarget(v, target)) return true;
  }
  return contentEmbedsTarget(event, target);
}

export type WorkResponses = {
  /** Kind 1111 comments and NIP-10 kind 1 replies. */
  thread: Event[];
  /** Kind 1 notes that quote this work (`q` tag or embedded OP pointer in content). */
  quotes: Event[];
  /** Kind 9802 highlights — decorate referenced text, not thread rows. */
  highlights: Event[];
  /** Kind 1244, bookmarks, unknown kinds, … */
  other: Event[];
  zaps: Event[];
  boosts: Event[];
};

export function emptyWorkResponses(): WorkResponses {
  return { thread: [], quotes: [], highlights: [], other: [], zaps: [], boosts: [] };
}

const SKIP_OTHER_KINDS = new Set<number>([
  KIND.METADATA,
  KIND.CONTACT_LIST,
  KIND.DELETION,
  KIND.REACTION,
  KIND.MUTE,
  KIND.RELAY_LIST,
  KIND.BLOCKED,
  KIND.FAVORITE,
  KIND.USER_EMOJI_LIST,
  KIND.LOCAL,
  KIND.LABEL,
  KIND.PAYMENT,
  KIND.READING_QUEUE,
  KIND.FOLLOW_SET,
  KIND.EMOJI_SET,
  KIND.STATUS,
  KIND.RATING,
  KIND.DIRECTORY,
  KIND.NIP85_PREFS,
  KIND.NIP85_SCORE
]);

function sortNewest(events: Event[]): Event[] {
  return events.sort((a, b) => b.created_at - a.created_at);
}

function isWorkThreadSeed(
  event: Event,
  target: Event,
  related: ReadonlySet<string>
): boolean {
  if (!event?.id) return false;
  if (event.kind === KIND.COMMENT) return referencesTarget(event, target);
  if (event.kind !== KIND.TEXT_NOTE) return false;
  if (eTagsIncludeId(event, target.id)) return true;
  if (addressThreadMarker(event, target)) return true;
  if (addressTagsTarget(event, target) && !hasEventIdTag(event) && !citesTarget(event, target)) {
    return true;
  }
  return nip10HitsIds(event, related);
}

/** Kind 1111 / kind 1 comments on this OP, plus NIP-10 ancestors and descendants. */
function workThreadIds(events: Event[], target: Event): Set<string> {
  const targetId = target.id.toLowerCase();
  const rootKeys = new Set(threadRootKeys(target));
  const related = relatedEventIds(events, target);
  const byId = new Map(
    events.filter((e) => e?.id).map((e) => [e.id.toLowerCase(), e] as const)
  );
  const ids = new Set<string>();
  for (const event of events) {
    if (isWorkThreadSeed(event, target, related)) ids.add(event.id.toLowerCase());
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...ids]) {
      const event = byId.get(id);
      if (!event) continue;
      for (const parentId of kind1ETagIds(event)) {
        if (parentId === targetId || rootKeys.has(parentId)) continue;
        if (byId.has(parentId) && !ids.has(parentId)) {
          ids.add(parentId);
          changed = true;
        }
      }
    }
    for (const event of events) {
      if (!event?.id || !isThreadEvent(event)) continue;
      const id = event.id.toLowerCase();
      if (ids.has(id)) continue;
      const parent = commentParentId(event);
      if (parent && (ids.has(parent) || rootKeys.has(parent))) {
        ids.add(id);
        changed = true;
      }
    }
  }
  return ids;
}

/** Thread rows, plus quotes and other events that actually point at this work. */
function workResponseIds(events: Event[], target: Event): Set<string> {
  const ids = workThreadIds(events, target);
  const relatedIds = relatedEventIds(events, target);
  for (const event of events) {
    if (!event?.id) continue;
    if (referencesTarget(event, target) || isQuoteOfTarget(event, target, relatedIds)) {
      ids.add(event.id.toLowerCase());
    }
  }
  return ids;
}

function eventDecoratesKept(event: Event, target: Event, kept: ReadonlySet<string>): boolean {
  const targetId = target.id.toLowerCase();
  for (const t of event.tags) {
    const v = t[1]?.trim();
    if (!v) continue;
    if ((t[0] === 'e' || t[0] === 'E') && (kept.has(v.toLowerCase()) || v.toLowerCase() === targetId)) {
      return true;
    }
  }
  return referencesTarget(event, target) || isLibraryHighlightLoose(event, target);
}

export function partitionWorkResponses(events: Event[], target: Event): WorkResponses {
  const relatedIds = relatedEventIds(events, target);
  const threadIds = workThreadIds(events, target);
  const kept = workResponseIds(events, target);
  const threadById = new Map<string, Event>();
  const quotesById = new Map<string, Event>();
  const highlightsById = new Map<string, Event>();
  const otherById = new Map<string, Event>();
  const zapsById = new Map<string, Event>();
  const boostsById = new Map<string, Event>();

  for (const event of events) {
    if (!event?.id) continue;
    const key = event.id.toLowerCase();
    const decorate =
      event.kind === KIND.HIGHLIGHT ||
      event.kind === KIND.ZAP ||
      event.kind === KIND.REPOST ||
      event.kind === KIND.GENERIC_REPOST;
    if (decorate) {
      if (!eventDecoratesKept(event, target, kept)) continue;
    } else if (!kept.has(key)) {
      continue;
    }
    if (event.kind === KIND.HIGHLIGHT) {
      if (referencesTarget(event, target) || isLibraryHighlightLoose(event, target)) {
        highlightsById.set(key, event);
      }
      continue;
    }
    if (event.kind === KIND.ZAP) {
      zapsById.set(key, event);
      continue;
    }
    if (event.kind === KIND.REPOST || event.kind === KIND.GENERIC_REPOST) {
      boostsById.set(key, event);
      continue;
    }
    if (SKIP_OTHER_KINDS.has(event.kind)) continue;
    if (threadIds.has(key) && isThreadEvent(event)) {
      threadById.set(key, event);
      continue;
    }
    if (isQuoteOfTarget(event, target, relatedIds)) {
      quotesById.set(key, event);
      continue;
    }
    otherById.set(key, event);
  }

  return {
    thread: [...threadById.values()],
    quotes: sortNewest([...quotesById.values()]),
    highlights: sortNewest([...highlightsById.values()]),
    other: sortNewest([...otherById.values()]),
    zaps: [...zapsById.values()],
    boosts: [...boostsById.values()]
  };
}

/** Highlights often only a-tag the work — accept those even without a strict id match on e. */
function isLibraryHighlightLoose(event: Event, target: Event): boolean {
  if (event.kind !== KIND.HIGHLIGHT) return false;
  const addrKeys = new Set(publicationCoordinateLookupKeys(eventAddress(target)));
  return event.tags.some((t) => (t[0] === 'a' || t[0] === 'A') && t[1] && addrKeys.has(t[1]));
}

export function eventsPointingAtId(events: Event[], id: string): Event[] {
  const want = id.toLowerCase();
  return events.filter((event) =>
    event.tags.some((t) => (t[0] === 'e' || t[0] === 'E') && t[1]?.toLowerCase() === want)
  );
}

export function highlightsForEvent(highlights: Event[], event: Event): Event[] {
  return highlights.filter((h) => referencesTarget(h, event) || isLibraryHighlightLoose(h, event));
}

export function isXmrZap(event: Event): boolean {
  return event.tags.some((t) =>
    t.some((cell) => /xmr|monero/i.test(cell ?? ''))
  );
}

function nip73Values(target: Event): string[] {
  return [
    ...new Set(target.tags.filter((t) => (t[0] === 'i' || t[0] === 'I') && t[1]).map((t) => t[1]!))
  ].slice(0, 8);
}

/**
 * Responses of any kind by #e #E #a #A #q (and #I/#i when the OP has NIP-73 scopes).
 * Uses social + document stacks (inbox/outbox/favorites when signed in).
 */
export async function fetchWorkResponses(target: Event, limit = 40): Promise<WorkResponses> {
  const a = eventAddress(target);
  const id = target.id.toLowerCase();
  const addrKeys = [...new Set(publicationCoordinateLookupKeys(a))].slice(0, 12);
  const relays = threadRelayUniverse();
  const maxRelays = 4;
  const scopes = nip73Values(target);

  const filters: Filter[] = [];
  if (addrKeys.length) {
    filters.push({ '#A': addrKeys, limit }, { '#a': addrKeys, limit });
  }
  filters.push({ '#E': [id], limit }, { '#e': [id], limit }, { '#q': [id], limit });
  if (scopes.length) {
    filters.push({ '#I': scopes, limit }, { '#i': scopes, limit });
  }

  const first = await relayPool.query(relays, filters, 6000, maxRelays, undefined, { priority: true });

  const byEventId = new Map<string, Event>();
  for (const e of first) {
    if (e?.id) byEventId.set(e.id.toLowerCase(), e);
  }

  const parentIds = [...byEventId.values()]
    .filter((e) => e.kind === KIND.COMMENT || isKind1Reply(e))
    .map((e) => e.id.toLowerCase())
    .slice(0, 12);
  if (parentIds.length) {
    const nested = await relayPool.query(
      relays,
      [
        { '#e': parentIds, limit: 40 },
        { '#E': parentIds, limit: 40 }
      ],
      5000,
      maxRelays
    );
    for (const e of nested) {
      if (e?.id) byEventId.set(e.id.toLowerCase(), e);
    }
  }

  const recovered = await resolveMissingCommentParents([...byEventId.values()], [target.id], 4, target);
  for (const e of recovered) {
    if (e?.id) byEventId.set(e.id.toLowerCase(), e);
  }

  const branchIds = [...workThreadIds([...byEventId.values()], target)].slice(0, 24);
  if (branchIds.length) {
    const siblings = await relayPool.query(
      relays,
      [
        { '#e': branchIds, limit: 40 },
        { '#E': branchIds, limit: 40 }
      ],
      5000,
      maxRelays
    );
    for (const e of siblings) {
      if (e?.id) byEventId.set(e.id.toLowerCase(), e);
    }
  }

  return partitionWorkResponses([...byEventId.values()], target);
}

/** Kind 1111 and kind 1 replies — then recover missing parents. */
export async function fetchThreadEvents(target: Event, limit = 40): Promise<Event[]> {
  const { thread } = await fetchWorkResponses(target, limit);
  return thread;
}
