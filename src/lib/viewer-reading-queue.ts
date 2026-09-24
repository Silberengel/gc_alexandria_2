import { derived, type Readable } from 'svelte/store';
import {
  readingQueueFromMetadata,
  upsertReadingEntry,
  type ReadingQueueEntry
} from './reading-queue';
import { pendingReadingProgress } from './reading-queue-actions';
import { localReadingQueue } from './stores/local-reading-queue';
import { readingPrefs } from './stores/reading-prefs';
import { session } from './stores/session';

/**
 * The signed-in viewer's reading queue: relay kind 16374 by default,
 * or the on-device queue when Settings → local-only is on.
 * Unsynced scroll progress overlays immediately so Reading now / bars move
 * before the next signed publish.
 */
export const viewerReadingEntries: Readable<ReadingQueueEntry[]> = derived(
  [readingPrefs, localReadingQueue, session.metadata, pendingReadingProgress],
  ([$prefs, $local, $meta, $pending]) => {
    const base = $prefs.localOnly ? $local : readingQueueFromMetadata($meta);
    if (!$pending) return base;
    return upsertReadingEntry(base, {
      a: $pending.a,
      pos: $pending.pos,
      total: $pending.total,
      sectionId: $pending.sectionId,
      updated: Math.floor(Date.now() / 1000)
    });
  }
);
