import type { Event } from 'nostr-tools';
import { normalizeWebSocketRelay, webSocketRelays } from './relay-filters';

export type Nip65Mailboxes = {
  inbox: string[];
  outbox: string[];
};

/**
 * Parse NIP-65 kind 10002 `r` tags into read (inbox) and write (outbox) lists.
 * - `["r", url]` → both
 * - `["r", url, "read"]` → inbox only
 * - `["r", url, "write"]` → outbox only
 *
 * Also accepts rare legacy `["w", url]` as outbox-only.
 */
export function nip65InboxOutbox(event: Event | null | undefined): Nip65Mailboxes {
  const inbox: string[] = [];
  const outbox: string[] = [];
  if (!event) return { inbox, outbox };

  for (const tag of event.tags) {
    const name = tag[0];
    const url = tag[1]?.trim();
    if (!url) continue;
    const norm = normalizeWebSocketRelay(url);
    if (!norm) continue;
    const marker = (tag[2] ?? '').trim().toLowerCase();

    if (name === 'w') {
      outbox.push(norm);
      continue;
    }
    if (name !== 'r') continue;

    if (marker === 'write') {
      outbox.push(norm);
    } else if (marker === 'read') {
      inbox.push(norm);
    } else {
      inbox.push(norm);
      outbox.push(norm);
    }
  }

  return {
    inbox: webSocketRelays(inbox),
    outbox: webSocketRelays(outbox)
  };
}

/** Tag values named `relay` from NIP-51 lists (10012 / 10006 / 10432). */
export function relayTagUrls(event: Event | null | undefined): string[] {
  if (!event) return [];
  return webSocketRelays(
    event.tags.filter((t) => t[0] === 'relay' && t[1]).map((t) => t[1]!)
  );
}
