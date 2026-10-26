import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { highlightSourceLabelFallback, highlightSourceRef } from './highlight-source';

function highlight(tags: string[][]): Event {
  return {
    id: '1'.repeat(64),
    pubkey: '2'.repeat(64),
    created_at: 1,
    kind: KIND.HIGHLIGHT,
    tags,
    content: 'quoted text',
    sig: 'sig'
  };
}

describe('highlightSourceRef', () => {
  it('prefers an r tag marked source over other HTTP r tags', () => {
    const ref = highlightSourceRef(
      highlight([
        ['r', 'https://other.example', 'mention'],
        ['r', 'https://source.example/article', 'source']
      ])
    );
    expect(ref).toEqual({ type: 'http', url: 'https://source.example/article' });
  });

  it('falls back to the url tag', () => {
    const ref = highlightSourceRef(highlight([['url', 'https://page.example/x']]));
    expect(ref).toEqual({ type: 'http', url: 'https://page.example/x' });
  });

  it('uses the first e tag when there is no HTTP source', () => {
    const eventId = 'a'.repeat(64);
    const ref = highlightSourceRef(
      highlight([['e', eventId, 'wss://relay.example']])
    );
    expect(ref).toEqual({
      type: 'event',
      eventId,
      relayHints: ['wss://relay.example']
    });
  });

  it('uses the first a tag when there is no HTTP or e source', () => {
    const coordinate = `30023:${'b'.repeat(64)}:my-article`;
    const ref = highlightSourceRef(
      highlight([['a', coordinate, 'wss://relay.example']])
    );
    expect(ref).toEqual({
      type: 'replaceable',
      coordinate,
      relayHints: ['wss://relay.example']
    });
  });

  it('prefers HTTP over e and a', () => {
    const ref = highlightSourceRef(
      highlight([
        ['e', 'c'.repeat(64)],
        ['a', `30023:${'d'.repeat(64)}:ch`],
        ['r', 'https://book.example/ch1', 'source']
      ])
    );
    expect(ref).toEqual({ type: 'http', url: 'https://book.example/ch1' });
  });
});

describe('highlightSourceLabelFallback', () => {
  it('labels non-HTTP r tags when no structured source resolves', () => {
    expect(highlightSourceLabelFallback(highlight([['r', 'nostr:note1example']]))).toBe(
      'Source: nostr:note1example'
    );
  });

  it('is null when a structured source exists', () => {
    expect(
      highlightSourceLabelFallback(highlight([['r', 'https://example.com', 'source']]))
    ).toBeNull();
  });
});
