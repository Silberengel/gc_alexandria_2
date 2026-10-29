import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  cleanTrackingUrl,
  normalizeNostrBech32InText,
  scrubProseText,
  scrubTrackingInEventPartial,
  scrubTrackingUrlsInText,
  splitTrackedUrl,
  tidyPastedUrl
} from './clean-url';

const SAMPLE_NPUB = nip19.npubEncode('aa'.repeat(32));
const SAMPLE_NOTE = nip19.noteEncode('bb'.repeat(32));

describe('cleanTrackingUrl', () => {
  it('strips utm and click-id trackers while keeping useful params and the hash', () => {
    expect(
      cleanTrackingUrl(
        'https://cdn.example/pic.jpg?w=800&utm_source=twitter&utm_medium=social&fbclid=abc#frag'
      )
    ).toBe('https://cdn.example/pic.jpg?w=800#frag');
  });

  it('preserves Alexandria SPA deep-link hashes (read/section/quote are not trackers)', () => {
    const deep =
      'https://gc-alexandria.imwald.eu/#/spec/d/nip-84/p/npub1abc?read=1&section=deadbeef&quote=Hello';
    expect(cleanTrackingUrl(deep)).toBe(deep);
  });

  it('still strips real trackers that sit inside a hash query (no host allowlist)', () => {
    expect(
      cleanTrackingUrl('https://gc-alexandria.imwald.eu/#/spec/d/nip-84?utm_source=mail&read=1')
    ).toBe('https://gc-alexandria.imwald.eu/#/spec/d/nip-84?read=1');
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

describe('splitTrackedUrl', () => {
  it('splits YouTube ?si= into a safe href and plaintext tail', () => {
    const split = splitTrackedUrl(
      'https://www.youtube.com/live/Pr80H5oZdr8?si=lBisTLqlZ4jewk2b'
    );
    expect(split).toEqual({
      original: 'https://www.youtube.com/live/Pr80H5oZdr8?si=lBisTLqlZ4jewk2b',
      safeHref: 'https://www.youtube.com/live/Pr80H5oZdr8',
      safeText: 'https://www.youtube.com/live/Pr80H5oZdr8',
      unsafeText: '?si=lBisTLqlZ4jewk2b',
      trackerNames: ['si']
    });
  });

  it('keeps functional params linked and appends trackers with &', () => {
    const split = splitTrackedUrl(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=43&si=AbCdEf12345'
    );
    expect(split?.safeHref).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=43');
    expect(split?.unsafeText).toBe('&si=AbCdEf12345');
    expect(split?.trackerNames).toEqual(['si']);
  });

  it('does not treat Alexandria reader deep-link params as share trackers', () => {
    const deep =
      'https://gc-alexandria.imwald.eu/#/spec/d/nip-84/p/npub1abc?read=1&section=deadbeef&quote=Quote+Highlights';
    const split = splitTrackedUrl(deep);
    expect(split?.trackerNames).toEqual([]);
    expect(split?.unsafeText).toBe('');
    expect(split?.safeHref).toBe(deep);
  });

  it('flags trackers inside hash queries on any host, including our own', () => {
    const split = splitTrackedUrl(
      'https://gc-alexandria.imwald.eu/#/feed?tab=follows&utm_source=share&si=abc'
    );
    expect(split?.trackerNames).toEqual(['utm_source', 'si']);
    expect(split?.safeHref).toBe('https://gc-alexandria.imwald.eu/#/feed?tab=follows');
    expect(split?.unsafeText).toBe('&utm_source=share&si=abc');
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
  it('normalizes bech32 but leaves tracking params visible for the author', () => {
    expect(
      scrubProseText(`hi ${SAMPLE_NPUB} https://a.example/x?utm_source=mail`)
    ).toBe(`hi nostr:${SAMPLE_NPUB} https://a.example/x?utm_source=mail`);
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
