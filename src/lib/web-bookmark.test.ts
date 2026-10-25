import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { webBookmarkUrl } from './web-bookmark';

function ev(partial: Partial<Event> & Pick<Event, 'kind' | 'tags'>): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1,
    content: '',
    sig: 'c'.repeat(128),
    ...partial
  };
}

describe('webBookmarkUrl', () => {
  it('prefers the r tag and restores https on d', () => {
    expect(
      webBookmarkUrl(
        ev({
          kind: KIND.WEB_BOOKMARK,
          tags: [
            ['d', 'youtu.be/mRQpZA8Bv-E'],
            ['r', 'https://youtu.be/mRQpZA8Bv-E']
          ]
        })
      )
    ).toBe('https://youtu.be/mRQpZA8Bv-E');

    expect(
      webBookmarkUrl(
        ev({
          kind: KIND.WEB_BOOKMARK,
          tags: [['d', 'youtu.be/mRQpZA8Bv-E']]
        })
      )
    ).toBe('https://youtu.be/mRQpZA8Bv-E');
  });

  it('ignores non-bookmark kinds', () => {
    expect(
      webBookmarkUrl(
        ev({
          kind: KIND.TEXT_NOTE,
          tags: [['r', 'https://youtu.be/mRQpZA8Bv-E']]
        })
      )
    ).toBeNull();
  });
});
