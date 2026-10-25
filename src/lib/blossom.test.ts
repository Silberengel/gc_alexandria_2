import { describe, expect, it } from 'vitest';
import {
  BLOSSOM_PRESET_SERVERS,
  blossomServersFromTags,
  mergeBlossomServers,
  normalizeBlossomServer,
} from './blossom';

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
