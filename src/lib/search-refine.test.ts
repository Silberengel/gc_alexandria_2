import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import {
  dateInputToSince,
  dateInputToUntil,
  filterSearchEvents,
  sortSearchEvents,
  uniqueKinds,
  uniquePubkeys
} from './search-refine';

function ev(partial: Partial<Event> & Pick<Event, 'id' | 'kind' | 'pubkey'>): Event {
  return {
    created_at: partial.created_at ?? 1_700_000_000,
    content: partial.content ?? '',
    tags: partial.tags ?? [],
    sig: partial.sig ?? '0'.repeat(128),
    ...partial
  };
}

describe('search refine helpers', () => {
  const a = ev({
    id: 'a'.repeat(64),
    kind: 1,
    pubkey: '1'.repeat(64),
    created_at: 1_700_000_100,
    tags: [['title', 'Zebra']]
  });
  const b = ev({
    id: 'b'.repeat(64),
    kind: 30023,
    pubkey: '2'.repeat(64),
    created_at: 1_700_000_200,
    tags: [['title', 'Apple']]
  });
  const c = ev({
    id: 'c'.repeat(64),
    kind: 1,
    pubkey: '1'.repeat(64),
    created_at: 1_700_000_050,
    tags: [['title', 'Mango']]
  });

  it('lists unique kinds and pubkeys', () => {
    expect(uniqueKinds([a, b, c])).toEqual([1, 30023]);
    expect(uniquePubkeys([a, b, c])).toEqual(['1'.repeat(64), '2'.repeat(64)]);
  });

  it('filters by kind, pubkey, and created_at bounds', () => {
    expect(filterSearchEvents([a, b, c], { kind: 1 }).map((e) => e.id)).toEqual([a.id, c.id]);
    expect(filterSearchEvents([a, b, c], { pubkey: '2'.repeat(64) }).map((e) => e.id)).toEqual([
      b.id
    ]);
    expect(
      filterSearchEvents([a, b, c], { since: 1_700_000_080, until: 1_700_000_150 }).map((e) => e.id)
    ).toEqual([a.id]);
  });

  it('sorts newest, oldest, and by title without disturbing best order', () => {
    const input = [a, b, c];
    expect(sortSearchEvents(input, 'best').map((e) => e.id)).toEqual([a.id, b.id, c.id]);
    expect(sortSearchEvents(input, 'newest').map((e) => e.id)).toEqual([b.id, a.id, c.id]);
    expect(sortSearchEvents(input, 'oldest').map((e) => e.id)).toEqual([c.id, a.id, b.id]);
    expect(sortSearchEvents(input, 'title-asc').map((e) => e.id)[0]).toBe(b.id);
    expect(sortSearchEvents(input, 'title-desc').map((e) => e.id)[0]).toBe(a.id);
  });

  it('maps date inputs to local day bounds', () => {
    const since = dateInputToSince('2024-01-15');
    const until = dateInputToUntil('2024-01-15');
    expect(since).not.toBeNull();
    expect(until).not.toBeNull();
    expect(until!).toBeGreaterThan(since!);
    expect(dateInputToSince('nope')).toBeNull();
  });
});
