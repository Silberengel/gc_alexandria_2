import type { Event } from 'nostr-tools';
import { get } from 'svelte/store';
import { KIND } from './constants';
import { publicationLabelDraft } from './drafts';
import { latestReplaceable } from './mute';
import { eventAddress } from './nostr/verify';
import { myReadLabel, readLabelsForPublication } from './read-marks';
import {
  findQueueEntry,
  moveReadingEntryToFront,
  readingQueueDraft,
  readingQueueFromMetadata,
  removeReadingEntry,
  upsertReadingEntry,
  type ReadingQueueEntry
} from './reading-queue';
import { signAndPublish } from './sign';
import { session } from './stores/session';
import { readingPrefs } from './stores/reading-prefs';

export type FinishReadingResult = {
  ok: boolean;
  /** Address of the book that just entered the active set, if any. */
  shiftedAddress?: string;
  finishedAddress?: string;
  /** Newly published or existing live l=read for this edition. */
  readEvent?: Event;
};

function currentEntries(): ReadingQueueEntry[] {
  return readingQueueFromMetadata(session.getMetadata());
}

function sessionOk(): boolean {
  return !!get(session).pubkey;
}

async function publishEntries(entries: ReadingQueueEntry[]): Promise<Event | null> {
  return signAndPublish(readingQueueDraft(entries));
}

export async function trackReadingPublication(opts: {
  publication: Event;
  pos: number;
  total: number;
  sectionId?: string;
}): Promise<Event | null> {
  if (!sessionOk()) return null;
  const { publication, pos, total, sectionId } = opts;
  if (total < 1) return null;
  const a = eventAddress(publication);
  const existing = findQueueEntry(currentEntries(), a);
  const entries = upsertReadingEntry(currentEntries(), {
    a,
    pos: existing ? Math.max(existing.pos, pos) : pos,
    total,
    sectionId: sectionId ?? existing?.sectionId,
    updated: Math.floor(Date.now() / 1000)
  });
  return publishEntries(entries);
}

export async function stopTrackingPublication(publication: Event): Promise<Event | null> {
  if (!sessionOk()) return null;
  const entries = removeReadingEntry(currentEntries(), eventAddress(publication));
  return publishEntries(entries);
}

export async function syncReadingProgress(opts: {
  publication: Event;
  pos: number;
  total: number;
  sectionId?: string;
}): Promise<Event | null> {
  if (!sessionOk()) return null;
  const a = eventAddress(opts.publication);
  const cur = findQueueEntry(currentEntries(), a);
  if (!cur) return null;
  if (
    opts.pos === cur.pos &&
    opts.total === cur.total &&
    (opts.sectionId ?? '') === (cur.sectionId ?? '')
  ) {
    return latestReplaceable(session.getMetadata(), KIND.READING_QUEUE);
  }
  const next: ReadingQueueEntry = {
    a,
    pos: opts.pos,
    total: Math.max(opts.total, cur.total, 1),
    sectionId: opts.sectionId,
    updated: Math.floor(Date.now() / 1000)
  };
  return publishEntries(upsertReadingEntry(currentEntries(), next));
}

export async function promoteReadingToFront(editionAddress: string): Promise<Event | null> {
  if (!sessionOk()) return null;
  const entries = moveReadingEntryToFront(currentEntries(), editionAddress);
  return publishEntries(entries);
}

/**
 * Mark read (if needed), then drop from the reading queue.
 * Call this from the read-label toggle when the edition is tracked — not from section progress.
 */
export async function finishTrackedPublication(
  publication: Event,
  opts?: { readLabels?: Event[] }
): Promise<FinishReadingResult> {
  if (!sessionOk()) return { ok: false };
  const a = eventAddress(publication);
  const concurrent = get(readingPrefs).concurrent;

  const labels = opts?.readLabels ?? [];
  let readEvent =
    myReadLabel(
      readLabelsForPublication(labels, publication),
      publication,
      get(session).pubkey
    ) ?? undefined;
  if (!readEvent) {
    const signed = await signAndPublish(publicationLabelDraft(publication, 'read'));
    if (!signed) return { ok: false };
    readEvent = signed;
  }

  // Snapshot after awaits so shift detection and the published removal use the same list.
  const before = currentEntries();
  const idx = before.findIndex((e) => !!findQueueEntry([e], a));
  const shiftedAddress =
    idx >= 0 && idx < concurrent && before.length > concurrent
      ? before[concurrent]?.a
      : undefined;

  if (idx >= 0) {
    const published = await publishEntries(removeReadingEntry(before, a));
    if (!published) return { ok: false, readEvent };
  }

  return {
    ok: true,
    finishedAddress: a,
    shiftedAddress,
    readEvent
  };
}
