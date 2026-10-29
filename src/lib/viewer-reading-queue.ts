import { derived, type Readable } from 'svelte/store';
import {
  upsertReadingEntry,
  type ReadingQueueEntry
} from './reading-queue';
import {
  ownReadingQueueEntries,
  pendingReadingProgress,
  refreshOwnReadingQueue
} from './reading-queue-actions';
import { localReadingQueue } from './stores/local-reading-queue';
import { readingPrefs } from './stores/reading-prefs';
import { session } from './stores/session';

// Keep ownReadingQueueEntries in sync with prefs / metadata / local queue.
if (typeof window !== 'undefined') {
  let scheduled = false;
  const kick = (): void => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      void refreshOwnReadingQueue();
    });
  };
  readingPrefs.subscribe(kick);
  localReadingQueue.subscribe(kick);
  session.metadata.subscribe(kick);
  session.subscribe((s) => {
    if (s.pubkey) kick();
  });
}

/**
 * The signed-in viewer's reading queue: relay kind 16374 by default (with private
 * books decrypted), or the on-device queue when Settings → local-only is on.
 * Unsynced scroll progress overlays immediately so Reading now / bars move
 * before the next signed publish.
 */
export const viewerReadingEntries: Readable<ReadingQueueEntry[]> = derived(
  [ownReadingQueueEntries, pendingReadingProgress],
  ([$own, $pending]) => {
    if (!$pending) return $own;
    return upsertReadingEntry($own, {
      a: $pending.a,
      pos: $pending.pos,
      total: $pending.total,
      sectionId: $pending.sectionId,
      updated: Math.floor(Date.now() / 1000)
    });
  }
);
