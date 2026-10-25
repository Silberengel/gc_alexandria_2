import { nip19 } from 'nostr-tools';
import { describe, expect, it } from 'vitest';
import {
  buildTagsForKind,
  sectionDTagFromRow,
  sectionPointerTags
} from '@silberengel/kind-compose-catalog';
import {
  formatSectionRows,
  moveSectionRow,
  sectionAddressCoord,
  sectionRowsFromRaw
} from './compose-publication-sections';

const pk = 'a'.repeat(64);

describe('compose-publication-sections', () => {
  it('keeps multi-row editor placeholders', () => {
    expect(sectionRowsFromRaw('')).toEqual(['']);
    expect(formatSectionRows(['a', '', 'b'])).toBe('a\n\nb');
  });

  it('moves rows up and down', () => {
    expect(moveSectionRow(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveSectionRow(['a', 'b'], 0, 1)).toEqual(['b', 'a']);
  });

  it('reads d-tag from naddr and bare coordinates', () => {
    const naddr = nip19.naddrEncode({
      kind: 30041,
      pubkey: pk,
      identifier: 'ch-1'
    });
    expect(sectionDTagFromRow(naddr)).toBe('ch-1');
    expect(sectionDTagFromRow(`30041:${pk}:ch-1`)).toBe('ch-1');
    expect(sectionAddressCoord(naddr)).toBe(`30041:${pk}:ch-1`);
    expect(sectionDTagFromRow('b'.repeat(64))).toBeNull();
  });

  it('emits a-tags for naddr and e-tags for hex in order', () => {
    const naddr = nip19.naddrEncode({
      kind: 30041,
      pubkey: pk,
      identifier: 'ch-1'
    });
    const hex = 'c'.repeat(64);
    expect(sectionPointerTags(`${naddr}\n${hex}`)).toEqual([
      ['a', `30041:${pk}:ch-1`],
      ['e', hex]
    ]);

    const tags = buildTagsForKind(
      30040,
      {
        title: 'Guide',
        publication_author: 'Author',
        publication_type: 'book',
        sections: naddr
      },
      { app: 'alexandria' }
    );
    expect(tags).toContainEqual(['a', `30041:${pk}:ch-1`]);
    expect(tags.some((t) => t[0] === 'e')).toBe(false);
  });
});
