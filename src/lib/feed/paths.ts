import type { Event, Filter } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { isKind1Reply } from '../comments';
import { KIND } from '../constants';
import { parseAddress } from '../library-scope';
import { memoryFindByAddress, memoryGetEvent, rememberEvents } from '../nostr/event-memory';
import { cacheGetEvent } from '../nostr/cache';
import { fetchByAddress } from '../nostr/fetch';
import { relayPool } from '../nostr/pool';
import { firstTag } from '../nostr/verify';
import {
  DEFAULT_NOTIFICATION_LOOKBACK,
  parseNotificationLookback,
  type NotificationLookbackId
} from './lookback';
import { feedRelayGroups } from './relay-plan';
import type { FeedTab } from './tabs';
import { isTopLevelWebComment } from './taxonomy';

const HEX_ID = /^[0-9a-f]{64}$/i;

function tagThreadMarker(tag: string[]): 'root' | 'reply' | null {
  for (const slot of [tag[3], tag[2]]) {
    if (slot === 'root' || slot === 'reply') return slot;
  }
  return null;
}

/** Load one event for a feed thread, from memory and then the same relay groups. */
export async function fetchFeedEvent(id: string): Promise<Event | null> {
  const hex = id.toLowerCase();
  const cached = memoryGetEvent(hex) ?? (await cacheGetEvent(hex).catch(() => null));
  if (cached) {
    rememberEvents([cached]);
    return cached;
  }
  const { personal, shipped } = feedRelayGroups();
  const filter: Filter[] = [{ ids: [hex], limit: 1 }];
  if (personal.length) {
    const hit = (
      await relayPool.query(personal, filter, 4000, Math.min(personal.length, 8), undefined, {
        priority: true
      })
    )[0];
    if (hit) return hit;
  }
  if (shipped.length) {
    return (
      (
        await relayPool.query(shipped, filter, 4000, 4, undefined, { priority: true })
      )[0] ?? null
    );
  }
  return null;
}

/** Preferred share/thread pointer: naddr for parameterized replaceables, else nevent1. */
export function feedThreadPointer(event: Event): string {
  const d = firstTag(event, 'd');
  if (d != null && event.kind >= 30_000 && event.kind < 40_000) {
    return nip19.naddrEncode({
      kind: event.kind,
      pubkey: event.pubkey,
      identifier: d
    });
  }
  return nip19.neventEncode({
    id: event.id,
    author: event.pubkey,
    kind: event.kind
  });
}

/** `nevent1…` from an id alone (boost targets, legacy `/feed/note1…` redirects). */
export function feedThreadPointerFromId(id: string): string {
  return nip19.neventEncode({ id: id.toLowerCase() });
}

function pointerFromAddressCoord(coord: string): string | null {
  const parsed = parseAddress(coord);
  if (!parsed) return null;
  try {
    return nip19.naddrEncode({
      kind: parsed.kind,
      pubkey: parsed.pubkey,
      identifier: parsed.d
    });
  } catch {
    return null;
  }
}

/** Kind 7 / 17 reactions, Lightning zaps, Monero tips, and poll votes — open the target, not themselves. */
export function isFeedInteractionEvent(event: Event): boolean {
  if (event.kind === KIND.REACTION || event.kind === KIND.ZAP || event.kind === 17) return true;
  if (event.kind === KIND.POLL_RESPONSE) return true;
  if (event.kind === KIND.MONERO_TIP || event.kind === KIND.MONERO_TIP_RECEIPT) return true;
  // PosterChan kind-1 `#monerotip` — treated like a tip receipt in notifications.
  if (event.kind === KIND.TEXT_NOTE) {
    return event.tags.some(
      (t) => t[0] === 't' && (t[1] ?? '').trim().toLowerCase() === 'monerotip'
    );
  }
  return false;
}

/**
 * Pointer for the event a reaction or zap targets.
 * NIP-25: last `e` is the reacted-to note; NIP-57 may use `e` and/or `a`/`A`.
 * Prefer relay/author tips on the `e` tag so the thread fetch can hunt beyond feed relays.
 */
export function feedInteractionTargetPointer(event: Event): string | null {
  if (!isFeedInteractionEvent(event)) return null;
  const eTags = event.tags.filter((t) => t[0] === 'e' && t[1] && HEX_ID.test(t[1]));
  if (eTags.length) {
    const tag = eTags[eTags.length - 1]!;
    const id = tag[1]!.toLowerCase();
    const relay = (tag[2] ?? '').trim();
    const author = (tag[3] ?? '').trim().toLowerCase();
    try {
      return nip19.neventEncode({
        id,
        ...(HEX_ID.test(author) ? { author } : {}),
        ...(relay ? { relays: [relay] } : {})
      });
    } catch {
      return feedThreadPointerFromId(id);
    }
  }
  const aTag = event.tags.find((t) => (t[0] === 'a' || t[0] === 'A') && t[1]?.trim());
  if (aTag?.[1]) return pointerFromAddressCoord(aTag[1]);
  return null;
}

/**
 * Best in-memory event to seed the thread OP after a list click.
 * Replies / reactions / zaps often navigate to a different root than the row —
 * warm that OP when we already have it so the thread pane does not miss.
 */
export function feedThreadWarmSeed(event: Event): Event {
  if (isFeedInteractionEvent(event)) {
    const eTags = event.tags.filter((t) => t[0] === 'e' && t[1] && HEX_ID.test(t[1]));
    const targetId = eTags[eTags.length - 1]?.[1]?.toLowerCase();
    const target = targetId ? memoryGetEvent(targetId) : null;
    if (target && target.id.toLowerCase() !== event.id.toLowerCase()) {
      // Do not recurse through stacked reactions forever.
      if (isFeedInteractionEvent(target)) return target;
      return feedThreadWarmSeed(target);
    }
    return event;
  }
  const rootPointer = feedThreadRootPointer(event);
  if (!rootPointer) return event;
  const rootTarget = decodeFeedThreadTarget(rootPointer);
  if (rootTarget?.type === 'id') {
    const root = memoryGetEvent(rootTarget.id);
    if (root) return root;
  } else if (rootTarget?.type === 'addr') {
    const root = memoryFindByAddress(
      rootTarget.kind,
      rootTarget.pubkey,
      rootTarget.identifier
    );
    if (root) return root;
  }
  return event;
}

/**
 * For a reply/comment, the OP to open as `?thread=` (and focus via `?comment=`).
 * Returns null when this event is its own thread root (OPs, top-level web comments).
 */
export function feedThreadRootPointer(event: Event): string | null {
  if (isTopLevelWebComment(event)) return null;

  if (event.kind === KIND.TEXT_NOTE && isKind1Reply(event)) {
    const eTags = event.tags.filter((t) => t[0] === 'e' && t[1] && HEX_ID.test(t[1]));
    const eRoot = eTags.find((t) => tagThreadMarker(t) === 'root');
    if (eRoot?.[1]) return feedThreadPointerFromId(eRoot[1]);
    // Classic NIP-10: first e is root when unmarked; lone e is the parent/OP.
    if (eTags[0]?.[1]) return feedThreadPointerFromId(eTags[0][1]);
    const aRoot = event.tags.find(
      (t) => (t[0] === 'a' || t[0] === 'A') && t[1] && tagThreadMarker(t) === 'root'
    );
    if (aRoot?.[1]) return pointerFromAddressCoord(aRoot[1]);
    return null;
  }

  if (event.kind === KIND.COMMENT) {
    // NIP-22: uppercase tags name the thread root.
    const E = event.tags.find((t) => t[0] === 'E' && t[1] && HEX_ID.test(t[1]));
    if (E?.[1]) return feedThreadPointerFromId(E[1]);
    const A = event.tags.find((t) => t[0] === 'A' && t[1]);
    if (A?.[1]) return pointerFromAddressCoord(A[1]);
    // Lowercase-only clients: treat marked/positional e like NIP-10.
    const eTags = event.tags.filter((t) => t[0] === 'e' && t[1] && HEX_ID.test(t[1]));
    const eRoot = eTags.find((t) => tagThreadMarker(t) === 'root');
    if (eRoot?.[1]) return feedThreadPointerFromId(eRoot[1]);
    if (eTags[0]?.[1]) return feedThreadPointerFromId(eTags[0][1]);
    const aRoot = event.tags.find(
      (t) => (t[0] === 'a' || t[0] === 'A') && t[1] && tagThreadMarker(t) === 'root'
    );
    if (aRoot?.[1]) return pointerFromAddressCoord(aRoot[1]);
  }

  return null;
}

/**
 * Feed URL contract (query-based — keeps list+thread on one `/feed` route so the
 * list does not remount when opening/closing a card or switching tabs):
 *
 * 1. `/feed` — entry only; Feed.svelte quiet-rewrites to `feedListPath(firstVisibleTab)`.
 * 2. `/feed?tab=T` — list for tab T (always include `tab`, including `original`;
 *    bare `/feed` ≠ Original Posts — it means “first strip tab”).
 * 3. `/feed?thread=P` — thread on Original Posts (`parseFeedTab(null)` → `original`);
 *    open threads skip the bare-`/feed` rewrite.
 * 4. `/feed?tab=T&thread=P` — thread while preserving list tab T for close.
 * 5. `comment=` / `author=` — reply focus / profile-scoped list; orthogonal.
 * 6. `since=` / `kind=` / `q=` — list filters (lookback, kind number, text); omitted when
 *    at defaults (24h / all kinds / empty text) so refresh keeps the active filter.
 * 7. Legacy `/feed/:id` — redirect to `?thread=` only (FeedThreadRedirect).
 *
 * Replies open the OP as `thread=` and focus with `comment=`; OPs open themselves.
 */
export type FeedListOpts = {
  author?: string | null;
  /** Lookback window id; default (`24h`) is omitted from the URL. */
  since?: NotificationLookbackId | null;
  /** Kind number as decimal text; empty / invalid → omitted. */
  kind?: string | number | null;
  /** Free-text content filter; empty → omitted. */
  q?: string | null;
};

function appendFeedAuthor(q: URLSearchParams, author?: string | null): void {
  const hex = author?.trim().toLowerCase();
  if (hex && /^[0-9a-f]{64}$/.test(hex)) q.set('author', hex);
}

/** Kind filter from `?kind=` — empty string means all kinds. */
export function parseFeedKindParam(raw: string | null | undefined): string {
  const t = (raw ?? '').trim();
  return /^\d+$/.test(t) ? t : '';
}

/**
 * Write or clear list-filter query keys. Safe on a fresh or existing `URLSearchParams`
 * (deletes restore defaults).
 */
export function applyFeedListFilters(q: URLSearchParams, opts: FeedListOpts): void {
  const since = opts.since != null ? parseNotificationLookback(opts.since) : DEFAULT_NOTIFICATION_LOOKBACK;
  if (since !== DEFAULT_NOTIFICATION_LOOKBACK) q.set('since', since);
  else q.delete('since');

  const kind =
    opts.kind != null && String(opts.kind).trim() !== ''
      ? parseFeedKindParam(String(opts.kind))
      : '';
  if (kind) q.set('kind', kind);
  else q.delete('kind');

  const text = (opts.q ?? '').trim();
  if (text) q.set('q', text);
  else q.delete('q');
}

/** Write `tab=`. Thread builders pass `omitDefault` so `original` stays off the URL. */
function appendFeedTab(
  q: URLSearchParams,
  tab: FeedTab,
  opts: { omitDefault?: boolean } = {}
): void {
  if (opts.omitDefault && tab === 'original') return;
  q.set('tab', tab);
}

export function feedThreadPath(
  event: Event,
  tab: FeedTab = 'original',
  opts: FeedListOpts = {}
): string {
  // Reactions / zaps open the reacted-to or zapped event's thread (not themselves).
  // Never recurse into another reaction/zap — that can stack-overflow during list render.
  if (isFeedInteractionEvent(event)) {
    const eTags = event.tags.filter((t) => t[0] === 'e' && t[1] && HEX_ID.test(t[1]));
    const targetId = eTags[eTags.length - 1]?.[1]?.toLowerCase();
    if (targetId) {
      const warm = memoryGetEvent(targetId);
      if (
        warm &&
        warm.id.toLowerCase() !== event.id.toLowerCase() &&
        !isFeedInteractionEvent(warm)
      ) {
        return feedThreadPath(warm, tab, opts);
      }
    }
    const targetPointer = feedInteractionTargetPointer(event);
    if (targetPointer) {
      const q = new URLSearchParams();
      q.set('thread', targetPointer);
      appendFeedTab(q, tab, { omitDefault: true });
      appendFeedAuthor(q, opts.author);
      applyFeedListFilters(q, opts);
      return `/feed?${q.toString()}`;
    }
  }

  const q = new URLSearchParams();
  const rootPointer = feedThreadRootPointer(event);
  if (rootPointer) {
    q.set('thread', rootPointer);
    q.set('comment', event.id.toLowerCase());
  } else {
    q.set('thread', feedThreadPointer(event));
  }
  appendFeedTab(q, tab, { omitDefault: true });
  appendFeedAuthor(q, opts.author);
  applyFeedListFilters(q, opts);
  return `/feed?${q.toString()}`;
}

/** Thread URL from a 64-hex id when the full event is not in hand (same `tab=` rules). */
export function feedThreadPathFromId(
  id: string,
  tab: FeedTab = 'original',
  opts: FeedListOpts = {}
): string {
  const q = new URLSearchParams();
  q.set('thread', feedThreadPointerFromId(id));
  appendFeedTab(q, tab, { omitDefault: true });
  appendFeedAuthor(q, opts.author);
  applyFeedListFilters(q, opts);
  return `/feed?${q.toString()}`;
}

/** List URL for a feed tab (no open thread). Always writes `tab=` — see contract above. */
export function feedListPath(tab: FeedTab = 'original', opts: FeedListOpts = {}): string {
  const q = new URLSearchParams();
  appendFeedTab(q, tab);
  appendFeedAuthor(q, opts.author);
  applyFeedListFilters(q, opts);
  return `/feed?${q.toString()}`;
}

/** Profile → Replies tab filtered to that pubkey. */
export function feedAuthorRepliesPath(authorPubkey: string): string {
  return feedListPath('replies', { author: authorPubkey });
}

export type FeedThreadTarget =
  | { type: 'id'; id: string; author?: string; relays?: string[] }
  | {
      type: 'addr';
      kind: number;
      pubkey: string;
      identifier: string;
      relays?: string[];
      /** Stable key for effects / warm-cache compare (coord or id). */
      key: string;
    };

/**
 * Resolve `nevent1…`, `naddr1…`, legacy `note1…`, or a 64-char hex id.
 * Does not dig bech32 out of HTTP wrappers — those stay links with a chevron.
 */
export function decodeFeedThreadTarget(raw: string): FeedThreadTarget | null {
  const value = decodeURIComponent(raw).trim().replace(/^nostr:/i, '');
  if (/^[0-9a-f]{64}$/i.test(value)) {
    return { type: 'id', id: value.toLowerCase() };
  }
  try {
    const decoded = nip19.decode(value);
    if (decoded.type === 'nevent') {
      return {
        type: 'id',
        id: decoded.data.id,
        author: decoded.data.author,
        relays: decoded.data.relays
      };
    }
    if (decoded.type === 'note') {
      return { type: 'id', id: decoded.data };
    }
    if (decoded.type === 'naddr') {
      const { kind, pubkey, identifier, relays } = decoded.data;
      return {
        type: 'addr',
        kind,
        pubkey,
        identifier,
        relays,
        key: `${kind}:${pubkey.toLowerCase()}:${identifier}`
      };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Event id from `nevent1…`, legacy `note1…`, or a 64-char hex id.
 * Prefer {@link decodeFeedThreadTarget} when naddr must resolve.
 */
export function decodeFeedPointer(raw: string): string | null {
  const target = decodeFeedThreadTarget(raw);
  return target?.type === 'id' ? target.id : null;
}

/** Load the OP for a feed thread (by id or naddr address). */
export async function fetchFeedThreadTarget(
  target: FeedThreadTarget
): Promise<Event | null> {
  if (target.type === 'id') {
    const cached = memoryGetEvent(target.id) ?? (await cacheGetEvent(target.id).catch(() => null));
    if (cached) {
      rememberEvents([cached]);
      return cached;
    }
    // Always hunt via fetchById (document + social stacks + author outbox) —
    // feed list relays alone often miss a note that was only on inbox/index hosts.
    const { fetchById } = await import('../nostr/fetch');
    const hit = await fetchById(target.id, {
      hintRelays: target.relays,
      authorPubkey: target.author
    });
    if (hit) return hit;
    return fetchFeedEvent(target.id);
  }
  return fetchByAddress(`${target.kind}:${target.pubkey}:${target.identifier}`, {
    hintRelays: target.relays
  });
}

/** Stable compare key for an open thread target. */
export function feedThreadTargetKey(target: FeedThreadTarget): string {
  return target.type === 'id' ? target.id : target.key;
}

/** True when this event is the OP for the open thread target. */
export function eventMatchesThreadTarget(event: Event, target: FeedThreadTarget): boolean {
  if (target.type === 'id') return event.id.toLowerCase() === target.id;
  const d = firstTag(event, 'd');
  return (
    event.kind === target.kind &&
    event.pubkey.toLowerCase() === target.pubkey.toLowerCase() &&
    d === target.identifier
  );
}

/** Read `thread=` from the feed querystring (hex / nevent / naddr). */
export function parseFeedThreadParam(raw: string | null | undefined): string | null {
  const thread = new URLSearchParams(raw ?? '').get('thread');
  if (!thread?.trim()) return null;
  const target = decodeFeedThreadTarget(thread.trim());
  if (!target) return null;
  return feedThreadTargetKey(target);
}

/** Full thread target from the feed querystring. */
export function parseFeedThreadTarget(
  raw: string | null | undefined
): FeedThreadTarget | null {
  const thread = new URLSearchParams(raw ?? '').get('thread');
  if (!thread?.trim()) return null;
  return decodeFeedThreadTarget(thread.trim());
}
