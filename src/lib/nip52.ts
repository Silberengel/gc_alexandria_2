import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { firstTag } from './nostr/verify';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SECONDS_PER_DAY = 86_400;

export type CalendarEventInfo = {
  title: string;
  summary: string;
  whenLabel: string | null;
  locations: string[];
  image: string | null;
  topics: string[];
  /** True for kind 31922 (all-day / multi-day). */
  isAllDay: boolean;
  participants: { pubkey: string; role: string }[];
};

export function isCalendarEventKind(kind: number): boolean {
  return kind === KIND.CALENDAR_DATE || kind === KIND.CALENDAR_TIME;
}

function tagValues(event: Pick<Event, 'tags'>, name: string): string[] {
  return event.tags
    .filter((t) => (t[0] ?? '').toLowerCase() === name.toLowerCase())
    .map((t) => (t[1] ?? '').trim())
    .filter(Boolean);
}

function parseIsoDate(raw: string): { y: number; m: number; d: number } | null {
  const m = ISO_DATE.exec(raw.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return { y, m: mo, d };
}

function formatMediumDate(parts: { y: number; m: number; d: number }): string {
  const dt = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeZone: 'UTC'
  }).format(dt);
}

function addDays(parts: { y: number; m: number; d: number }, delta: number): {
  y: number;
  m: number;
  d: number;
} {
  const dt = new Date(Date.UTC(parts.y, parts.m - 1, parts.d + delta));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function sameDay(
  a: { y: number; m: number; d: number },
  b: { y: number; m: number; d: number }
): boolean {
  return a.y === b.y && a.m === b.m && a.d === b.d;
}

function dayOrdinal(parts: { y: number; m: number; d: number }): number {
  return Date.UTC(parts.y, parts.m - 1, parts.d);
}

/** Format NIP-52 date-based start/end (end exclusive). */
export function formatDateBasedWhen(event: Pick<Event, 'tags'>): string | null {
  const startRaw = firstTag(event as Event, 'start')?.trim();
  if (!startRaw) return null;
  const start = parseIsoDate(startRaw);
  if (!start) return startRaw;
  const endRaw = firstTag(event as Event, 'end')?.trim();
  const end = endRaw ? parseIsoDate(endRaw) : null;
  if (!end || sameDay(end, start) || sameDay(end, addDays(start, 1))) {
    return formatMediumDate(start);
  }
  // NIP-52 end is exclusive; show last inclusive day.
  const lastDay = addDays(end, -1);
  if (dayOrdinal(lastDay) <= dayOrdinal(start)) return formatMediumDate(start);
  return `${formatMediumDate(start)} – ${formatMediumDate(lastDay)}`;
}

function zoneId(raw: string | undefined | null): string {
  const id = (raw ?? '').trim();
  if (!id) {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }
  try {
    // Validate IANA id
    Intl.DateTimeFormat(undefined, { timeZone: id });
    return id;
  } catch {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }
}

function formatInZone(
  unixSec: number,
  zone: string,
  opts: Intl.DateTimeFormatOptions
): string {
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: zone }).format(
    new Date(unixSec * 1000)
  );
}

function localDateKey(unixSec: number, zone: string): string {
  return formatInZone(unixSec, zone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

/** Format NIP-52 time-based start/end with optional tzids. */
export function formatTimeBasedWhen(event: Pick<Event, 'tags'>): string | null {
  const startSec = Number.parseInt((firstTag(event as Event, 'start') ?? '').trim(), 10);
  if (!Number.isFinite(startSec)) return null;
  const endRaw = (firstTag(event as Event, 'end') ?? '').trim();
  const endSec = endRaw ? Number.parseInt(endRaw, 10) : NaN;
  const startZone = zoneId(firstTag(event as Event, 'start_tzid'));
  const endZone = zoneId(firstTag(event as Event, 'end_tzid') || startZone);
  const systemZone = zoneId(null);
  const zoneSuffix = startZone === systemZone ? '' : ` (${startZone})`;

  const dateTimeOpts: Intl.DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'short'
  };
  const dateOpts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' };
  const timeOpts: Intl.DateTimeFormatOptions = { timeStyle: 'short' };

  if (!Number.isFinite(endSec)) {
    return formatInZone(startSec, startZone, dateTimeOpts) + zoneSuffix;
  }

  if (localDateKey(startSec, startZone) === localDateKey(endSec, endZone) && startZone === endZone) {
    return (
      `${formatInZone(startSec, startZone, dateOpts)} · ${formatInZone(startSec, startZone, timeOpts)} – ${formatInZone(endSec, endZone, timeOpts)}` +
      zoneSuffix
    );
  }

  const endSuffix = startZone === endZone ? zoneSuffix : '';
  return `${formatInZone(startSec, startZone, dateTimeOpts)} – ${formatInZone(endSec, endZone, dateTimeOpts)}${endSuffix}`;
}

export function formatCalendarWhen(event: Pick<Event, 'kind' | 'tags'>): string | null {
  if (event.kind === KIND.CALENDAR_DATE) return formatDateBasedWhen(event);
  if (event.kind === KIND.CALENDAR_TIME) return formatTimeBasedWhen(event);
  return null;
}

export function parseCalendarEvent(
  event: Pick<Event, 'kind' | 'content' | 'tags' | 'pubkey'>
): CalendarEventInfo | null {
  if (!isCalendarEventKind(event.kind)) return null;
  const title =
    (firstTag(event as Event, 'title') ?? '').trim() ||
    (firstTag(event as Event, 'name') ?? '').trim() ||
    'Calendar event';
  const summaryTag = (firstTag(event as Event, 'summary') ?? '').trim();
  const content = (event.content ?? '').trim();
  // Prefer brief summary tag; otherwise a short content preview for cards.
  const summary =
    summaryTag ||
    (content.length > 280 ? `${content.slice(0, 280).trimEnd()}…` : content);
  const participants = event.tags
    .filter((t) => t[0] === 'p' && (t[1] ?? '').trim())
    .map((t) => ({
      pubkey: t[1]!.trim().toLowerCase(),
      role: (t[3] ?? '').trim()
    }));

  return {
    title,
    summary,
    whenLabel: formatCalendarWhen(event),
    locations: tagValues(event, 'location'),
    image: (firstTag(event as Event, 'image') ?? '').trim() || null,
    topics: tagValues(event, 't'),
    isAllDay: event.kind === KIND.CALENDAR_DATE,
    participants
  };
}

/**
 * NIP-52 `D` tags: day-granularity unix days covering the event timeframe.
 * `endSec` is exclusive when provided.
 */
export function calendarDayTags(startSec: number, endSec?: number | null): string[][] {
  if (!Number.isFinite(startSec) || startSec < 0) return [];
  const startDay = Math.floor(startSec / SECONDS_PER_DAY);
  let endDay = startDay;
  if (endSec != null && Number.isFinite(endSec) && endSec > startSec) {
    endDay = Math.floor((endSec - 1) / SECONDS_PER_DAY);
  }
  const tags: string[][] = [];
  for (let day = startDay; day <= endDay; day++) {
    tags.push(['D', String(day)]);
  }
  return tags;
}

/** Merge/replace `D` tags from start/end unix values on the wire tags. */
export function withCalendarDayTags(tags: string[][]): string[][] {
  const start = tags.find((t) => t[0] === 'start')?.[1]?.trim();
  const end = tags.find((t) => t[0] === 'end')?.[1]?.trim();
  const startSec = start ? Number.parseInt(start, 10) : NaN;
  if (!Number.isFinite(startSec)) return tags.filter((t) => t[0] !== 'D');
  const endSec = end ? Number.parseInt(end, 10) : null;
  const days = calendarDayTags(startSec, Number.isFinite(endSec as number) ? endSec : null);
  return [...tags.filter((t) => t[0] !== 'D'), ...days];
}

export function ensureCalendarIdentifier(tags: string[][]): string[][] {
  if (tags.some((t) => t[0] === 'd' && (t[1] ?? '').trim())) return tags;
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : `cal${Date.now().toString(36)}`;
  return [...tags, ['d', id]];
}
