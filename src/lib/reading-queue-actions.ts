import type { Event } from 'nostr-tools';
import { get, writable } from 'svelte/store';
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
import { coordinatesOverlap } from './publication-coordinate';
import { signAndPublish, isSignInFlight } from './sign';
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

/** Live scroll progress not yet signed — Reading now / progress bar read this immediately. */
export type PendingReadingProgress = {
  a: string;
  pos: number;
  total: number;
  sectionId?: string;
};

export const pendingReadingProgress = writable<PendingReadingProgress | null>(null);

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

/**
 * Tracked progress never moves backward from scroll (rereading / scrolling to metadata).
 * Use {@link resetReadingProgress} to deliberately set a lower position.
 */
export function nextTrackedPos(currentPos: number, observedPos: number): number {
  return Math.max(Math.max(0, Math.floor(currentPos)), Math.max(0, Math.floor(observedPos)));
}

function sameEdition(
  publication: Event,
  pending: { publication: Event } | null | undefined
): boolean {
  if (!pending) return false;
  return coordinatesOverlap(eventAddress(publication), eventAddress(pending.publication));
}

/** Pending scroll progress — do not NIP-07-prompt on every verse crossing. */
let pendingProgress: {
  publication: Event;
  pos: number;
  total: number;
  sectionId?: string;
} | null = null;
let progressTimer: ReturnType<typeof setTimeout> | 0 = 0;
/**
 * Max wait from the *first* advance in a burst before signing.
 * The timer is not reset on further scrolls (continuous reading used to starve publishes).
 */
const PROGRESS_PUBLISH_MS = 3_500;

function clearProgressTimer(): void {
  if (progressTimer) {
    clearTimeout(progressTimer);
    progressTimer = 0;
  }
}

function publishPendingStore(): void {
  if (!pendingProgress) {
    pendingReadingProgress.set(null);
    return;
  }
  pendingReadingProgress.set({
    a: eventAddress(pendingProgress.publication),
    pos: pendingProgress.pos,
    total: pendingProgress.total,
    sectionId: pendingProgress.sectionId
  });
}

function queuePending(opts: {
  publication: Event;
  pos: number;
  total: number;
  sectionId?: string;
}): void {
  pendingProgress = opts;
  publishPendingStore();
  // Do not reset an in-flight timer — first advance in the burst starts the clock.
  if (progressTimer) return;
  progressTimer = setTimeout(() => {
    progressTimer = 0;
    void flushReadingProgress();
  }, PROGRESS_PUBLISH_MS);
}

function clearPendingIntent(): void {
  pendingProgress = null;
  pendingReadingProgress.set(null);
}

/** Publish any debounced reading-queue progress immediately (leave reader / hide tab). */
export async function flushReadingProgress(): Promise<Event | null | 'local'> {
  clearProgressTimer();
  const opts = pendingProgress;
  // Amber: opening the signer backgrounds the tab. A nested flush would start a second
  // sign_event while the first is waiting for approval — drop that race.
  if (isSignInFlight()) return null;
  if (!opts || !sessionOk()) {
    clearPendingIntent();
    return null;
  }
  // Drop the queued intent so further scrolls can start a new burst while this signs.
  // Keep the UI store until the signed event lands (or a newer pending replaces it).
  pendingProgress = null;
  const result = await publishProgressNow(opts);
  if (pendingProgress) {
    publishPendingStore();
  } else if (result) {
    pendingReadingProgress.set(null);
  } else {
    // Sign failed — restore so a later flush / visibility can retry.
    pendingProgress = opts;
    publishPendingStore();
  }
  return result;
}

/**
 * Flush when safe for the active signer. Amber/bunker: wait until the page is visible
 * again so we do not race the approval sheet. Extension: flush on hide as before.
 */
export function flushReadingProgressOnHide(): void {
  if (isSignInFlight()) return;
  if (session.getSignerType() === 'bunker') {
    // Keep pendingProgress; visibility→visible handler will flush.
    return;
  }
  void flushReadingProgress();
}

export function flushReadingProgressOnVisible(): void {
  if (document.visibilityState !== 'visible') return;
  if (isSignInFlight()) return;
  if (!pendingProgress) return;
  void flushReadingProgress();
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
  // Scroll must not move tracked progress backward (metadata / reread).
  if (opts.pos < cur.pos) {
    if (opts.total > cur.total) {
      return publishEntries(
        upsertReadingEntry(currentEntries(), {
          ...cur,
          total: Math.max(opts.total, cur.total, 1),
          updated: Math.floor(Date.now() / 1000)
        })
      );
    }
    if (get(readingPrefs).localOnly) return 'local';
    return latestReplaceable(session.getMetadata(), KIND.READING_QUEUE);
  }
  const pos = nextTrackedPos(cur.pos, opts.pos);
  if (
    pos === cur.pos &&
    opts.total <= cur.total &&
    (opts.sectionId ?? '') === (cur.sectionId ?? '')
  ) {
    if (get(readingPrefs).localOnly) return 'local';
    return latestReplaceable(session.getMetadata(), KIND.READING_QUEUE);
  }
  const next: ReadingQueueEntry = {
    a,
    pos,
    total: Math.max(opts.total, cur.total, 1),
    sectionId: opts.sectionId ?? cur.sectionId,
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
  clearPendingIntent();
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
  clearPendingIntent();
  const entries = removeReadingEntry(currentEntries(), eventAddress(publication));
  return publishEntries(entries);
}

/**
 * Update live progress intent immediately (Reading now / bar); sign kind 16374 at most
 * every few seconds from the first advance in a burst (timer does not reset on scroll).
 * Progress only advances forward — scrolling up does not rewrite the tracked pos.
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

  const pendingFloor =
    sameEdition(opts.publication, pendingProgress) && pendingProgress
      ? pendingProgress.pos
      : 0;
  const floor = Math.max(cur.pos, pendingFloor);

  // Behind the watermark: keep any pending ahead-progress; only allow total growth.
  if (opts.pos < floor) {
    if (opts.total > cur.total && opts.total > (pendingProgress?.total ?? 0)) {
      const next = {
        publication: opts.publication,
        pos: floor,
        total: opts.total,
        sectionId: pendingProgress?.sectionId ?? cur.sectionId
      };
      if (get(readingPrefs).localOnly) {
        queuePending(next);
        clearProgressTimer();
        return flushReadingProgress();
      }
      queuePending(next);
    }
    if (get(readingPrefs).localOnly) return 'local';
    return latestReplaceable(session.getMetadata(), KIND.READING_QUEUE);
  }

  if (
    opts.pos === cur.pos &&
    opts.total === cur.total &&
    (opts.sectionId ?? '') === (cur.sectionId ?? '') &&
    !pendingProgress
  ) {
    if (get(readingPrefs).localOnly) return 'local';
    return latestReplaceable(session.getMetadata(), KIND.READING_QUEUE);
  }
  const next = {
    publication: opts.publication,
    pos: opts.pos,
    total: opts.total,
    sectionId: opts.sectionId
  };
  // Local-only: apply immediately — no sign prompt to debounce.
  if (get(readingPrefs).localOnly) {
    queuePending(next);
    clearProgressTimer();
    return flushReadingProgress();
  }
  queuePending(next);
  return latestReplaceable(session.getMetadata(), KIND.READING_QUEUE);
}

/**
 * Force tracked progress back to the start (pos 0).
 * Everyday scroll never calls this — only the Reset tracking control.
 */
export async function resetReadingProgress(opts: {
  publication: Event;
  total: number;
}): Promise<Event | null | 'local'> {
  if (!sessionOk()) return null;
  const { publication, total } = opts;
  if (total < 1) return null;
  clearProgressTimer();
  clearPendingIntent();
  const a = eventAddress(publication);
  const existing = findQueueEntry(currentEntries(), a);
  if (!existing) return null;
  return publishEntries(
    upsertReadingEntry(currentEntries(), {
      a,
      pos: 0,
      total: Math.max(total, existing.total, 1),
      sectionId: undefined,
      updated: Math.floor(Date.now() / 1000)
    })
  );
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
  clearPendingIntent();

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
