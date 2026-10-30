import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import {
  CONTENT_WARNING_DEFAULT_LABEL,
  CONTENT_WARNING_TAG,
  appendContentWarningTag,
  buildContentWarningTag,
  contentWarningHeading,
  contentWarningLabel,
  isContentWarned,
  normalizeContentWarningLabel
} from './content-warning';

function ev(tags: string[][]): Pick<Event, 'tags'> {
  return { tags };
}

describe('contentWarningLabel', () => {
  it('reads the content-warning tag and defaults an empty value to NSFW', () => {
    expect(contentWarningLabel(ev([[CONTENT_WARNING_TAG, 'Spoilers']]))).toBe('Spoilers');
    expect(contentWarningLabel(ev([[CONTENT_WARNING_TAG]]))).toBe(CONTENT_WARNING_DEFAULT_LABEL);
    expect(contentWarningLabel(ev([['Content-Warning', 'Violence']]))).toBe('Violence');
  });

  it('treats a #nsfw hashtag as NSFW when no content-warning tag exists', () => {
    expect(contentWarningLabel(ev([['t', 'nsfw']]))).toBe(CONTENT_WARNING_DEFAULT_LABEL);
    expect(contentWarningLabel(ev([['t', 'books']]))).toBeNull();
    expect(isContentWarned(ev([['t', 'NSFW']]))).toBe(true);
  });
});

describe('appendContentWarningTag', () => {
  it('replaces prior content-warning rows when enabled', () => {
    expect(
      appendContentWarningTag(
        [
          ['title', 'Note'],
          [CONTENT_WARNING_TAG, 'old'],
          ['t', 'books']
        ],
        true,
        'Spoilers'
      )
    ).toEqual([
      ['title', 'Note'],
      ['t', 'books'],
      buildContentWarningTag('Spoilers')
    ]);
  });

  it('strips content-warning rows when disabled', () => {
    expect(
      appendContentWarningTag([[CONTENT_WARNING_TAG, 'NSFW'], ['t', 'x']], false, 'NSFW')
    ).toEqual([['t', 'x']]);
  });

  it('normalizes blank labels to NSFW and caps length', () => {
    expect(normalizeContentWarningLabel('  ')).toBe(CONTENT_WARNING_DEFAULT_LABEL);
    expect(normalizeContentWarningLabel('x'.repeat(100)).length).toBe(80);
  });
});

describe('contentWarningHeading', () => {
  it('special-cases NSFW', () => {
    expect(contentWarningHeading('NSFW')).toBe('🔞 NSFW 🔞');
    expect(contentWarningHeading('Spoilers')).toBe('Spoilers');
  });
});
