import type { Event } from 'nostr-tools';
import { relayPool } from './nostr/pool';
import { broadcastStack } from './nostr/selector';

export type BroadcastResult = {
  accepted: number;
  attempted: number;
};

/**
 * Re-publish an already-signed event to the viewer's outboxes
 * (or {@link PUBLIC_BROADCAST_RELAYS} when signed out).
 */
export async function broadcastEvent(event: Event): Promise<BroadcastResult> {
  const relays = broadcastStack();
  if (!relays.length) return { accepted: 0, attempted: 0 };
  const accepted = await relayPool.broadcast(relays, event);
  return { accepted, attempted: relays.length };
}
