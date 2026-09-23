import type { Event } from 'nostr-tools';
import { naddrFor } from './publication-load';
import { eventAddress } from './nostr/verify';
import { fetchByAddress, fetchById } from './nostr/fetch';
import { cachePutEvent, cachePutPublicationStream } from './nostr/cache';
import { mercuryPublicationStream } from './nostr/mercury';
import { rememberEvents } from './nostr/event-memory';
import type { ReadingQueueEntry } from './reading-queue';

const HEX64 = /^[0-9a-f]{64}$/i;
const ADDR = /^\d+:[0-9a-f]{64}:.+/i;

/** Prefer not to stampede Mercury when warming several queue books. */
let warmInFlight: Promise<void> | null = null;
let lastWarmKey = '';

/**
 * Prefetch currently-reading editions (and nearby stream pages) into the
 * client event cache so Continue / offline reopens can paint without relays.
 */
export function warmReadingQueueCache(entries: ReadingQueueEntry[]): void {
  const slice = entries.slice(0, 12);
  const key = slice.map((e) => `${e.a}@${e.pos}@${e.sectionId ?? ''}`).join('|');
  if (!key || key === lastWarmKey || warmInFlight) return;
  lastWarmKey = key;
  warmInFlight = (async () => {
    try {
      for (const entry of slice) {
        const pub = await fetchByAddress(entry.a);
        if (!pub) continue;
        rememberEvents([pub]);
        void cachePutEvent(pub);
        if (entry.sectionId) {
          let section: Event | null = null;
          if (HEX64.test(entry.sectionId)) section = await fetchById(entry.sectionId);
          else if (ADDR.test(entry.sectionId)) section = await fetchByAddress(entry.sectionId);
          if (section) {
            rememberEvents([section]);
            void cachePutEvent(section);
          }
        }
        // Warm a window around the resume pos; also grow the per-edition stream snapshot.
        const from = Math.max(0, Math.floor(entry.pos) - 2);
        try {
          const page = await mercuryPublicationStream(
            naddrFor(pub),
            from,
            undefined,
            undefined,
            { maxEvents: 120 }
          );
          if (page.length) void cachePutPublicationStream(eventAddress(pub), page);
        } catch {
          /* offline or Mercury down — edition + section above still help */
        }
      }
    } finally {
      warmInFlight = null;
    }
  })();
}
