import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  highlightFocusQuote,
  highlightFocusSectionAddress,
  highlightReaderLocation
} from './highlight-open';
import { KIND } from './constants';

const pk = '3e1ad0f3a5d3c12245db7788546c43ade3d97c6e046c594f6017cd6cd4164690';
const root = `30040:${pk}:biblestr-plan-chronological`;
const chapter = `30040:${pk}:biblestr-plan-chronological-day-003-r1`;
const sectionAddr = `30041:${pk}:genesis-6`;
const eventId = 'e901195054e6e38c2e29380da32b62f2500de6bc4a215ff74bf57eb495a84977';

function hl(tags: string[][], content = 'The sons of God…'): {
  kind: number;
  id: string;
  pubkey: string;
  created_at: number;
  content: string;
  tags: string[][];
  sig: string;
} {
  return {
    kind: KIND.HIGHLIGHT,
    id: 'f'.repeat(64),
    pubkey: 'd'.repeat(64),
    created_at: 1,
    content,
    tags,
    sig: '0'.repeat(128)
  };
}

describe('highlightFocusSectionAddress', () => {
  it('prefers kind-30041 a-tags', () => {
    expect(
      highlightFocusSectionAddress(
        hl([
          ['A', root],
          ['a', sectionAddr]
        ])
      )
    ).toBe(sectionAddr);
  });

  it('uses nested 30040 a when it differs from root A', () => {
    expect(
      highlightFocusSectionAddress(
        hl([
          ['A', root],
          ['a', chapter],
          ['e', eventId]
        ])
      )
    ).toBe(chapter);
  });

  it('falls back to e when only the root library address is tagged', () => {
    expect(
      highlightFocusSectionAddress(
        hl([
          ['A', root],
          ['a', root],
          ['e', eventId]
        ])
      )
    ).toBe(eventId);
  });
});

describe('highlightReaderLocation', () => {
  it('opens the edition reader on the nested section with content as quote', () => {
    const quote =
      'The sons of God... The descendants of Seth and Enos are here called sons of God from their religion and piety.';
    const href = highlightReaderLocation(
      hl(
        [
          ['A', root],
          ['K', '30040'],
          ['a', chapter],
          ['k', '30040'],
          ['e', eventId]
        ],
        quote
      )
    );
    expect(href).toBeTruthy();
    const q = href!.indexOf('?');
    expect(href!.slice(0, q)).toBe(
      `/publication/d/biblestr-plan-chronological/p/${nip19.npubEncode(pk)}`
    );
    const params = new URLSearchParams(href!.slice(q + 1));
    expect(params.get('read')).toBe('1');
    expect(params.get('section')).toBe(chapter);
    expect(params.get('quote')).toBe(highlightFocusQuote({ content: quote }));
  });

  it('uses content as the quote even when a context tag is present', () => {
    const href = highlightReaderLocation(
      hl(
        [
          ['A', root],
          ['a', chapter],
          ['context', 'Longer surrounding passage that is not the quote.']
        ],
        '  short quote  '
      )
    );
    const params = new URLSearchParams(href!.split('?')[1]);
    expect(params.get('quote')).toBe('short quote');
  });
});
