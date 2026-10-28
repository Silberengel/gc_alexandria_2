/**
 * Fan-out an already-signed publication tree (30040 indexes + a/e children of any kind)
 * to the viewer's write relays.
 */
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { collectPublicationEventsForExport } from './publication-export';
import { relayPool } from './nostr/pool';
import { writeStack } from './nostr/selector';

export type RepublishProgress = {
  phase: 'collecting' | 'publishing' | 'done' | 'error';
  done: number;
  total: number;
  message: string;
};

export type RepublishResult = {
  ok: boolean;
  eventCount: number;
  relayAttempted: number;
  /** Events that got at least one OK. */
  acceptedEvents: number;
  failedIds: string[];
  error?: string;
};

const DEFAULT_CONCURRENCY = 3;

function dedupeEvents(events: Event[]): Event[] {
  const out: Event[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    const id = event.id?.trim().toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(event);
  }
  return out;
}

/** Root index first, then every fetched child (nested 30040s and leaf sections). */
export async function collectPublicationEventsForRepublish(
  root: Event,
  seedEvents: Event[] = []
): Promise<Event[]> {
  const nested = await collectPublicationEventsForExport(root, seedEvents);
  return dedupeEvents([root, ...nested]);
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        await worker(items[i]!, i);
      }
    })
  );
}

/**
 * Collect the publication tree and re-broadcast each event to {@link writeStack}.
 * Does not re-sign. Requires a signed-in viewer with at least one write relay.
 */
export async function republishPublicationToWriteRelays(
  root: Event,
  opts?: {
    seedEvents?: Event[];
    onProgress?: (progress: RepublishProgress) => void;
    concurrency?: number;
  }
): Promise<RepublishResult> {
  const report = (progress: RepublishProgress): void => {
    opts?.onProgress?.(progress);
  };

  if (root.kind !== KIND.PUBLICATION) {
    const error = 'Only publication indexes (kind 30040) can be republished as a tree.';
    report({ phase: 'error', done: 0, total: 0, message: error });
    return { ok: false, eventCount: 0, relayAttempted: 0, acceptedEvents: 0, failedIds: [], error };
  }

  const relays = writeStack();
  if (!relays.length) {
    const error = 'No write relays are available. Sign in and set outboxes or favorites.';
    report({ phase: 'error', done: 0, total: 0, message: error });
    return { ok: false, eventCount: 0, relayAttempted: 0, acceptedEvents: 0, failedIds: [], error };
  }

  report({
    phase: 'collecting',
    done: 0,
    total: 0,
    message: 'Collecting publication indexes and sections…'
  });

  let events: Event[];
  try {
    events = await collectPublicationEventsForRepublish(root, opts?.seedEvents ?? []);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    report({ phase: 'error', done: 0, total: 0, message: error });
    return { ok: false, eventCount: 0, relayAttempted: relays.length, acceptedEvents: 0, failedIds: [], error };
  }

  if (!events.length) {
    const error = 'No publication events to republish.';
    report({ phase: 'error', done: 0, total: 0, message: error });
    return { ok: false, eventCount: 0, relayAttempted: relays.length, acceptedEvents: 0, failedIds: [], error };
  }

  const total = events.length;
  report({
    phase: 'publishing',
    done: 0,
    total,
    message: `Publishing 0 of ${total} events to ${relays.length} write relay${relays.length === 1 ? '' : 's'}…`
  });

  const failedIds: string[] = [];
  let acceptedEvents = 0;
  let done = 0;
  const concurrency = opts?.concurrency ?? DEFAULT_CONCURRENCY;

  await mapPool(events, concurrency, async (event) => {
    const accepted = await relayPool.broadcast(relays, event);
    if (accepted > 0) acceptedEvents += 1;
    else failedIds.push(event.id);
    done += 1;
    report({
      phase: 'publishing',
      done,
      total,
      message: `Publishing ${done} of ${total} events…`
    });
  });

  const ok = acceptedEvents > 0;
  const message = ok
    ? failedIds.length
      ? `Republished ${acceptedEvents} of ${total} events (${failedIds.length} missed).`
      : `Republished ${acceptedEvents} event${acceptedEvents === 1 ? '' : 's'} to your write relays.`
    : 'No relay accepted any event.';

  report({
    phase: ok ? 'done' : 'error',
    done: total,
    total,
    message
  });

  return {
    ok,
    eventCount: total,
    relayAttempted: relays.length,
    acceptedEvents,
    failedIds,
    error: ok ? undefined : message
  };
}
