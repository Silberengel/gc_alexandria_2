import { describe, expect, it } from 'vitest';
import {
  formatIdentifierRows,
  identifierParts,
  identifierRowsFromRaw
} from './compose-publication-identifiers';
import { buildComposePartial } from './compose-build';

describe('compose-publication-identifiers', () => {
  it('splits and formats colon parts like event-tag rows', () => {
    expect(identifierParts('isbn:978123')).toEqual(['isbn', '978123']);
    expect(identifierParts('bare')).toEqual(['', 'bare']);
    expect(identifierRowsFromRaw('')).toEqual([['', '']]);
    expect(formatIdentifierRows([['isbn', '978'], ['doi', '10.1', 'x']])).toBe(
      'isbn:978\ndoi:10.1:x'
    );
  });

  it('emits i tags from multi-part identifier rows', () => {
    const partial = buildComposePartial({
      kind: 30040,
      content: '',
      values: {
        title: 'Guide',
        publication_author: 'Author',
        publication_type: 'book',
        publication_identifiers: formatIdentifierRows([
          ['isbn', '9781234567890'],
          ['gutenberg', '84']
        ])
      }
    });
    expect(partial.tags).toContainEqual(['i', 'isbn:9781234567890']);
    expect(partial.tags).toContainEqual(['i', 'gutenberg:84']);
  });
});
