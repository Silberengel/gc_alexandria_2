import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { buildComposePartial } from './compose-build';
import { getWikiForkTarget, isWikiFork, isWikiOrSpecKind } from './wiki-fork';
import { isPositiveLikeContent } from './reactions';
import { wikiPathFromCoordinate } from './wiki-defer';

function tagMarker(tag: string[]): string | undefined {
  return tag[3]?.trim() || undefined;
}

export type WikiMergeRequest = {
  targetCoordinate?: string;
  targetRelay?: string;
  destinationPubkey?: string;
  /** Version the modification is based on (optional). */
  baseEventId?: string;
  /** Fork/source version to merge (marker `fork` or legacy `source`). */
  sourceEventId?: string;
  explanation: string;
};

export type WikiMergeAcceptance = {
  resultEventId?: string;
  requestEventId?: string;
  requestAuthorPubkey?: string;
};

const SOURCE_MARKERS = new Set(['fork', 'source']);

/** Parse a kind-818 merge request. */
export function parseWikiMergeRequest(event: Event): WikiMergeRequest | null {
  if (event.kind !== KIND.WIKI_MERGE_REQUEST) return null;
  const aTag = event.tags.find((t) => t[0] === 'a' && t[1]);
  const pTag = event.tags.find((t) => t[0] === 'p' && t[1]);
  const sourceTag = event.tags.find(
    (t) => t[0] === 'e' && t[1] && SOURCE_MARKERS.has(tagMarker(t) ?? '')
  );
  const baseTag = event.tags.find((t) => {
    if (t[0] !== 'e' || !t[1]) return false;
    const m = tagMarker(t);
    return !m || (!SOURCE_MARKERS.has(m) && m !== 'result' && m !== 'request');
  });
  return {
    targetCoordinate: aTag?.[1],
    targetRelay: aTag?.[2] || undefined,
    destinationPubkey: pTag?.[1]?.toLowerCase(),
    baseEventId: baseTag?.[1]?.toLowerCase(),
    sourceEventId: sourceTag?.[1]?.toLowerCase(),
    explanation: event.content ?? ''
  };
}

/** Parse a legacy kind-819 merge acceptance. */
export function parseWikiMergeAcceptance(event: Event): WikiMergeAcceptance | null {
  if (event.kind !== KIND.WIKI_MERGE_ACCEPTANCE) return null;
  const resultTag = event.tags.find((t) => t[0] === 'e' && tagMarker(t) === 'result' && t[1]);
  const requestTag = event.tags.find((t) => t[0] === 'e' && tagMarker(t) === 'request' && t[1]);
  const pTag = event.tags.find((t) => t[0] === 'p' && t[1]);
  return {
    resultEventId: resultTag?.[1]?.toLowerCase(),
    requestEventId: requestTag?.[1]?.toLowerCase(),
    requestAuthorPubkey: pTag?.[1]?.toLowerCase()
  };
}

export function isMergeAcceptReaction(event: Event, mergeRequestId: string): boolean {
  if (event.kind !== KIND.REACTION) return false;
  const id = mergeRequestId.toLowerCase();
  if (!event.tags.some((t) => t[0] === 'e' && t[1]?.toLowerCase() === id)) return false;
  return isPositiveLikeContent(event.content) || event.content.trim() === '+';
}

export function isMergeRejectReaction(event: Event, mergeRequestId: string): boolean {
  if (event.kind !== KIND.REACTION) return false;
  const id = mergeRequestId.toLowerCase();
  if (!event.tags.some((t) => t[0] === 'e' && t[1]?.toLowerCase() === id)) return false;
  return event.content.trim() === '-';
}

/**
 * Build an 818 draft from the viewer's forked wiki/spec.
 * Destination comes from the fork markers on `forkEvent`.
 */
export function wikiMergeRequestDraftFromFork(
  forkEvent: Event,
  explanation = ''
): { kind: number; content: string; tags: string[][]; values: Record<string, string> } | null {
  if (!isWikiOrSpecKind(forkEvent.kind)) return null;
  const fork = getWikiForkTarget(forkEvent);
  if (!fork?.coordinate) return null;
  const parts = fork.coordinate.split(':');
  if (parts.length < 3) return null;
  const destPk = (parts[1] ?? '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(destPk)) return null;

  const values: Record<string, string> = {
    target_a: fork.coordinate,
    destination_p: destPk,
    source_e: forkEvent.id.toLowerCase()
  };
  if (fork.eventId) values.base_e = fork.eventId.toLowerCase();

  const partial = buildComposePartial({
    kind: KIND.WIKI_MERGE_REQUEST,
    content: explanation,
    values
  });
  return { ...partial, values };
}

/** True when the viewer owns a forked wiki/spec that can request a merge. */
export function canRequestWikiMerge(
  event: Event,
  viewerPubkey: string | null | undefined
): boolean {
  const pk = (viewerPubkey ?? '').trim().toLowerCase();
  if (!pk || !/^[0-9a-f]{64}$/.test(pk)) return false;
  if (event.pubkey.toLowerCase() !== pk) return false;
  return isWikiFork(event);
}

export function canRespondToWikiMerge(
  mergeRequest: Event,
  viewerPubkey: string | null | undefined
): boolean {
  const parsed = parseWikiMergeRequest(mergeRequest);
  if (!parsed?.destinationPubkey) return false;
  const pk = (viewerPubkey ?? '').trim().toLowerCase();
  return !!pk && parsed.destinationPubkey === pk;
}

export function wikiMergeTargetHref(merge: WikiMergeRequest): string | null {
  return wikiPathFromCoordinate(merge.targetCoordinate);
}
