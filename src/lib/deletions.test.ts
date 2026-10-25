import { describe, expect, it, beforeEach } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { get } from 'svelte/store';
import {
  deletionRevision,
  filterDeletedEvents,
  isEventDeleted,
  rememberDeletedTarget,
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

  it('bumps deletionRevision when a tombstone is recorded', () => {
    const before = get(deletionRevision);
    rememberDeletion(
      ev({
        id: 'c'.repeat(64),
        pubkey: 'b'.repeat(64),
        kind: KIND.DELETION,
        created_at: 200,
        tags: [['e', 'a'.repeat(64)]]
      })
    );
    expect(get(deletionRevision)).toBe(before + 1);
    rememberDeletion(
      ev({
        id: 'd'.repeat(64),
        pubkey: 'b'.repeat(64),
        kind: KIND.DELETION,
        created_at: 201,
        tags: [['e', 'a'.repeat(64)]]
      })
    );
    expect(get(deletionRevision)).toBe(before + 1);
  });

  it('rememberDeletedTarget hides the concrete event even when kind-5 only has an a-tag', () => {
    const pk = 'b'.repeat(64);
    const target = ev({
      id: 'a'.repeat(64),
      pubkey: pk,
      kind: 31990,
      created_at: 100,
      tags: [['d', 'lmwald']]
    });
    rememberDeletedTarget(
      target,
      ev({
        id: 'c'.repeat(64),
        pubkey: pk,
        kind: KIND.DELETION,
        created_at: 200,
        tags: [
          ['a', `31990:${pk}:other-d`],
          ['k', '31990']
        ]
      })
    );
    expect(isEventDeleted(target)).toBe(true);
  });
});
