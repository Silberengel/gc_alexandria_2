import type { Event } from 'nostr-tools';
import { CACHE_KINDS, KIND } from './constants';
import { cacheDeleteEvent } from './nostr/cache';
import { relayPool } from './nostr/pool';
import { documentStack, socialStack } from './nostr/selector';

export async function sweepDeletions(): Promise<void> {
  const filter = { kinds: [KIND.DELETION], limit: 200 };
  const [doc, social] = await Promise.all([
    relayPool.query(documentStack(), [filter], 4000),
    relayPool.query(socialStack(), [filter], 4000)
  ]);
  const byId = new Map<string, Event>();
  for (const event of [...doc, ...social]) byId.set(event.id, event);
  const ids = new Set<string>();
  for (const event of byId.values()) {
    for (const tag of event.tags) {
      if (tag[0] === 'e' && tag[1] && /^[0-9a-f]{64}$/i.test(tag[1])) {
        ids.add(tag[1].toLowerCase());
      }
      if (tag[0] === 'k' && tag[1] && !CACHE_KINDS.includes(Number(tag[1]) as (typeof CACHE_KINDS)[number])) {
        /* still evict e-tags; k is informational */
      }
    }
  }
  await Promise.all([...ids].map((id) => cacheDeleteEvent(id)));
}

export function scheduleDeletionSweep(): void {
  const run = () => {
    void sweepDeletions();
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => setTimeout(run, 0));
  } else {
    setTimeout(run, 0);
  }
}
