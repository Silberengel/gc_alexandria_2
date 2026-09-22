import { describe, expect, it } from 'vitest';
import { cardBlurb } from './card-blurb';

describe('cardBlurb', () => {
  it('strips asciidoc headings, image macros, and keeps readable text', () => {
    const content = [
      '= Sybil Test Utility',
      '== Description',
      'image::https://i.nostr.build/Jo7qwDu7rgYkMIWJ.png[Sybil gazing into a crystal ball, 200]',
      'This is a simple PHP CLI program that takes an edited document.'
    ].join('\n');
    expect(cardBlurb(content, { markup: 'asciidoc' })).toBe(
      'Sybil Test Utility Description Sybil gazing into a crystal ball, 200 This is a simple PHP CLI program that takes an edited document.'
    );
  });

  it('handles broken image::url"alt] macros without dumping the URL', () => {
    const content =
      '= Sybil Test Utility == Description image::https://i.nostr.build/Jo7qwDu7rgYkMIWJ.png"[Sybil gazing into a crystal ball, 200] This is a simple PHP CLI program';
    const out = cardBlurb(content, { markup: 'asciidoc' });
    expect(out).not.toMatch(/image::/);
    expect(out).not.toMatch(/https?:\/\//);
    expect(out).toContain('Sybil Test Utility');
    expect(out).toContain('This is a simple PHP CLI program');
  });

  it('strips markdown images and links', () => {
    expect(cardBlurb('![](https://example.com/a.jpg)Hello **world**')).toBe('Hello world');
  });

  it('replaces wikilinks and drops citations', () => {
    const content =
      'Madagascar is an **[[island country]]** that includes the [[Geography|island]]. [[citation::web::x]]';
    expect(cardBlurb(content, { markup: 'asciidoc' })).toBe(
      'Madagascar is an island country that includes the island.'
    );
  });

  it('respects max length', () => {
    expect(cardBlurb('one two three four', { max: 7 })).toBe('one two…');
  });
});
