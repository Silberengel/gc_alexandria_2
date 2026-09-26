import { verifyEvent, type Event } from 'nostr-tools';
import { KIND } from '../constants';

function normalizeShape(e: Event): Event {
  return {
    ...e,
    id: e.id.toLowerCase(),
    pubkey: e.pubkey.toLowerCase(),
    content: e.kind === KIND.PUBLICATION ? '' : (e.content ?? ''),
    tags: Array.isArray(e.tags) ? e.tags : [],
    created_at: typeof e.created_at === 'number' ? e.created_at : 0,
    sig: typeof e.sig === 'string' ? e.sig : ''
  };
}

export function ingestEvent(raw: unknown): Event | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Event;
  if (!e.id || !e.pubkey || !e.sig) return null;
  const normalized = normalizeShape(e);
  try {
    if (!verifyEvent(normalized)) return null;
  } catch {
    return null;
  }
  return normalized;
}

/**
 * Shape-check only. Use for app-bundled seed shards and Cache Storage blobs we wrote —
 * verifying tens of thousands of secp signatures on the main thread melts the CPU.
 */
export function ingestTrustedEvent(raw: unknown): Event | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Event;
  if (!e.id || !e.pubkey || typeof e.kind !== 'number') return null;
  return normalizeShape(e);
}

export function tagValue(event: Event, name: string): string[] {
  return event.tags.filter((t) => t[0] === name && t[1]).map((t) => t[1]!);
}

export function firstTag(event: Event, name: string): string | undefined {
  return tagValue(event, name)[0];
}

export function eventAddress(event: Event): string {
  const d = firstTag(event, 'd') ?? '';
  return `${event.kind}:${event.pubkey}:${d}`;
}

export function isTopLevel30040(event: Event, all30040: Event[]): boolean {
  if (event.kind !== KIND.PUBLICATION) return false;
  const addr = eventAddress(event);
  return !all30040.some((other) =>
    other.tags.some((t) => t[0] === 'a' && t[1] === addr)
  );
}
