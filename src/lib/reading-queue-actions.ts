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
import { localReadingQueue } from './stores/local-reading-queue';

export type FinishReadingResult = {
  ok: boolean;
  /** Address of the book that just entered the active set, if any. */
  shiftedAddress?: string;
  finishedAddress?: string;
  /** Newly published or existing live l=read for this edition. */
  readEvent?: Event;
};

function currentEntries(): ReadingQueueEntry[] {
  if (get(readingPrefs).localOnly) return get(localReadingQueue);
  return readingQueueFromMetadata(session.getMetadata());
}

function sessionOk(): boolean {
  return !!get(session).pubkey;
}

/** Persist queue: local store when Settings → local-only, else kind 16374. */
async function publishEntries(entries: ReadingQueueEntry[]): Promise<Event | null | 'local'> {
  if (get(readingPrefs).localOnly) {
    localReadingQueue.replace(entries);
    return 'local';
  }
  return signAndPublish(readingQueueDraft(entries));
}

/** Pending scroll progress — do not NIP-07-prompt on every verse crossing. */
let pendingProgress: {
  publication: Event;
  pos: number;
  total: number;
  sectionId?: string;
} | null = null;
let progressTimer: ReturnType<typeof setTimeout> | 0 = 0;
/** Quiet period after the last scroll advance before publishing kind 16374. */
const PROGRESS_DEBOUNCE_MS = 12_000;

function clearProgressTimer(): void {
  if (progressTimer) {
    clearTimeout(progressTimer);
    progressTimer = 0;
  }
}

/** Publish any debounced reading-queue progress immediately (leave reader / hide tab). */
export async function flushReadingProgress(): Promise<Event | null | 'local'> {
  clearProgressTimer();
  const opts = pendingProgress;
  pendingProgress = null;
  if (!opts || !sessionOk()) return null;
  return publishProgressNow(opts);
}

async function publishProgressNow(opts: {
  publication: Event;
  pos: number;
  total: number;
  sectionId?: string;
}): Promise<Event | null | 'local'> {
  const a = eventAddress(opts.publication);
  const cur = findQueueEntry(currentEntries(), a);
  if (!cur) return null;
  if (
    opts.pos === cur.pos &&
    opts.total === cur.total &&
    (opts.sectionId ?? '') === (cur.sectionId ?? '')
  ) {
    if (get(readingPrefs).localOnly) return 'local';
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

export async function trackReadingPublication(opts: {
  publication: Event;
  pos: number;
  total: number;
  sectionId?: string;
}): Promise<Event | null | 'local'> {
  if (!sessionOk()) return null;
  const { publication, pos, total, sectionId } = opts;
  if (total < 1) return null;
  clearProgressTimer();
  pendingProgress = null;
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

export async function stopTrackingPublication(publication: Event): Promise<Event | null | 'local'> {
  if (!sessionOk()) return null;
  clearProgressTimer();
  pendingProgress = null;
  const entries = removeReadingEntry(currentEntries(), eventAddress(publication));
  return publishEntries(entries);
}

/**
 * Update local progress intent; publish kind 16374 only after scrolling settles
 * so extension sign prompts are not fired on every section/verse crossing.
 * When Settings → local-only, progress never leaves this browser.
 */
export async function syncReadingProgress(opts: {
  publication: Event;
  pos: number;
  total: number;
  sectionId?: string;
}): Promise<Event | null | 'local'> {
  if (!sessionOk()) return null;
  const a = eventAddress(opts.publication);
  const cur = findQueueEntry(currentEntries(), a);
  if (!cur) return null;
  if (
    opts.pos === cur.pos &&
    opts.total === cur.total &&
    (opts.sectionId ?? '') === (cur.sectionId ?? '')
  ) {
    if (get(readingPrefs).localOnly) return 'local';
    return latestReplaceable(session.getMetadata(), KIND.READING_QUEUE);
  }
  pendingProgress = {
    publication: opts.publication,
    pos: opts.pos,
    total: opts.total,
    sectionId: opts.sectionId
  };
  // Local-only: apply immediately — no sign prompt to debounce.
  if (get(readingPrefs).localOnly) {
    clearProgressTimer();
    return flushReadingProgress();
  }
  clearProgressTimer();
  progressTimer = setTimeout(() => {
    progressTimer = 0;
    void flushReadingProgress();
  }, PROGRESS_DEBOUNCE_MS);
  return latestReplaceable(session.getMetadata(), KIND.READING_QUEUE);
}

export async function promoteReadingToFront(editionAddress: string): Promise<Event | null | 'local'> {
  if (!sessionOk()) return null;
  await flushReadingProgress();
  const entries = moveReadingEntryToFront(currentEntries(), editionAddress);
  return publishEntries(entries);
}

/**
 * After turning off local-only, publish the on-device queue as kind 16374
 * so relay progress matches what was tracked privately.
 */
export async function publishLocalReadingQueueToRelays(): Promise<Event | null> {
  if (!sessionOk()) return null;
  await flushReadingProgress();
  const entries = get(localReadingQueue);
  if (!entries.length) return latestReplaceable(session.getMetadata(), KIND.READING_QUEUE);
  return signAndPublish(readingQueueDraft(entries));
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

  // Drop any pending scroll publish for this (or other) book before finishing.
  clearProgressTimer();
  pendingProgress = null;

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
