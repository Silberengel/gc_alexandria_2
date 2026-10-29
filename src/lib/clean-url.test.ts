import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  cleanTrackingUrl,
  normalizeNostrBech32InText,
  scrubProseText,
  scrubTrackingInEventPartial,
  scrubTrackingUrlsInText,
  tidyPastedUrl
} from './clean-url';

const SAMPLE_NPUB = nip19.npubEncode('aa'.repeat(32));
const SAMPLE_NOTE = nip19.noteEncode('bb'.repeat(32));

describe('cleanTrackingUrl', () => {
  it('strips utm and click-id trackers while keeping useful params', () => {
    expect(
      cleanTrackingUrl(
        'https://cdn.example/pic.jpg?w=800&utm_source=twitter&utm_medium=social&fbclid=abc#frag'
      )
    ).toBe('https://cdn.example/pic.jpg?w=800');
  });

  it('rejects credentials and non-http schemes', () => {
    expect(cleanTrackingUrl('https://user:pass@cdn.example/a.png')).toBeNull();
    expect(cleanTrackingUrl('javascript:alert(1)')).toBeNull();
    expect(cleanTrackingUrl('not a url')).toBeNull();
  });

  it('tidies trailing punctuation from pasted links', () => {
    expect(tidyPastedUrl('https://example.com/a.png).')).toBe('https://example.com/a.png');
    expect(cleanTrackingUrl('https://example.com/a.png?utm_campaign=x).')).toBe(
      'https://example.com/a.png'
    );
  });
});

describe('scrubTrackingUrlsInText', () => {
  it('scrubs every bare URL in a paste blob', () => {
    const text =
      'see https://a.example/x?utm_source=mail and https://b.example/y?fbclid=1&keep=1';
    expect(scrubTrackingUrlsInText(text)).toBe(
      'see https://a.example/x and https://b.example/y?keep=1'
    );
  });
});

describe('normalizeNostrBech32InText', () => {
  it('prefaces bare bech32 and collapses stacked nostr: prefixes', () => {
    expect(normalizeNostrBech32InText(`see ${SAMPLE_NPUB}`)).toBe(`see nostr:${SAMPLE_NPUB}`);
    expect(normalizeNostrBech32InText(`nostr:${SAMPLE_NOTE}`)).toBe(`nostr:${SAMPLE_NOTE}`);
    expect(normalizeNostrBech32InText(`nostr:nostr:nostr:${SAMPLE_NPUB}`)).toBe(
      `nostr:${SAMPLE_NPUB}`
    );
    expect(normalizeNostrBech32InText(SAMPLE_NPUB, 'bare')).toBe(SAMPLE_NPUB);
    expect(normalizeNostrBech32InText(`nostr:nostr:${SAMPLE_NPUB}`, 'bare')).toBe(SAMPLE_NPUB);
  });

  it('leaves njump-style path bech32 and invalid tokens alone', () => {
    expect(normalizeNostrBech32InText(`https://njump.me/${SAMPLE_NPUB}`)).toBe(
      `https://njump.me/${SAMPLE_NPUB}`
    );
    expect(normalizeNostrBech32InText('npub1notvalid')).toBe('npub1notvalid');
  });
});

describe('scrubProseText', () => {
  it('scrubs trackers and normalizes bech32 together', () => {
    expect(
      scrubProseText(`hi ${SAMPLE_NPUB} https://a.example/x?utm_source=mail`)
    ).toBe(`hi nostr:${SAMPLE_NPUB} https://a.example/x`);
  });
});

describe('scrubTrackingInEventPartial', () => {
  it('scrubs content and http(s) tag cells', () => {
    const scrubbed = scrubTrackingInEventPartial({
      kind: 1,
      content: `hi ${SAMPLE_NPUB} https://a.example/x?utm_source=x`,
      tags: [
        ['r', 'https://b.example/y?fbclid=1&keep=1'],
        ['p', 'aabb'],
        ['imeta', 'url https://c.example/z?utm_medium=social']
      ]
    });
    expect(scrubbed.content).toBe(`hi nostr:${SAMPLE_NPUB} https://a.example/x`);
    expect(scrubbed.tags[0]).toEqual(['r', 'https://b.example/y?keep=1']);
    expect(scrubbed.tags[1]).toEqual(['p', 'aabb']);
    expect(scrubbed.tags[2]).toEqual(['imeta', 'url https://c.example/z']);
  });
});
