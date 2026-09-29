/**
 * Shared in-flight kind-0 fetches so badge grids coalesce REQs for the same pubkey.
 */

import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { relayPool } from './nostr/pool';
import { profileStack } from './nostr/selector';
import { cachePutEvent } from './nostr/cache';
import { rememberProfileFromKind0 } from './profile-cache';
import { memoryFindMetadata, rememberEvents } from './nostr/event-memory';
import { pickLatestReplaceable } from './nostr/replaceable';

const metadataInflight = new Map<string, Promise<Event | null>>();

export function ensureMetadata(pubkey: string): Promise<Event | null> {
  const pk = pubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pk)) return Promise.resolve(null);
  const mem = memoryFindMetadata(pk);
  if (mem) return Promise.resolve(mem);
  const pending = metadataInflight.get(pk);
  if (pending) return pending;
  const job = (async () => {
    try {
      const fetched = await relayPool.query(
        profileStack(),
        [{ kinds: [0], authors: [pk], limit: 1 }],
        4000
      );
      const meta =
        pickLatestReplaceable(fetched, KIND.METADATA, pk) ?? fetched[0] ?? null;
      if (meta) {
        void cachePutEvent(meta);
        rememberEvents([meta]);
        rememberProfileFromKind0(meta);
      }
      return meta;
    } finally {
      metadataInflight.delete(pk);
    }
  })();
  metadataInflight.set(pk, job);
  return job;
}
