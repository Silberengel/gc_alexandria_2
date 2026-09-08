import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { extractNip32LabelValues } from './nip32';

/** Stable key for a publication-list label: slug + target address or event id. */
export function publicationLabelDedupeKey(event: Pick<Event, 'tags'>): string | null {
  const slug = extractNip32LabelValues(event.tags)[0]?.toLowerCase();
  if (!slug) return null;
  let target = '';
  for (const tag of event.tags) {
    if (tag[0] === 'a' && tag[1]) {
      target = tag[1];
      break;
    }
    if (tag[0] === 'e' && tag[1]) {
      target = tag[1].toLowerCase();
      break;
    }
  }
  if (!target) return null;
  return `${slug}\0${target}`;
}

/**
 * Merge a newly authored metadata event into the session cache.
 * - DIRECTORY / BOOKMARK: keep newest per kind+d (addressable / replaceable).
 * - LABEL (1985): keep newest per slug+publication target (regular events; not kind+d).
 * - DELETION (5): drop referenced e-tagged events from the cache.
 */
export function mergeRememberedMetadata(existing: Event[], event: Event): Event[] {
  const byId = new Map(existing.map((e) => [e.id.toLowerCase(), e]));
  const eventId = event.id.toLowerCase();

  if (event.kind === KIND.DELETION) {
    for (const tag of event.tags) {
      if (tag[0] === 'e' && tag[1]) byId.delete(tag[1].toLowerCase());
    }
    // Do not keep kind-5 stubs in login metadata.
    return [...byId.values()];
  }

  byId.set(eventId, event);

  if (event.kind === KIND.DIRECTORY || event.kind === KIND.BOOKMARK) {
    const d = event.tags.find((t) => t[0] === 'd')?.[1] ?? '';
    for (const [id, e] of [...byId]) {
      if (id === eventId) continue;
      if (e.kind !== event.kind) continue;
      const ed = e.tags.find((t) => t[0] === 'd')?.[1] ?? '';
      if (ed === d && e.created_at <= event.created_at) byId.delete(id);
    }
  } else if (event.kind === KIND.LABEL) {
    const key = publicationLabelDedupeKey(event);
    if (key) {
      for (const [id, e] of [...byId]) {
        if (id === eventId) continue;
        if (e.kind !== KIND.LABEL) continue;
        if (publicationLabelDedupeKey(e) === key && e.created_at <= event.created_at) {
          byId.delete(id);
        }
      }
    }
  }

  return [...byId.values()];
}
