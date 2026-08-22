import { verifyEvent, type Event } from 'nostr-tools';
import { KIND } from '../constants';

export function ingestEvent(raw: unknown): Event | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Event;
  if (!e.id || !e.pubkey || !e.sig) return null;
  const normalized: Event = {
    ...e,
    id: e.id.toLowerCase(),
    pubkey: e.pubkey.toLowerCase(),
    content: e.kind === KIND.PUBLICATION ? '' : (e.content ?? '')
  };
  try {
    if (!verifyEvent(normalized)) return null;
  } catch {
    return null;
  }
  return normalized;
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
