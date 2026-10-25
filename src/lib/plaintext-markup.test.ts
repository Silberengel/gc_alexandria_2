import { describe, expect, it } from 'vitest';
import { prepareLine, prepareLines, tokenizeInline } from './plaintext-markup';

describe('plaintext-markup', () => {
  it('classifies greentext and quotes', () => {
    expect(prepareLine('>greentext')).toEqual({
      kind: 'greentext',
      prefix: '>',
      body: 'greentext'
    });
    expect(prepareLine('> quoted')).toEqual({
      kind: 'quote',
      prefix: '',
      body: 'quoted'
    });
    // Bare `>` (trailing space stripped) is an empty quote, not a lone chevron.
    expect(prepareLine('>')).toEqual({ kind: 'quote', prefix: '', body: '' });
    expect(prepareLine('> ')).toEqual({ kind: 'quote', prefix: '', body: '' });
  });

  it('normalizes list markers', () => {
    expect(prepareLine('- item').prefix).toBe('• ');
    expect(prepareLine('2. item')).toEqual({
      kind: 'normal',
      prefix: '2. ',
      body: 'item'
    });
  });

  it('tokenizes single-marker emphasis', () => {
    expect(tokenizeInline('say *bold* and _italic_')).toEqual([
      { type: 'text', value: 'say ' },
      { type: 'bold', value: 'bold' },
      { type: 'text', value: ' and ' },
      { type: 'italic', value: 'italic' }
    ]);
  });

  it('splits lines', () => {
    expect(prepareLines('a\nb').map((l) => l.body)).toEqual(['a', 'b']);
  });
});
