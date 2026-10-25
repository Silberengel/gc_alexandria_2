import type { Event, Filter } from 'nostr-tools';
import { KIND } from './constants';
import { cachedEventsReferencing } from './nostr/cache';
import { rememberEvents } from './nostr/event-memory';
import { withPreferredRelays } from './nostr/mailboxes';
import { relayPool } from './nostr/pool';
import { socialStack } from './nostr/selector';

const HEX_64 = /^[0-9a-f]{64}$/i;

/** NIP-41 short-note edit state for a kind-1 note (Imwald / jumble parity). */
export type ShortNoteEditState = {
  latestAuthorEdit: Event | null;
  authorEdits: Event[];
  editProposals: Event[];
};

export function emptyShortNoteEditState(): ShortNoteEditState {
  return { latestAuthorEdit: null, authorEdits: [], editProposals: [] };
}

/** `e` / `E` tag on kind 1010 pointing at the edited kind-1 note id. */
export function getEditTargetId(edit: Event): string | null {
  if (edit.kind !== KIND.SHORT_NOTE_EDIT) return null;
  const tag = edit.tags.find((t) => t[0] === 'e') ?? edit.tags.find((t) => t[0] === 'E');
  const id = tag?.[1]?.trim() ?? '';
  if (!HEX_64.test(id)) return null;
  return id.toLowerCase();
}

export function isAuthorEdit(edit: Event, kind1: Event): boolean {
  if (edit.kind !== KIND.SHORT_NOTE_EDIT) return false;
  const target = getEditTargetId(edit);
  if (!target || target !== kind1.id.toLowerCase()) return false;
  return edit.pubkey.toLowerCase() === kind1.pubkey.toLowerCase();
}

export function isCollaborativeProposal(edit: Event, kind1: Event): boolean {
  if (edit.kind !== KIND.SHORT_NOTE_EDIT) return false;
  const target = getEditTargetId(edit);
  if (!target || target !== kind1.id.toLowerCase()) return false;
  return edit.pubkey.toLowerCase() !== kind1.pubkey.toLowerCase();
}

export function buildShortNoteEditState(edits: Event[], kind1: Event): ShortNoteEditState {
  const authorEdits = edits
    .filter((e) => isAuthorEdit(e, kind1))
    .sort((a, b) => a.created_at - b.created_at);
  const editProposals = edits
    .filter((e) => isCollaborativeProposal(e, kind1))
    .sort((a, b) => b.created_at - a.created_at);
  return {
    latestAuthorEdit: authorEdits[authorEdits.length - 1] ?? null,
    authorEdits,
    editProposals
  };
}

export function mergeShortNoteEditEvents(
  existing: Event[],
  incoming: Event[],
  kind1: Event
): ShortNoteEditState {
  const byId = new Map<string, Event>();
  for (const edit of [...existing, ...incoming]) {
    if (edit?.id) byId.set(edit.id.toLowerCase(), edit);
  }
  return buildShortNoteEditState([...byId.values()], kind1);
}

/** Overlay latest author-edit content onto a kind-1 note for display. */
export function mergeEditedShortNote(kind1: Event, edit: Event | null | undefined): Event {
  if (!edit || edit.content === kind1.content) return kind1;
  return { ...kind1, content: edit.content };
}

export function isShortNoteEdited(kind1: Event, latestAuthorEdit: Event | null | undefined): boolean {
  return !!latestAuthorEdit && latestAuthorEdit.content !== kind1.content;
}

/** Kind-1111 reply: `e` tag with marker `edit` referencing a kind-1010 revision. */
export function getReplyEditId(reply: Event): string | null {
  const tag = reply.tags.find(
    (row) =>
      (row[0] === 'e' || row[0] === 'E') &&
      row[3] === 'edit' &&
      !!row[1] &&
      HEX_64.test(row[1])
  );
  return tag?.[1]?.toLowerCase() ?? null;
}

const stateCache = new Map<string, ShortNoteEditState>();
const inflight = new Map<string, Promise<ShortNoteEditState>>();
const relayFetched = new Set<string>();
const listeners = new Map<string, Set<() => void>>();

type QueueEntry = {
  kind1: Event;
  resolve: (state: ShortNoteEditState) => void;
  reject: (err: unknown) => void;
};

/** Debounced multi-note `#e` batch — one background REQ instead of N priority REQs. */
const pendingQueue = new Map<string, QueueEntry[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushRunning = false;

const BATCH_SIZE = 24;
const BATCH_WAIT_MS = 75;
const BATCH_RELAY_CAP = 4;

function notifyShortNoteEdits(noteId: string): void {
  const key = noteId.toLowerCase();
  const set = listeners.get(key);
  if (!set) return;
  for (const cb of set) cb();
}

/** Re-run display when thread ingest or a fetch updates edits for this note. */
export function onShortNoteEdits(noteId: string, cb: () => void): () => void {
  const key = noteId.toLowerCase();
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (!set!.size) listeners.delete(key);
  };
}

function scheduleFlush(): void {
  if (flushTimer || flushRunning) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushEditQueue();
  }, BATCH_WAIT_MS);
}

async function flushEditQueue(): Promise<void> {
  if (flushRunning) return;
  flushRunning = true;
  try {
    while (pendingQueue.size) {
      const keys = [...pendingQueue.keys()].slice(0, BATCH_SIZE);
      const batch = keys.map((key) => ({
        key,
        kind1: pendingQueue.get(key)![0]!.kind1,
        waiters: pendingQueue.get(key)!
      }));
      for (const key of keys) pendingQueue.delete(key);

      const byKey = new Map<string, Event[]>();
      for (const { key } of batch) byKey.set(key, []);

      await Promise.all(
        batch.map(async ({ key, kind1 }) => {
          const fromCache = (await cachedEventsReferencing(key)).filter(
            (e) => e.kind === KIND.SHORT_NOTE_EDIT && getEditTargetId(e) === key
          );
          if (fromCache.length) {
            byKey.set(key, fromCache);
            if (!stateCache.has(key)) {
              stateCache.set(key, mergeShortNoteEditEvents([], fromCache, kind1));
              notifyShortNoteEdits(key);
            }
          }
        })
      );

      // Prefer social hosts only — socialSearchStack fans out to Primus/nos.lol/…
      // and under load those REQs only deepen the pool queue for a rare kind.
      const scope = withPreferredRelays([...socialStack()], [], BATCH_RELAY_CAP);
      const filter: Filter = {
        kinds: [KIND.SHORT_NOTE_EDIT],
        '#e': keys,
        limit: Math.min(80, keys.length * 4)
      };
      // Background — never priority. Feed list + comments need the scarce slots.
      const fetched = await relayPool
        .query(scope.relays, [filter], 5000, Math.min(scope.maxRelays, BATCH_RELAY_CAP))
        .catch(() => [] as Event[]);

      for (const edit of fetched) {
        const target = getEditTargetId(edit);
        if (!target || !byKey.has(target)) continue;
        byKey.get(target)!.push(edit);
      }

      for (const { key, kind1, waiters } of batch) {
        try {
          const prev = stateCache.get(key);
          const incoming = byKey.get(key) ?? [];
          const state = mergeShortNoteEditEvents(
            prev ? [...prev.authorEdits, ...prev.editProposals] : [],
            incoming,
            kind1
          );
          if (state.authorEdits.length || state.editProposals.length) {
            rememberEvents([...state.authorEdits, ...state.editProposals]);
          }
          stateCache.set(key, state);
          relayFetched.add(key);
          notifyShortNoteEdits(key);
          for (const w of waiters) w.resolve(state);
        } catch (err) {
          for (const w of waiters) w.reject(err);
        } finally {
          inflight.delete(key);
        }
      }
    }
  } catch (err) {
    for (const waiters of pendingQueue.values()) {
      for (const w of waiters) w.reject(err);
    }
    pendingQueue.clear();
    inflight.clear();
  } finally {
    flushRunning = false;
    if (pendingQueue.size) scheduleFlush();
  }
}

/**
 * Load kind-1010 revisions for a kind-1 note. Cached; coalesces into a debounced
 * multi-`#e` batch so a feed of notes does not open N pool slots.
 */
export async function shortNoteEditState(kind1: Event): Promise<ShortNoteEditState> {
  if (kind1.kind !== KIND.TEXT_NOTE || !HEX_64.test(kind1.id)) {
    return emptyShortNoteEditState();
  }
  const key = kind1.id.toLowerCase();
  const cached = stateCache.get(key);
  if (cached && relayFetched.has(key)) return cached;
  const pending = inflight.get(key);
  if (pending) return pending;

  const work = new Promise<ShortNoteEditState>((resolve, reject) => {
    const list = pendingQueue.get(key) ?? [];
    list.push({ kind1, resolve, reject });
    pendingQueue.set(key, list);
    scheduleFlush();
  });
  inflight.set(key, work);
  return work;
}

/** Merge a known edit into the cache for this kind-1 (after publish or thread ingest). */
export function ingestShortNoteEdit(edit: Event, kind1: Event): void {
  if (edit.kind !== KIND.SHORT_NOTE_EDIT) return;
  if (getEditTargetId(edit) !== kind1.id.toLowerCase()) return;
  const key = kind1.id.toLowerCase();
  const prev = stateCache.get(key);
  const existing = prev ? [...prev.authorEdits, ...prev.editProposals] : [];
  stateCache.set(key, mergeShortNoteEditEvents(existing, [edit], kind1));
  rememberEvents([edit]);
  notifyShortNoteEdits(key);
}
