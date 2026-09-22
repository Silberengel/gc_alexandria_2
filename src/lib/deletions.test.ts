import { describe, expect, it, beforeEach } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  filterDeletedEvents,
  isEventDeleted,
  rememberDeletion,
  resetDeletionStateForTests
} from './deletions';

function ev(partial: Partial<Event> & Pick<Event, 'id' | 'pubkey' | 'kind' | 'created_at'>): Event {
  return {
    content: '',
    sig: '00',
    tags: [],
    ...partial
  };
}

describe('deletions', () => {
  beforeEach(() => {
    resetDeletionStateForTests();
  });

  it('hides events referenced by a same-pubkey e-tag deletion', () => {
    const target = ev({
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      kind: KIND.PUBLICATION,
      created_at: 100,
      tags: [['d', 'jane']]
    });
    rememberDeletion(
      ev({
        id: 'c'.repeat(64),
        pubkey: 'b'.repeat(64),
        kind: KIND.DELETION,
        created_at: 200,
        tags: [
          ['e', target.id],
          ['k', '30040']
        ]
      })
    );
    expect(isEventDeleted(target)).toBe(true);
    expect(filterDeletedEvents([target])).toEqual([]);
  });

  it('ignores e-tag deletions from a different pubkey', () => {
    const target = ev({
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      kind: KIND.PUBLICATION,
      created_at: 100,
      tags: [['d', 'jane']]
    });
    rememberDeletion(
      ev({
        id: 'c'.repeat(64),
        pubkey: 'd'.repeat(64),
        kind: KIND.DELETION,
        created_at: 200,
        tags: [
          ['e', target.id, '', 'd'.repeat(64)],
          ['k', '30040']
        ]
      })
    );
    expect(isEventDeleted(target)).toBe(false);
  });

  it('hides addressable events up to an a-tag deletion created_at', () => {
    const pk = 'b'.repeat(64);
    const older = ev({
      id: 'a'.repeat(64),
      pubkey: pk,
      kind: KIND.PUBLICATION,
      created_at: 100,
      tags: [['d', 'jane-eyre-an-autobiography']]
    });
    const newer = ev({
      id: 'e'.repeat(64),
      pubkey: pk,
      kind: KIND.PUBLICATION,
      created_at: 300,
      tags: [['d', 'jane-eyre-an-autobiography']]
    });
    rememberDeletion(
      ev({
        id: 'c'.repeat(64),
        pubkey: pk,
        kind: KIND.DELETION,
        created_at: 200,
        tags: [
          ['a', `30040:${pk}:jane-eyre-an-autobiography`],
          ['k', '30040']
        ]
      })
    );
    expect(isEventDeleted(older)).toBe(true);
    expect(isEventDeleted(newer)).toBe(false);
  });
});
