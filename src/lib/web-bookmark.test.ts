import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { webBookmarkUrl, webBookmarkUrlFromCoordinate } from './web-bookmark';

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

  it('rebuilds a href from a 39701 coordinate when the event is missing', () => {
    const pk = 'd'.repeat(64);
    expect(
      webBookmarkUrlFromCoordinate(
        `39701:${pk}:www.sec.gov/Archives/edgar/data/2130357/filing.htm`
      )
    ).toBe('https://www.sec.gov/Archives/edgar/data/2130357/filing.htm');
    expect(webBookmarkUrlFromCoordinate(`30023:${pk}:essay`)).toBeNull();
  });
});
