import { describe, expect, it } from 'vitest';
import { canUseNostrBuildThumb, toNostrBuildThumbUrl } from './nostr-build';

describe('nostr-build thumb URLs', () => {
  it('inserts /thumb/ on i.nostr.build images', () => {
    expect(canUseNostrBuildThumb('https://i.nostr.build/foo.webp')).toBe(true);
    expect(toNostrBuildThumbUrl('https://i.nostr.build/foo.webp')).toBe(
      'https://i.nostr.build/thumb/foo.webp'
    );
  });

  it('does not rewrite cdn.nostr.build', () => {
    expect(toNostrBuildThumbUrl('https://cdn.nostr.build/i/abc123.webp')).toBe(
      'https://cdn.nostr.build/i/abc123.webp'
    );
  });

  it('does not rewrite videos or existing thumbs', () => {
    const video = 'https://i.nostr.build/bar.webm';
    expect(toNostrBuildThumbUrl(video)).toBe(video);
    const thumb = 'https://i.nostr.build/thumb/foo.webp';
    expect(toNostrBuildThumbUrl(thumb)).toBe(thumb);
  });
});
