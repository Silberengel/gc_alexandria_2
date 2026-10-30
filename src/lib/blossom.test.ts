import { describe, expect, it } from 'vitest';
import {
  BLOSSOM_PRESET_SERVERS,
  blossomBlobCandidates,
  blossomMediaType,
  blossomServersFromTags,
  findBlossomUris,
  formatBlossomUri,
  mergeBlossomServers,
  normalizeBlossomServer,
  parseBlossomUri,
} from './blossom';
import { omitMediaUrls, uniqueMedia } from './media';
import type { Event } from 'nostr-tools';

describe('mergeBlossomServers', () => {
  it('orders user servers before presets and dedupes', () => {
    const user = ['https://mine.example/', 'https://blossom.band'];
    const merged = mergeBlossomServers(user);
    expect(merged[0]).toBe('https://mine.example');
    expect(merged[1]).toBe('https://blossom.band');
    expect(merged.filter((s) => s === 'https://blossom.band')).toHaveLength(1);
    for (const preset of BLOSSOM_PRESET_SERVERS) {
      if (preset !== 'https://blossom.band') {
        expect(merged).toContain(preset);
      }
    }
  });

  it('reads kind-10063 server tags', () => {
    const tags = [
      ['server', 'https://a.example/'],
      ['server', 'https://b.example'],
      ['d', 'blossom'],
    ];
    expect(blossomServersFromTags(tags)).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('strips trailing slashes', () => {
    expect(normalizeBlossomServer('  https://x.test/  ')).toBe('https://x.test');
  });
});

describe('BUD-10 blossom URI', () => {
  const sample =
    'blossom:d819b922fbbf3a47e606dab12a6c316b9a0445ff4aa69d749d638ce83884cf1c.jpg?xs=blossom.laantungir.net&xs=cdn.satellite.earth&xs=blossom.primal.net&as=1ec454734dcbf6fe54901ce25c0c7c6bca5edd89443416761fadc321d38df139&sz=117475';

  it('parses hash, ext, xs, as, and sz', () => {
    const parsed = parseBlossomUri(sample);
    expect(parsed).toMatchObject({
      sha256: 'd819b922fbbf3a47e606dab12a6c316b9a0445ff4aa69d749d638ce83884cf1c',
      ext: 'jpg',
      size: 117475,
      authors: ['1ec454734dcbf6fe54901ce25c0c7c6bca5edd89443416761fadc321d38df139'],
      servers: ['blossom.laantungir.net', 'cdn.satellite.earth', 'blossom.primal.net']
    });
  });

  it('builds https-then-http candidates from xs hints', () => {
    const parsed = parseBlossomUri(sample)!;
    const urls = blossomBlobCandidates(parsed, []);
    expect(urls[0]).toBe(
      'https://blossom.laantungir.net/d819b922fbbf3a47e606dab12a6c316b9a0445ff4aa69d749d638ce83884cf1c.jpg'
    );
    expect(urls[1]).toBe(
      'http://blossom.laantungir.net/d819b922fbbf3a47e606dab12a6c316b9a0445ff4aa69d749d638ce83884cf1c.jpg'
    );
    expect(urls).toContain(
      'https://cdn.satellite.earth/d819b922fbbf3a47e606dab12a6c316b9a0445ff4aa69d749d638ce83884cf1c.jpg'
    );
  });

  it('classifies jpg as image', () => {
    expect(blossomMediaType('jpg')).toBe('image');
    expect(blossomMediaType('mp4')).toBe('video');
    expect(blossomMediaType('bin')).toBeNull();
  });

  it('formats a share URI with defaults', () => {
    expect(
      formatBlossomUri({
        sha256: 'd819b922fbbf3a47e606dab12a6c316b9a0445ff4aa69d749d638ce83884cf1c',
        ext: 'jpg',
        servers: ['https://cdn.satellite.earth/'],
        authors: ['1ec454734dcbf6fe54901ce25c0c7c6bca5edd89443416761fadc321d38df139'],
        size: 117475
      })
    ).toBe(
      'blossom:d819b922fbbf3a47e606dab12a6c316b9a0445ff4aa69d749d638ce83884cf1c.jpg?xs=cdn.satellite.earth&as=1ec454734dcbf6fe54901ce25c0c7c6bca5edd89443416761fadc321d38df139&sz=117475'
    );
  });

  it('renders blossom: content as media and strips the URI from text', () => {
    const event = {
      id: '1'.repeat(64),
      pubkey: '1ec454734dcbf6fe54901ce25c0c7c6bca5edd89443416761fadc321d38df139',
      created_at: 1,
      kind: 1,
      tags: [],
      content: `This is a test of BUD-10. Can you see this image?\n${sample}`,
      sig: 'c'.repeat(128)
    } satisfies Event;
    expect(findBlossomUris(event.content)).toHaveLength(1);
    const media = uniqueMedia(event);
    expect(media).toHaveLength(1);
    expect(media[0]?.type).toBe('image');
    expect(media[0]?.url).toContain(
      'd819b922fbbf3a47e606dab12a6c316b9a0445ff4aa69d749d638ce83884cf1c.jpg'
    );
    expect(media[0]?.fallbacks?.length).toBeGreaterThan(0);
    expect(omitMediaUrls(event.content, media)).toBe(
      'This is a test of BUD-10. Can you see this image?'
    );
  });
});
