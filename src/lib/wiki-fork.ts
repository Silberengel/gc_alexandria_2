import type { Event } from 'nostr-tools';
import {
  readNip54Pointer,
  stripNip54ForkDeferTags
} from '@silberengel/kind-compose-catalog';
import type { ComposeDraftState } from './compose-drafts';
import { KIND } from './constants';
import { eventToComposeDraft } from './event-compose-preload';
import { fetchByAddress, fetchById } from './nostr/fetch';
import { rememberEvents } from './nostr/event-memory';
import { mercuryFilter } from './nostr/mercury';
import { relayPool } from './nostr/pool';
import { pruneToLatestReplaceables } from './nostr/replaceable';
import { wikiStack } from './nostr/selector';
import { eventAddress, firstTag } from './nostr/verify';
import { publicationCoordinateLookupKeys } from './publication-coordinate';
import { wikiPathFromCoordinate, type WikiReference } from './wiki-defer';

export type WikiForkLookup = {
  origin: Event | null;
  originHref: string | null;
  forks: Event[];
};

export function isWikiOrSpecKind(kind: number): boolean {
  return kind === KIND.WIKI || kind === KIND.SPEC;
}

/** Kind 30818/30817 that tags another version with marker `fork`. */
export function getWikiForkTarget(event: Event): WikiReference | undefined {
  return readNip54Pointer(event, 'fork');
}

export function isWikiFork(event: Event): boolean {
  return !!getWikiForkTarget(event);
}

/** True when `candidate` is a fork of `target` (NIP-54 fork marker on a/e). */
export function eventIsWikiForkOf(candidate: Event, target: Event): boolean {
  if (!isWikiOrSpecKind(candidate.kind)) return false;
  const ref = getWikiForkTarget(candidate);
  if (!ref) return false;
  if (ref.eventId && ref.eventId.toLowerCase() === target.id.toLowerCase()) return true;
  if (!ref.coordinate) return false;
  const targetKeys = new Set(publicationCoordinateLookupKeys(eventAddress(target)));
  return publicationCoordinateLookupKeys(ref.coordinate).some((k) => targetKeys.has(k));
}

/** Canonical wiki/spec path for a fork origin (resolved event, else a-tag coordinate). */
export function wikiForkOriginHref(origin: Event | null, ref?: WikiReference): string | null {
  if (origin) {
    const d = firstTag(origin, 'd') ?? '';
    if (d && isWikiOrSpecKind(origin.kind)) {
      return wikiPathFromCoordinate(`${origin.kind}:${origin.pubkey}:${d}`);
    }
  }
  return wikiPathFromCoordinate(ref?.coordinate);
}

/** Keep the newest replaceable per author among inbound forks. */
export function uniqueWikiForks(candidates: readonly Event[], target: Event): Event[] {
  const byAuthor = new Map<string, Event>();
  for (const event of candidates) {
    if (event.id === target.id || !eventIsWikiForkOf(event, target)) continue;
    const pk = event.pubkey.toLowerCase();
    const prev = byAuthor.get(pk);
    if (!prev || event.created_at > prev.created_at) byAuthor.set(pk, event);
  }
  return [...byAuthor.values()].sort((a, b) => b.created_at - a.created_at);
}

/**
 * Resolve outbound fork origin + inbound forks for a wiki/spec article.
 * Mercury first, then wiki relay stack when the index is thin.
 */
export async function loadWikiForks(target: Event): Promise<WikiForkLookup> {
  if (!isWikiOrSpecKind(target.kind)) {
    return { origin: null, originHref: null, forks: [] };
  }
  const addr = eventAddress(target);
  const dTag = target.tags.find((t) => t[0] === 'd')?.[1];
  const filters = [
    { kinds: [KIND.WIKI, KIND.SPEC], '#a': [addr], limit: 40 },
    { kinds: [KIND.WIKI, KIND.SPEC], '#e': [target.id], limit: 40 },
    ...(dTag ? [{ kinds: [KIND.WIKI, KIND.SPEC], '#d': [dTag], limit: 40 }] : [])
  ];
  const batches = await Promise.all(
    filters.map((filter) => mercuryFilter(filter).catch(() => [] as Event[]))
  );
  const byId = new Map<string, Event>();
  for (const batch of batches) for (const e of batch) byId.set(e.id, e);
  if (byId.size < 2) {
    const relayHits = await relayPool.query(wikiStack(), filters, 4000).catch(() => [] as Event[]);
    for (const e of relayHits) byId.set(e.id, e);
  }
  const candidates = pruneToLatestReplaceables([...byId.values()]);
  rememberEvents(candidates);
  const forks = uniqueWikiForks(candidates, target);

  const ref = getWikiForkTarget(target);
  let origin: Event | null = null;
  if (ref?.eventId) {
    origin = await fetchById(ref.eventId, {
      hintRelays: ref.relayHint ? [ref.relayHint] : undefined
    });
  }
  if (!origin && ref?.coordinate) {
    origin = await fetchByAddress(ref.coordinate, {
      hintRelays: ref.relayHint ? [ref.relayHint] : undefined
    });
  }
  if (origin) rememberEvents([origin]);
  return {
    origin,
    originHref: wikiForkOriginHref(origin, ref ?? undefined),
    forks
  };
}

/**
 * Clone a wiki/spec into a compose draft as the current user, with `fork` a+e
 * pointing at the exact source version.
 */
export function wikiForkDraftFrom(source: Event): ComposeDraftState {
  const draft = eventToComposeDraft(source);
  const coordinate = eventAddress(source);
  const values = { ...draft.values };
  // Drop any prior fork/defer field values from the source clone.
  delete values.fork_a;
  delete values.fork_e;
  delete values.defer_a;
  delete values.defer_e;
  values.fork_a = coordinate;
  values.fork_e = source.id.toLowerCase();

  return {
    ...draft,
    values,
    freeformTags: stripNip54ForkDeferTags(draft.freeformTags)
  };
}
