import type { Event } from 'nostr-tools';
import {
  parseWikiMergeAcceptance as catalogParseWikiMergeAcceptance,
  parseWikiMergeRequest as catalogParseWikiMergeRequest,
  type WikiMergeAcceptance,
  type WikiMergeRequest
} from '@silberengel/kind-compose-catalog';
import { KIND } from './constants';
import { buildComposePartial } from './compose-build';
import { getWikiForkTarget, isWikiFork, isWikiOrSpecKind } from './wiki-fork';
import { isPositiveLikeContent } from './reactions';
import { wikiPathFromCoordinate } from './wiki-defer';

export type { WikiMergeAcceptance, WikiMergeRequest };

/** Parse a kind-818 merge request. */
export function parseWikiMergeRequest(event: Event): WikiMergeRequest | null {
  return catalogParseWikiMergeRequest(event);
}

/** Parse a legacy kind-819 merge acceptance. */
export function parseWikiMergeAcceptance(event: Event): WikiMergeAcceptance | null {
  return catalogParseWikiMergeAcceptance(event);
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
