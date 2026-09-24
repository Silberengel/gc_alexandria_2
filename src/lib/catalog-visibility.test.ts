import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { rememberDeletion } from './deletions';
import { filterRenderableCatalogEvents, isRenderableCatalogEvent } from './catalog-visibility';

function pub(overrides: Partial<Event> & { tags: string[][] }): Event {
  return {
    id: overrides.id ?? 'a'.repeat(64),
    pubkey: overrides.pubkey ?? 'b'.repeat(64),
    kind: overrides.kind ?? KIND.PUBLICATION,
    created_at: overrides.created_at ?? 1,
    content: overrides.content ?? '',
    sig: overrides.sig ?? 'c'.repeat(128),
    tags: overrides.tags
  };
}

describe('catalog-visibility', () => {
  it('accepts a titled publication with a d-tag', () => {
    const event = pub({
      tags: [
        ['d', 'jane-eyre'],
        ['title', 'Jane Eyre']
      ]
    });
    expect(isRenderableCatalogEvent(event)).toBe(true);
  });

  it('rejects empty d-tag even when a title exists', () => {
    const event = pub({
      tags: [
        ['d', ''],
        ['title', 'Ghost']
      ]
    });
    expect(isRenderableCatalogEvent(event)).toBe(false);
  });

  it('rejects events with no title, T, or d (Untitled)', () => {
    const event = pub({ tags: [] });
    expect(isRenderableCatalogEvent(event)).toBe(false);
  });

  it('rejects deleted events', () => {
    const target = pub({
      id: 'd'.repeat(64),
      pubkey: 'e'.repeat(64),
      tags: [
        ['d', 'gone'],
        ['title', 'Gone']
      ]
    });
    rememberDeletion(
      pub({
        id: 'f'.repeat(64),
        pubkey: 'e'.repeat(64),
        kind: KIND.DELETION,
        tags: [['e', target.id]]
      })
    );
    expect(isRenderableCatalogEvent(target)).toBe(false);
    expect(filterRenderableCatalogEvents([target])).toEqual([]);
  });

  it('accepts a humanizable d-tag without title', () => {
    const event = pub({ tags: [['d', 'pride-and-prejudice']] });
    expect(isRenderableCatalogEvent(event)).toBe(true);
  });
});
