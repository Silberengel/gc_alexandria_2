/**
 * Pure helpers for mapping publication publish results into Compose UI state.
 */
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { normalizeDTag } from './dtag';
import type { PublicationPublishResult } from './publication-publish';
import type { PublishFailure, PublishProgress } from './publication-publish-pipeline';

export function formatPublicationMissingDTags(tags: string[]): string {
  if (!tags.length) return '';
  const shown = tags.slice(0, 8).join(', ');
  return tags.length > 8 ? ` Missing: ${shown}…` : ` Missing: ${shown}`;
}

export type PublicationPublishFailureUi = {
  formError: string;
  retryEvents: Event[];
  /** Signed events to pass back into the pipeline after a mid-batch sign failure. */
  continueEvents: Event[];
  missingDTags: string[];
};

/**
 * Retry only makes sense for verify/republish misses — not mid-batch sign failures
 * (those leave `missingEvents` empty; Retry cannot resume signing).
 */
export function publicationPublishRetryEvents(result: PublishFailure): Event[] {
  return result.missingEvents.length ? result.missingEvents : [];
}

/**
 * After a mid-batch sign failure, keep already-signed events so the next Publish
 * can resume without minting duplicates. Not used for verify misses or
 * post-verify root-resolution failures.
 */
export function publicationPublishContinueEvents(result: PublishFailure): Event[] {
  if (!result.canContinueSigning || result.missingEvents.length) return [];
  return result.events.length ? result.events : [];
}

export function publicationPublishFailureUi(
  result: PublishFailure
): PublicationPublishFailureUi {
  const continueEvents = publicationPublishContinueEvents(result);
  let formError = result.error + formatPublicationMissingDTags(result.missingDTags);
  if (continueEvents.length) {
    formError +=
      ' Already-signed parts are kept — publish again to continue without duplicates.';
  }
  return {
    formError,
    retryEvents: publicationPublishRetryEvents(result),
    continueEvents,
    missingDTags: result.missingDTags
  };
}

/**
 * Root `d` used by {@link publishPublicationSplit} — form d, else title slug, else untitled.
 */
export function publicationPublishRootD(values: {
  d?: string;
  title?: string;
}): string {
  return values.d?.trim() || normalizeDTag(values.title?.trim() || '') || 'untitled';
}

/**
 * Pick the book root from a publish batch. Bottom-up order puts nested 30040
 * indexes before the root, so we take the **last** publication — not `.find()`.
 * When `preferredD` is set but absent from the batch, returns `undefined`
 * (do not fall back to a nested index).
 */
export function publicationPublishRootFromEvents(
  events: Event[],
  preferredD?: string
): Event | undefined {
  const pubs = events.filter(
    (e) => e.kind === KIND.PUBLICATION && e.tags.some((t) => t[0] === 'd')
  );
  if (preferredD) {
    return pubs.find((e) => e.tags.some((t) => t[0] === 'd' && t[1] === preferredD));
  }
  return pubs[pubs.length - 1] ?? events[events.length - 1] ?? events[0];
}

export function isPublicationPublishSuccess(
  result: PublicationPublishResult
): result is Extract<PublicationPublishResult, { ok: true }> {
  return result.ok;
}

export type PublicationProgressSetter = (p: PublishProgress | null) => void;
