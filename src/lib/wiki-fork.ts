import type { Event } from 'nostr-tools';
import type { ComposeDraftState } from './compose-drafts';
import { KIND } from './constants';
import { eventToComposeDraft } from './event-compose-preload';
import { eventAddress } from './nostr/verify';
import type { WikiReference } from './wiki-defer';

function tagMarker(tag: string[]): string | undefined {
  return tag[3]?.trim() || undefined;
}

function readReferenceByMarker(event: Event, marker: string): WikiReference | undefined {
  const aTag = event.tags.find((t) => t[0] === 'a' && tagMarker(t) === marker && t[1]);
  const eTag = event.tags.find((t) => t[0] === 'e' && tagMarker(t) === marker && t[1]);
  if (!aTag && !eTag) return undefined;
  return {
    coordinate: aTag?.[1],
    eventId: eTag?.[1],
    relayHint: aTag?.[2] || eTag?.[2] || undefined
  };
}

export function isWikiOrSpecKind(kind: number): boolean {
  return kind === KIND.WIKI || kind === KIND.SPEC;
}

/** Kind 30818/30817 that tags another version with marker `fork`. */
export function getWikiForkTarget(event: Event): WikiReference | undefined {
  if (!isWikiOrSpecKind(event.kind)) return undefined;
  return readReferenceByMarker(event, 'fork');
}

export function isWikiFork(event: Event): boolean {
  return !!getWikiForkTarget(event);
}

const FORK_DEFER_MARKERS = new Set(['fork', 'defer']);

function stripForkDeferTags(tags: string[][]): string[][] {
  return tags.filter((t) => {
    const name = t[0];
    if (name !== 'a' && name !== 'e') return true;
    const marker = tagMarker(t);
    return !marker || !FORK_DEFER_MARKERS.has(marker);
  });
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
    freeformTags: stripForkDeferTags(draft.freeformTags)
  };
}
