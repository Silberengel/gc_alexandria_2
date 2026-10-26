import { describe, expect, it } from 'vitest';
import {
  defaultPreferredTranslateCode,
  translateApiCode,
  translationParts
} from './libre-translate';

describe('translationParts', () => {
  it('returns null for whitespace-only', () => {
    expect(translationParts('')).toBeNull();
    expect(translationParts('   ')).toBeNull();
    expect(translationParts('\n\t  ')).toBeNull();
  });

  it('preserves edge whitespace', () => {
    expect(translationParts('  hello  ')).toEqual(['  ', 'hello', '  ']);
  });
});

describe('translateApiCode', () => {
  it('collapses regional English to en', () => {
    expect(translateApiCode('en-US')).toBe('en');
    expect(translateApiCode('en_GB')).toBe('en');
  });

  it('normalizes aliases', () => {
    expect(translateApiCode('ger')).toBe('de');
    expect(translateApiCode('sp')).toBe('es');
  });
});

describe('defaultPreferredTranslateCode', () => {
  it('is English', () => {
    expect(defaultPreferredTranslateCode()).toBe('en');
  });
});
