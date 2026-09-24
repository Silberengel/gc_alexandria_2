import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { extractNip32LabelValues } from './nip32';
import { isNewerReplaceable, replaceableCoord } from './nostr/replaceable';

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
 * - NIP-01 replaceable / addressable: keep only the newest per coord (created_at, then lowest id).
 * - LABEL (1985): keep newest per slug+publication target (regular events; not kind+d).
 * - DELETION (5): drop referenced e-tagged and a-tagged events from the cache.
 */
export function mergeRememberedMetadata(existing: Event[], event: Event): Event[] {
  const byId = new Map(existing.map((e) => [e.id.toLowerCase(), e]));
  const eventId = event.id.toLowerCase();

  if (event.kind === KIND.DELETION) {
    for (const tag of event.tags) {
      if (tag[0] === 'e' && tag[1]) byId.delete(tag[1].toLowerCase());
      if (tag[0] === 'a' && tag[1]) {
        const addr = tag[1];
        for (const [id, e] of [...byId]) {
          if (e.pubkey.toLowerCase() !== event.pubkey.toLowerCase()) continue;
          const d = e.tags.find((t) => t[0] === 'd')?.[1] ?? '';
          const coord = `${e.kind}:${e.pubkey.toLowerCase()}:${d}`;
          if (coord === addr && e.created_at <= event.created_at) byId.delete(id);
        }
      }
    }
    // Do not keep kind-5 stubs in login metadata.
    return [...byId.values()];
  }

  byId.set(eventId, event);

  const coord = replaceableCoord(event);
  if (coord) {
    for (const [id, e] of [...byId]) {
      if (id === eventId) continue;
      if (replaceableCoord(e) !== coord) continue;
      if (isNewerReplaceable(event, e)) byId.delete(id);
      else {
        byId.delete(eventId);
        break;
      }
    }
  } else if (event.kind === KIND.LABEL) {
    const key = publicationLabelDedupeKey(event);
    if (key) {
      for (const [id, e] of [...byId]) {
        if (id === eventId) continue;
        if (e.kind !== KIND.LABEL) continue;
        if (publicationLabelDedupeKey(e) !== key) continue;
        if (isNewerReplaceable(event, e)) byId.delete(id);
        else {
          byId.delete(eventId);
          break;
        }
      }
    }
  }

  return [...byId.values()];
}
