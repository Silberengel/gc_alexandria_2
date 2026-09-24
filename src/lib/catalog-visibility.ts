import type { Event } from 'nostr-tools';
import { coverTitle } from './cover-fallback';
import { isEventDeleted } from './deletions';
import { firstTag } from './nostr/verify';

/**
 * True when a catalog event is safe to show as a shelf/list/search card.
 * Drops deleted events, empty d-tags (broken /publication/d//… links), and Untitled covers.
 */
export function isRenderableCatalogEvent(event: Event): boolean {
  if (!event?.id || !event.pubkey) return false;
  if (isEventDeleted(event)) return false;
  const d = firstTag(event, 'd')?.trim();
  if (!d) return false;
  if (coverTitle(event) === 'Untitled') return false;
  return true;
}

export function filterRenderableCatalogEvents<T extends Event>(events: T[]): T[] {
  return events.filter(isRenderableCatalogEvent);
}
