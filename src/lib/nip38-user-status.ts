import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { firstTag } from './nostr/verify';

/** NIP-38 status types defined by the spec (kind 30315). */
export const NIP38_USER_STATUS_TYPES = ['general', 'music'] as const;

export type Nip38UserStatusType = (typeof NIP38_USER_STATUS_TYPES)[number];

export type UserStatus = {
  type: Nip38UserStatusType;
  content: string;
  linkHref?: string;
  expiration?: number;
  createdAt: number;
  event: Event;
};

function isStatusType(d: string): d is Nip38UserStatusType {
  return (NIP38_USER_STATUS_TYPES as readonly string[]).includes(d);
}

export function isUserStatusExpired(event: Event, nowUnix = Math.floor(Date.now() / 1000)): boolean {
  const raw = firstTag(event, 'expiration');
  if (!raw) return false;
  const exp = Number(raw);
  if (!Number.isFinite(exp) || exp <= 0) return false;
  return nowUnix > exp;
}

export function userStatusLinkHref(event: Event): string | undefined {
  const r = firstTag(event, 'r')?.trim();
  if (r && /^https?:\/\//i.test(r)) return r;
  return undefined;
}

export function parseUserStatusEvent(event: Event): UserStatus | null {
  if (event.kind !== KIND.STATUS) return null;
  const type = firstTag(event, 'd') ?? '';
  if (!isStatusType(type)) return null;
  const content = (event.content ?? '').trim();
  if (!content) return null;
  if (isUserStatusExpired(event)) return null;

  const expRaw = firstTag(event, 'expiration');
  const expiration = expRaw ? Number(expRaw) : undefined;

  return {
    type,
    content,
    linkHref: userStatusLinkHref(event),
    expiration: expiration && Number.isFinite(expiration) && expiration > 0 ? expiration : undefined,
    createdAt: event.created_at,
    event
  };
}

/**
 * Pick the newest unexpired general and music statuses (replaceable by `d`).
 */
export function selectUserStatuses(events: Event[]): {
  general: UserStatus | null;
  music: UserStatus | null;
} {
  const best = new Map<Nip38UserStatusType, Event>();
  for (const event of events) {
    if (event.kind !== KIND.STATUS) continue;
    const d = firstTag(event, 'd') ?? '';
    if (!isStatusType(d)) continue;
    if (isUserStatusExpired(event)) continue;
    if (!(event.content ?? '').trim()) continue;
    const prev = best.get(d);
    if (!prev || event.created_at >= prev.created_at) best.set(d, event);
  }
  return {
    general: best.has('general') ? parseUserStatusEvent(best.get('general')!) : null,
    music: best.has('music') ? parseUserStatusEvent(best.get('music')!) : null
  };
}
