/** Time windows for feed list filters / notification relay `since` (`null` = unlimited). */
export const NOTIFICATION_LOOKBACK_OPTIONS = [
  { id: '24h', label: '24 hours', seconds: 24 * 60 * 60 },
  { id: '48h', label: '48 hours', seconds: 48 * 60 * 60 },
  { id: '1w', label: '1 week', seconds: 7 * 24 * 60 * 60 },
  { id: '1m', label: '1 month', seconds: 30 * 24 * 60 * 60 },
  { id: '3m', label: '3 months', seconds: 90 * 24 * 60 * 60 },
  { id: 'all', label: 'unlimited', seconds: null }
] as const;

export type NotificationLookbackId = (typeof NOTIFICATION_LOOKBACK_OPTIONS)[number]['id'];

export const DEFAULT_NOTIFICATION_LOOKBACK: NotificationLookbackId = '24h';

/** Unix `since` for a lookback window, or `null` when unlimited. */
export function feedSinceFromLookback(
  lookbackSeconds: number | null | undefined
): number | null {
  if (lookbackSeconds == null) return null;
  return Math.floor(Date.now() / 1000) - lookbackSeconds;
}

/** True when `next` covers a wider time window than `prev` (needs a fresh relay query). */
export function feedLookbackIsWider(
  next: NotificationLookbackId,
  prev: NotificationLookbackId | null | undefined
): boolean {
  if (prev == null) return true;
  const n = notificationLookbackSeconds(next);
  const p = notificationLookbackSeconds(prev);
  if (n == null) return p != null;
  if (p == null) return false;
  return n > p;
}

const NOTIFICATION_LOOKBACK_IDS = new Set<string>(
  NOTIFICATION_LOOKBACK_OPTIONS.map((o) => o.id)
);

export function isNotificationLookbackId(raw: string): raw is NotificationLookbackId {
  return NOTIFICATION_LOOKBACK_IDS.has(raw);
}

export function parseNotificationLookback(
  raw: string | null | undefined
): NotificationLookbackId {
  const t = (raw ?? '').trim();
  return isNotificationLookbackId(t) ? t : DEFAULT_NOTIFICATION_LOOKBACK;
}

/** Seconds for {@link DEFAULT_NOTIFICATION_LOOKBACK} (always a finite window). */
const DEFAULT_NOTIFICATION_LOOKBACK_SECONDS = NOTIFICATION_LOOKBACK_OPTIONS.find(
  (o) => o.id === DEFAULT_NOTIFICATION_LOOKBACK
)!.seconds!;

export function notificationLookbackSeconds(
  id: NotificationLookbackId = DEFAULT_NOTIFICATION_LOOKBACK
): number | null {
  const opt = NOTIFICATION_LOOKBACK_OPTIONS.find((o) => o.id === id);
  // Unknown ids (e.g. stale storage casts) follow the documented default, not a
  // hard-coded month that is not DEFAULT_NOTIFICATION_LOOKBACK.
  return opt ? opt.seconds : DEFAULT_NOTIFICATION_LOOKBACK_SECONDS;
}
