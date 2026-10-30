import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  calendarDayTags,
  formatDateBasedWhen,
  formatTimeBasedWhen,
  parseCalendarEvent,
  withCalendarDayTags
} from './nip52';

function ev(partial: Partial<Event> & Pick<Event, 'kind' | 'pubkey'>): Event {
  return {
    id: (partial.id ?? 'a'.repeat(64)).slice(0, 64),
    created_at: partial.created_at ?? 1_700_000_000,
    content: partial.content ?? '',
    tags: partial.tags ?? [],
    sig: 'c'.repeat(128),
    ...partial
  };
}

describe('date-based calendar when', () => {
  it('formats a single day and exclusive multi-day ranges', () => {
    const one = formatDateBasedWhen(
      ev({
        kind: KIND.CALENDAR_DATE,
        pubkey: 'f'.repeat(64),
        tags: [
          ['d', 'anniv'],
          ['title', 'Anniversary'],
          ['start', '2026-10-30']
        ]
      })
    );
    expect(one).toMatch(/2026/);

    const multi = formatDateBasedWhen(
      ev({
        kind: KIND.CALENDAR_DATE,
        pubkey: 'f'.repeat(64),
        tags: [
          ['start', '2026-10-30'],
          ['end', '2026-11-02']
        ]
      })
    );
    // end exclusive → last inclusive day is Nov 1
    expect(multi).toMatch(/–/);
  });
});

describe('time-based calendar when + D tags', () => {
  it('emits day tags covering the timeframe', () => {
    const start = 1_700_000_000;
    const end = start + 86_400 * 2 + 3600;
    const days = calendarDayTags(start, end);
    expect(days[0]?.[0]).toBe('D');
    expect(days.length).toBeGreaterThanOrEqual(2);

    const tags = withCalendarDayTags([
      ['d', 'meetup'],
      ['title', 'Meetup'],
      ['start', String(start)],
      ['end', String(end)],
      ['D', 'stale']
    ]);
    expect(tags.filter((t) => t[0] === 'D').every((t) => t[1] !== 'stale')).toBe(true);
    expect(tags.some((t) => t[0] === 'D')).toBe(true);
  });

  it('formats a timed event label', () => {
    const label = formatTimeBasedWhen(
      ev({
        kind: KIND.CALENDAR_TIME,
        pubkey: 'f'.repeat(64),
        tags: [
          ['start', '1700000000'],
          ['end', '1700003600'],
          ['start_tzid', 'UTC']
        ]
      })
    );
    expect(label).toBeTruthy();
  });
});

describe('parseCalendarEvent', () => {
  it('parses title, locations, and all-day flag', () => {
    const info = parseCalendarEvent(
      ev({
        kind: KIND.CALENDAR_DATE,
        pubkey: 'f'.repeat(64),
        content: 'Bring cake',
        tags: [
          ['d', 'party'],
          ['title', 'Birthday'],
          ['start', '2026-10-30'],
          ['location', 'Park'],
          ['t', 'friends']
        ]
      })
    );
    expect(info?.title).toBe('Birthday');
    expect(info?.isAllDay).toBe(true);
    expect(info?.locations).toEqual(['Park']);
    expect(info?.topics).toEqual(['friends']);
    expect(info?.summary).toBe('Bring cake');
  });
});
