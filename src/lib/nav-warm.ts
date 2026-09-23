import type { Event } from 'nostr-tools';
import { parseAddress } from './library-scope';
import { memoryFindByAddress, memoryGetEvent, rememberEvents } from './nostr/event-memory';

/** Re-assert a `kind:pubkey:d` coordinate already in session memory (for click → SPA paint). */
export function warmAddress(coord: string | null | undefined): Event | null {
  if (!coord) return null;
  const parsed = parseAddress(coord);
  if (!parsed) return null;
  const hit = memoryFindByAddress(parsed.kind, parsed.pubkey, parsed.d);
  if (hit) rememberEvents([hit]);
  return hit;
}

/** Warm a listing event (and optional id) before navigating to its page. */
export function warmNavEvent(event: Event | null | undefined, alsoId?: string | null): void {
  if (event) rememberEvents([event]);
  if (alsoId) {
    const hit = memoryGetEvent(alsoId);
    if (hit) rememberEvents([hit]);
  }
}
