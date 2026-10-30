import { describe, expect, it, vi } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';

vi.mock('./nostr/mercury', () => ({
  mercuryPublicationExport: vi.fn(async () => [])
}));

vi.mock('./nostr/fetch', () => ({
  fetchByAddresses: vi.fn(async (addrs: string[]) =>
    addrs.map((coordinate) => {
      const [kindRaw, pubkey, ...dParts] = coordinate.split(':');
      return ev({
        kind: Number(kindRaw),
        pubkey: pubkey!,
        tags: [
          ['d', dParts.join(':')],
          ['title', dParts.join(':') || 'Section']
        ],
        content: `Body for ${dParts.join(':')}.`
      });
    })
  ),
  fetchByIds: vi.fn(async () => [])
}));

import { assemblePublicationDocument } from './publication-export';

const pk = 'a'.repeat(64);

function ev(over: Partial<Event> & { tags?: string[][] }): Event {
  return {
    id: (over.id ?? 'b'.repeat(64)).toLowerCase(),
    pubkey: (over.pubkey ?? pk).toLowerCase(),
    created_at: over.created_at ?? 1,
    kind: over.kind ?? KIND.PUBLICATION,
    tags: over.tags ?? [],
    content: over.content ?? '',
    sig: over.sig ?? 'c'.repeat(128)
  };
}

describe('assemblePublicationDocument', () => {
  it('walks section a-tags into one AsciiDoc book', async () => {
    const root = ev({
      id: '1'.repeat(64),
      tags: [
        ['d', 'my-book'],
        ['title', 'My Book'],
        ['a', `30041:${pk}:chapter-one`]
      ]
    });
    const assembled = await assemblePublicationDocument(root);
    expect(assembled.title).toBe('My Book');
    expect(assembled.content).toContain('= My Book');
    expect(assembled.content).toContain('== chapter-one');
    expect(assembled.content).toContain('Body for chapter-one.');
  });
});
