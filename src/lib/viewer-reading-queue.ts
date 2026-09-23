import { derived, type Readable } from 'svelte/store';
import {
  readingQueueFromMetadata,
  type ReadingQueueEntry
} from './reading-queue';
import { localReadingQueue } from './stores/local-reading-queue';
import { readingPrefs } from './stores/reading-prefs';
import { session } from './stores/session';

/**
 * The signed-in viewer's reading queue: relay kind 16374 by default,
 * or the on-device queue when Settings → local-only is on.
 */
export const viewerReadingEntries: Readable<ReadingQueueEntry[]> = derived(
  [readingPrefs, localReadingQueue, session.metadata],
  ([$prefs, $local, $meta]) =>
    $prefs.localOnly ? $local : readingQueueFromMetadata($meta)
);
