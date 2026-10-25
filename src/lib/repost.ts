import type { Event } from 'nostr-tools';
import { isAddressable } from '@silberengel/kind-compose-catalog';
import { KIND } from './constants';
import { buildComposePartial } from './compose-build';
import { humanReadableText } from './event-preview';
import { cachedEventsReferencing } from './nostr/cache';
import { memoryGetEvent } from './nostr/event-memory';
import { relayPool } from './nostr/pool';
import { socialStack } from './nostr/selector';
import { eventAddress } from './nostr/verify';
import { pointerHintRelays } from './publication-load';

const HEX_64 = /^[0-9a-f]{64}$/i;

/**
 * NIP-18 / catalog kind-6 `e` tag: id + required relay (+ author pubkey).
 * Catalog validate rejects `["e", id]` alone (“missing required relay”).
 */
function nip18RepostETag(target: Event): string[] {
  const id = target.id.toLowerCase();
  const author = target.pubkey.toLowerCase();
  const relay = pointerHintRelays(target)[0] ?? '';
  return relay ? ['e', id, relay, author] : ['e', id];
}

export function isRepostKind(kind: number): boolean {
  return kind === KIND.REPOST || kind === KIND.GENERIC_REPOST;
}

/** NIP-18: kind 6 only for kind-1 notes; everything else is kind 16. */
export function repostKindForTarget(target: Event): number {
  return target.kind === KIND.TEXT_NOTE ? KIND.REPOST : KIND.GENERIC_REPOST;
}

/** NIP-70 protected events must not be embedded in repost content. */
export function isProtectedEvent(event: Event): boolean {
  return event.tags.some((tag) => tag[0] === '-');
}

/**
 * Draft a NIP-18 repost of `target` via the compose catalog.
 * Kind 6 embeds the note JSON when unprotected; kind 16 carries `k` (+ `a` when addressable).
 */
export function repostDraft(target: Event): {
  kind: number;
  content: string;
  tags: string[][];
} {
  const kind = repostKindForTarget(target);
  const values: Record<string, string> = {
    e: target.id.toLowerCase(),
    p: target.pubkey.toLowerCase()
  };
  if (kind === KIND.GENERIC_REPOST) {
    values.k = String(target.kind);
    if (isAddressable(target.kind)) {
      values.a = eventAddress(target);
    }
  }
  const content =
    kind === KIND.REPOST && !isProtectedEvent(target) ? JSON.stringify(target) : '';
  const draft = buildComposePartial({ kind, content, values });
  const eTag = nip18RepostETag(target);
  const tid = target.id.toLowerCase();
  let replaced = false;
  draft.tags = draft.tags.map((tag) => {
    if (tag[0] !== 'e' || (tag[1] ?? '').toLowerCase() !== tid) return tag;
    replaced = true;
    return eTag;
  });
  if (!replaced) draft.tags.unshift(eTag);
  return draft;
}

/** NIP-18 embedded note JSON in kind 6/16 content (legacy; often empty now). */
export function parseEmbeddedRepostEvent(content: string): Event | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(trimmed) as Partial<Event>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.id !== 'string' || !HEX_64.test(parsed.id)) return null;
    if (typeof parsed.pubkey !== 'string' || !HEX_64.test(parsed.pubkey)) return null;
    if (typeof parsed.kind !== 'number') return null;
    if (typeof parsed.content !== 'string') return null;
    if (!Array.isArray(parsed.tags)) return null;
    return parsed as Event;
  } catch {
    return null;
  }
}

/** First `e` tag id on a kind 6/16 (NIP-18). */
export function repostTargetId(repost: Event): string | null {
  if (!isRepostKind(repost.kind)) return null;
  for (const tag of repost.tags) {
    if (tag[0] !== 'e' && tag[0] !== 'E') continue;
    const id = (tag[1] ?? '').trim().toLowerCase();
    if (HEX_64.test(id)) return id;
  }
  return parseEmbeddedRepostEvent(repost.content)?.id.toLowerCase() ?? null;
}

/** Addressable target coordinate on a kind 16 (`a` tag). */
export function repostTargetAddress(repost: Event): string | null {
  if (repost.kind !== KIND.GENERIC_REPOST) return null;
  for (const tag of repost.tags) {
    if (tag[0] !== 'a' && tag[0] !== 'A') continue;
    const addr = (tag[1] ?? '').trim();
    if (addr) return addr;
  }
  return null;
}

/** True when a kind 6/16 points at `target` via `e` or `a`. */
export function repostPointsAt(repost: Event, target: Event): boolean {
  if (!isRepostKind(repost.kind)) return false;
  const tid = target.id.toLowerCase();
  if (repostTargetId(repost) === tid) return true;
  if (!isAddressable(target.kind)) return false;
  const addr = repostTargetAddress(repost);
  return !!addr && addr === eventAddress(target);
}

/** Newest repost of `target` by `pubkey`, if any. */
export function myRepostOf(
  boosts: Event[],
  pubkey: string | null | undefined,
  target: Event
): Event | null {
  if (!pubkey) return null;
  const pk = pubkey.trim().toLowerCase();
  if (!HEX_64.test(pk)) return null;
  let best: Event | null = null;
  for (const event of boosts) {
    if (event.pubkey.toLowerCase() !== pk) continue;
    if (!repostPointsAt(event, target)) continue;
    if (!best || event.created_at > best.created_at) best = event;
  }
  return best;
}

/** Kind 6/16 events that `#e`-tag this id (cache first, then social relays). */
export async function fetchRepostsForId(
  id: string,
  limit = 40,
  onCache?: (events: Event[]) => void
): Promise<Event[]> {
  const want = id.trim().toLowerCase();
  if (!HEX_64.test(want)) return [];
  const cached = (await cachedEventsReferencing(want)).filter(
    (event) => isRepostKind(event.kind) && repostTargetId(event) === want
  );
  if (cached.length) onCache?.(cached);
  const hits = await relayPool
    .query(
      socialStack(),
      [{ kinds: [KIND.REPOST, KIND.GENERIC_REPOST], '#e': [want], limit }],
      4000
    )
    .catch(() => [] as Event[]);
  const byId = new Map<string, Event>();
  for (const event of cached) byId.set(event.id.toLowerCase(), event);
  for (const event of hits) {
    if (!isRepostKind(event.kind) || repostTargetId(event) !== want) continue;
    byId.set(event.id.toLowerCase(), event);
  }
  return [...byId.values()];
}

/**
 * Best-effort blurb for a boost row: embedded JSON, then memory for the `e` target.
 * Callers may refresh after {@link fetchById} fills memory.
 */
export function peekRepostExcerpt(repost: Event): string {
  if (!isRepostKind(repost.kind)) return '';
  const embedded = parseEmbeddedRepostEvent(repost.content);
  const fromEmbedded = humanReadableText(embedded?.content ?? '');
  if (fromEmbedded) return fromEmbedded;
  const id = repostTargetId(repost);
  if (id) {
    const target = memoryGetEvent(id);
    const fromTarget = humanReadableText(target?.content ?? '');
    if (fromTarget) return fromTarget;
  }
  return humanReadableText(repost.content);
}

/** Newest-first unique boost authors (one avatar per pubkey). */
export function uniqueReposterPubkeys(boosts: Event[]): string[] {
  const sorted = [...boosts].sort((a, b) => b.created_at - a.created_at);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const event of sorted) {
    const pk = event.pubkey.trim().toLowerCase();
    if (!HEX_64.test(pk) || seen.has(pk)) continue;
    seen.add(pk);
    out.push(pk);
  }
  return out;
}

/**
 * Feed list row after collapsing kind 6/16 onto their target.
 * - `event`: a normal post (optional boosts that point at it)
 * - `boost-only`: boosts whose target is not also in the list (resolve separately)
 */
export type FeedListRow =
  | { type: 'event'; event: Event; boosts: Event[] }
  | { type: 'boost-only'; targetId: string; boosts: Event[] };

/** Collapse reposts onto their target so the feed does not repeat the same note. */
export function collapseFeedReposts(events: Event[]): FeedListRow[] {
  const boostsByTarget = new Map<string, Event[]>();
  const eventIds = new Set<string>();
  for (const event of events) {
    if (isRepostKind(event.kind)) {
      const tid = repostTargetId(event);
      if (!tid) continue;
      const list = boostsByTarget.get(tid) ?? [];
      list.push(event);
      boostsByTarget.set(tid, list);
      continue;
    }
    if (event.id) eventIds.add(event.id.toLowerCase());
  }

  const emittedBoostOnly = new Set<string>();
  const rows: FeedListRow[] = [];
  for (const event of events) {
    if (isRepostKind(event.kind)) {
      const tid = repostTargetId(event);
      // Target is in the list — attach boosters when we hit that event instead.
      if (!tid || eventIds.has(tid) || emittedBoostOnly.has(tid)) continue;
      emittedBoostOnly.add(tid);
      const boosts = (boostsByTarget.get(tid) ?? [event]).sort(
        (a, b) => b.created_at - a.created_at
      );
      rows.push({ type: 'boost-only', targetId: tid, boosts });
      continue;
    }
    const id = event.id.toLowerCase();
    const boosts = (boostsByTarget.get(id) ?? []).sort((a, b) => b.created_at - a.created_at);
    rows.push({ type: 'event', event, boosts });
  }
  return rows;
}

/** Prefer an in-memory / embedded copy of the boosted note. */
export function peekRepostTarget(repost: Event): Event | null {
  if (!isRepostKind(repost.kind)) return null;
  const embedded = parseEmbeddedRepostEvent(repost.content);
  if (embedded) return embedded;
  const id = repostTargetId(repost);
  return id ? memoryGetEvent(id) : null;
}
