/** Format a Nostr `created_at` (unix seconds) as a short relative time. */
export function formatRelativeTime(
  createdAtSec: number,
  nowMs: number = Date.now(),
  locale?: string
): string {
  if (!Number.isFinite(createdAtSec) || createdAtSec <= 0) return '';
  const diffSec = Math.round(nowMs / 1000 - createdAtSec);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const abs = Math.abs(diffSec);
  if (abs < 45) return rtf.format(-diffSec, 'second');
  const mins = Math.round(diffSec / 60);
  if (Math.abs(mins) < 60) return rtf.format(-mins, 'minute');
  const hours = Math.round(diffSec / 3600);
  if (Math.abs(hours) < 24) return rtf.format(-hours, 'hour');
  const days = Math.round(diffSec / 86400);
  if (Math.abs(days) < 7) return rtf.format(-days, 'day');
  const weeks = Math.round(diffSec / 604800);
  if (Math.abs(weeks) < 5) return rtf.format(-weeks, 'week');
  const months = Math.round(diffSec / 2629800);
  if (Math.abs(months) < 12) return rtf.format(-months, 'month');
  const years = Math.round(diffSec / 31557600);
  return rtf.format(-years, 'year');
}

/** Absolute local datetime for tooltips / accessibility. */
export function formatAbsoluteTime(createdAtSec: number): string {
  if (!Number.isFinite(createdAtSec) || createdAtSec <= 0) return '';
  try {
    return new Date(createdAtSec * 1000).toLocaleString();
  } catch {
    return '';
  }
}
