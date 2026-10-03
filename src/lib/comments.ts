import type { Event, Filter } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { KIND, MUTED_PARENT_PLACEHOLDER } from './constants';
import { type MuteState, isMutedEvent } from './mute';
import { publicationCoordinateLookupKeys, coordinatesOverlap } from './publication-coordinate';
import { fetchByIds } from './nostr/fetch';
import { relayPool } from './nostr/pool';
import { documentStack, highlightStack, socialStack } from './nostr/selector';
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

/** Kind 1 with NIP-10 thread tags (marked or positional `e`). */
export function isKind1Reply(event: Event): boolean {
  if (event.kind !== KIND.TEXT_NOTE) return false;
  return event.tags.some((t) => t[0] === 'e' && t[1]);
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
    if (!eTags.length) return null;
    const hasRoot = eTags.some((t) => t[3] === 'root');
    const reply = eTags.find((t) => t[3] === 'reply');
    if (hasRoot && reply?.[1]) return reply[1].toLowerCase();
    const marked = reply ?? eTags[eTags.length - 1];
    return marked?.[1]?.toLowerCase() ?? null;
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

/** Parent ids referenced by thread events that are not yet in `have`. */
export function missingCommentParentIds(
  events: Event[],
  have: ReadonlySet<string>,
  rootEventIds: Iterable<string> = []
): string[] {
  const roots = new Set(
    [...rootEventIds].map((id) => id.toLowerCase()).filter((id) => HEX_ID.test(id))
  );
  const missing = new Set<string>();
  for (const event of events) {
    if (!isThreadEvent(event)) continue;
    const parentId = commentParentId(event);
    if (!parentId || !HEX_ID.test(parentId) || roots.has(parentId) || have.has(parentId)) continue;
    missing.add(parentId);
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

/** Social + document (+ inbox/outbox when signed in) — full scan for missing parents. */
function threadRelayUniverse(): string[] {
  return [...new Set([...highlightStack(), ...socialStack(), ...documentStack()])];
}

/**
 * Pull missing parent events by id from Mercury + a wide relay set.
 * Walks a few hops so reply chains can reassemble.
 */
export async function resolveMissingCommentParents(
  events: Event[],
  rootEventIds: Iterable<string> = [],
  maxHops = 3
): Promise<Event[]> {
  const byId = new Map<string, Event>();
  for (const e of events) {
    if (e?.id) byId.set(e.id.toLowerCase(), e);
  }
  const roots = [...rootEventIds];

  for (let hop = 0; hop < maxHops; hop++) {
    const missing = missingCommentParentIds([...byId.values()], new Set(byId.keys()), roots).slice(
      0,
      24
    );
    if (!missing.length) break;

    const found = await fetchByIds(missing, 8);
    for (const e of found) byId.set(e.id.toLowerCase(), e);

    const still = missing.filter((id) => !byId.has(id));
    if (!still.length) continue;

    const wide = await relayPool.query(
      threadRelayUniverse(),
      [{ ids: still, limit: still.length }],
      6000,
      12
    );
    for (const e of wide) byId.set(e.id.toLowerCase(), e);
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

/**
 * Quote of this work: NIP-18 `q`, an embedded `nostr:naddr` / `nevent` / `note1` of the OP,
 * or a kind 1 that `a`/`A`-tags the OP without NIP-10 thread tags.
 */
export function isQuoteOfTarget(event: Event, target: Event): boolean {
  if (event.kind === KIND.COMMENT) return false;
  if (contentEmbedsTarget(event, target)) return true;
  if (event.kind !== KIND.TEXT_NOTE) return false;
  if (event.tags.some((t) => t[0] === 'q' && t[1] && qTagMatchesTarget(t[1], target))) return true;
  if (isKind1Reply(event)) return false;
  const addrKeys = new Set(publicationCoordinateLookupKeys(eventAddress(target)));
  return event.tags.some(
    (t) => (t[0] === 'a' || t[0] === 'A') && t[1] && (addrKeys.has(t[1]) || coordinatesOverlap(t[1], eventAddress(target)))
  );
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

/** Events that point at this work, plus 1111 / NIP-10 replies nested under those. */
function workResponseIds(events: Event[], target: Event): Set<string> {
  const rootKeys = new Set(threadRootKeys(target));
  const ids = new Set<string>();
  for (const event of events) {
    if (!event?.id) continue;
    if (referencesTarget(event, target) || isQuoteOfTarget(event, target)) {
      ids.add(event.id.toLowerCase());
    }
  }
  const nested = events.filter(
    (event) => event?.id && (event.kind === KIND.COMMENT || isKind1Reply(event))
  );
  let grew = true;
  while (grew) {
    grew = false;
    for (const event of nested) {
      const id = event.id.toLowerCase();
      if (ids.has(id)) continue;
      const parent = commentParentId(event);
      if (parent && (ids.has(parent) || rootKeys.has(parent))) {
        ids.add(id);
        grew = true;
      }
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
    if (isQuoteOfTarget(event, target)) {
      quotesById.set(key, event);
      continue;
    }
    if (event.kind === KIND.COMMENT || isKind1Reply(event)) {
      threadById.set(key, event);
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
  const maxRelays = 8;
  const scopes = nip73Values(target);

  const addressFilters: Filter[] = addrKeys.length
    ? [
        { '#A': addrKeys, limit },
        { '#a': addrKeys, limit }
      ]
    : [];
  const idFilters: Filter[] = [
    { '#E': [id], limit },
    { '#e': [id], limit },
    { '#q': [id], limit }
  ];
  const scopeFilters: Filter[] = scopes.length
    ? [
        { '#I': scopes, limit },
        { '#i': scopes, limit }
      ]
    : [];

  const [byAddress, byId, byScope] = await Promise.all([
    addressFilters.length
      ? relayPool.query(relays, addressFilters, 6000, maxRelays)
      : Promise.resolve([] as Event[]),
    relayPool.query(relays, idFilters, 6000, maxRelays),
    scopeFilters.length
      ? relayPool.query(relays, scopeFilters, 6000, maxRelays)
      : Promise.resolve([] as Event[])
  ]);

  const byEventId = new Map<string, Event>();
  for (const e of [...byAddress, ...byId, ...byScope]) {
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

  const recovered = await resolveMissingCommentParents([...byEventId.values()], [target.id]);
  for (const e of recovered) {
    if (e?.id) byEventId.set(e.id.toLowerCase(), e);
  }

  return partitionWorkResponses([...byEventId.values()], target);
}

/** Kind 1111 and kind 1 replies — then recover missing parents. */
export async function fetchThreadEvents(target: Event, limit = 40): Promise<Event[]> {
  const { thread } = await fetchWorkResponses(target, limit);
  return thread;
}
