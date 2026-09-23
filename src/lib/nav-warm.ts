import type { Event } from 'nostr-tools';
import { dTagVariants, normalizeDTag } from './dtag';
import { parseAddress } from './library-scope';
import { firstTag } from './nostr/verify';
import { memoryFindByAddress, memoryGetEvent, rememberEvents } from './nostr/event-memory';

/** Survives Vite HMR wiping the in-memory Maps between click and route mount. */
const PENDING_KEY = 'alexandria-nav-warm';

/** Re-assert a `kind:pubkey:d` coordinate already in session memory (for click → SPA paint). */
export function warmAddress(coord: string | null | undefined): Event | null {
  if (!coord) return null;
  const parsed = parseAddress(coord);
  if (!parsed) return null;
  const hit = memoryFindByAddress(parsed.kind, parsed.pubkey, parsed.d);
  if (hit) rememberEvents([hit]);
  return hit;
}

function stashPending(event: Event): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(event));
  } catch {
    /* private mode / quota */
  }
}

/**
 * Event handed off from a listing click. Prefer this over address lookup alone —
 * Vite HMR can empty event-memory while shelf cards still hold live Event objects.
 */
export function takePendingNavEvent(): Event | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_KEY);
    const event = JSON.parse(raw) as Event;
    if (!event?.id || !event?.pubkey || typeof event.kind !== 'number') return null;
    rememberEvents([event]);
    return event;
  } catch {
    try {
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(PENDING_KEY);
    } catch {
      /* ignore */
    }
    return null;
  }
}

/** True when `event` is the edition the publication route is asking for. */
export function eventMatchesPublicationRoute(
  event: Event,
  kind: number,
  pubkey: string,
  d: string
): boolean {
  if (event.kind !== kind) return false;
  if (pubkey && event.pubkey.toLowerCase() !== pubkey.toLowerCase()) return false;
  const ed = firstTag(event, 'd') ?? '';
  const wanted = new Set<string>([d, ...dTagVariants(d)].filter(Boolean));
  const normalized = normalizeDTag(d);
  if (normalized) wanted.add(normalized);
  if (wanted.has(ed)) return true;
  const evNorm = normalizeDTag(ed);
  if (evNorm && wanted.has(evNorm)) return true;
  return dTagVariants(ed).some((v) => wanted.has(v));
}

/** Warm a listing event (and optional id) before navigating to its page. */
export function warmNavEvent(event: Event | null | undefined, alsoId?: string | null): void {
  if (event) {
    rememberEvents([event]);
    stashPending(event);
  }
  if (alsoId) {
    const hit = memoryGetEvent(alsoId);
    if (hit) rememberEvents([hit]);
  }
}
