import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { parseUserStatusEvent, selectUserStatuses } from './nip38-user-status';

function status(
  partial: Partial<Event> & { content: string; tags: string[][] }
): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_700_000_000,
    kind: KIND.STATUS,
    sig: 'c'.repeat(128),
    ...partial
  };
}

describe('nip38-user-status', () => {
  it('parses general status with https r-link', () => {
    const ev = status({
      content: 'Reading Jane Eyre',
      tags: [
        ['d', 'general'],
        ['r', 'https://example.com/book']
      ]
    });
    const parsed = parseUserStatusEvent(ev);
    expect(parsed?.type).toBe('general');
    expect(parsed?.content).toBe('Reading Jane Eyre');
    expect(parsed?.linkHref).toBe('https://example.com/book');
  });

  it('drops expired and empty content', () => {
    const expired = status({
      content: 'gone',
      tags: [
        ['d', 'general'],
        ['expiration', '100']
      ]
    });
    const empty = status({ content: '  ', tags: [['d', 'music']] });
    expect(parseUserStatusEvent(expired)).toBeNull();
    expect(parseUserStatusEvent(empty)).toBeNull();
  });

  it('selects newest general and music independently', () => {
    const olderGeneral = status({
      id: '1'.repeat(64),
      created_at: 10,
      content: 'old',
      tags: [['d', 'general']]
    });
    const newerGeneral = status({
      id: '2'.repeat(64),
      created_at: 20,
      content: 'new',
      tags: [['d', 'general']]
    });
    const music = status({
      id: '3'.repeat(64),
      created_at: 15,
      content: 'Song',
      tags: [['d', 'music']]
    });
    const { general, music: m } = selectUserStatuses([olderGeneral, music, newerGeneral]);
    expect(general?.content).toBe('new');
    expect(m?.content).toBe('Song');
  });
});
