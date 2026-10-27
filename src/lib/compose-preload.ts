import type { Event } from 'nostr-tools';
import { parseKind0Json } from './kind-compose';
import { buildKind0TagListFromEvent } from './compose-kind0';
import { mutedRawFromTags } from './compose-mute-list';
import { authorsRawFromTags } from './compose-people-list';
import { KIND } from './constants';
import { eventToComposeDraft } from './event-compose-preload';
import { isReplaceableKind } from './nostr/replaceable';

export type ReplaceableComposePreload = {
  content: string;
  values: Record<string, string>;
  existingKind0?: Record<string, unknown>;
  kind0Tags?: string[][];
  hashtags?: string[];
  imetaTags?: string[][];
  freeformTags?: string[][];
};

/**
 * Map a live replaceable event into compose form state.
 * Relay-list / payto / kind-0 keep hand-tuned parsers; everything else uses
 * {@link eventToComposeDraft}.
 */
export function valuesFromReplaceableEvent(event: Event): ReplaceableComposePreload {
  const kind = event.kind;
  if (kind === 0) {
    const existing = parseKind0Json(event.content);
    const kind0Tags = buildKind0TagListFromEvent(event);
    const values: Record<string, string> = {};
    for (const row of kind0Tags) {
      const key = row[0];
      if (!key || key in values) continue;
      if (key === 'bot') {
        const v = (row[1] ?? '').trim().toLowerCase();
        values.bot = !v || v === 'true' ? 'true' : v === 'false' ? 'false' : '';
        continue;
      }
      const v = (row[1] ?? '').trim();
      if (v) values[key] = v;
    }
    return { content: '', values, existingKind0: existing, kind0Tags };
  }

  if (kind === 10133) {
    const lines = event.tags.filter((t) => t[0] === 'payto').map((t) => t.slice(1).join(' '));
    return { content: '', values: { payto: lines.join('\n') } };
  }

  if (kind === KIND.CONTACT_LIST) {
    return { content: '', values: { authors: authorsRawFromTags(event.tags) } };
  }

  if (kind === KIND.MUTE) {
    // Public tags only here; Compose merges decrypted private tags asynchronously.
    return { content: '', values: { muted: mutedRawFromTags(event.tags, []) } };
  }

  if (kind === 10002 || kind === 10006 || kind === 10012 || kind === 10243) {
    const lines = event.tags
      .filter((t) => t[0] === 'r' || t[0] === 'relay' || t[0] === 'server')
      .map((t) => t.slice(1).join(' '));
    return { content: '', values: { relays: lines.join('\n') } };
  }

  const draft = eventToComposeDraft(event);
  return {
    content: draft.content,
    values: draft.values,
    hashtags: draft.hashtags,
    imetaTags: draft.imetaTags,
    freeformTags: draft.freeformTags
  };
}

/** @deprecated Prefer {@link valuesFromReplaceableEvent}. */
export function valuesFromMetadataEvent(event: Event): ReplaceableComposePreload {
  return valuesFromReplaceableEvent(event);
}

export function pickLatestByKind(events: Event[], kind: number): Event | null {
  let best: Event | null = null;
  for (const ev of events) {
    if (ev.kind !== kind) continue;
    if (!best || ev.created_at > best.created_at) best = ev;
  }
  return best;
}

/**
 * Signed-in compose should preload the viewer's live event for NIP-01 replaceable
 * kinds (0, 3, 10000–19999) — never addressable 30000–39999 (those need a `d`).
 */
export function shouldPreloadReplaceable(kind: number): boolean {
  return isReplaceableKind(kind);
}

/** @deprecated Prefer {@link shouldPreloadReplaceable}. */
export function shouldPreloadMetadata(kind: number): boolean {
  return shouldPreloadReplaceable(kind);
}
