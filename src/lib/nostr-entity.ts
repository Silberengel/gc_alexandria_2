import { nip19 } from 'nostr-tools';

/** note / nevent / naddr (optional `nostr:`). */
const EVENT_BECH32 = /(?:nostr:)?((?:note|nevent|naddr)1[02-9ac-hj-np-z]+)/i;

/**
 * Event bech32 embedded in a destination (bare token, `nostr:…`, or an HTTP
 * wrapper such as `https://njump.me/naddr1…`). Used to attach a chevron expand
 * — the URL itself stays a normal link.
 */
export function eventBech32FromDestination(raw: string): string | null {
  const cleaned = raw.trim().replace(/[),.;:!?'"\]]+$/g, '');
  if (!cleaned) return null;
  const match = EVENT_BECH32.exec(cleaned);
  const bech = match?.[1];
  if (!bech) return null;
  try {
    const type = nip19.decode(bech).type;
    if (type === 'note' || type === 'nevent' || type === 'naddr') return bech;
  } catch {
    return null;
  }
  return null;
}

/** True when an http(s) URL points at a note/nevent/naddr (chevron, not OG). */
export function urlEmbedsNostrEvent(url: string): boolean {
  return !!eventBech32FromDestination(url);
}

/** Short label for a long njump / nostr link. */
export function visibleEventLinkLabel(url: string, fallback = url): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\//, '');
    if (!path) return u.hostname;
    const short =
      path.length > 28 ? `${path.slice(0, 14)}…${path.slice(-10)}` : path;
    return `${u.hostname.replace(/^www\./i, '')}/${short}`;
  } catch {
    return fallback.length > 48 ? `${fallback.slice(0, 28)}…` : fallback;
  }
}
