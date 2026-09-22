import { describe, expect, it } from 'vitest';
import { hashPubkey, profileBannerFallbackStyle } from './profile-banner';

describe('profileBannerFallbackStyle', () => {
  const pk = '3d28171b0c3e452cc7192c02a555e57900fbbc57648d1e358582837d692e9a';
  const other = 'c67160fe68382edbaecfba5e0964fd7911888e0b467614d4623827a9e1940dca';

  it('is stable for the same pubkey', () => {
    expect(profileBannerFallbackStyle(pk)).toBe(profileBannerFallbackStyle(pk));
    expect(hashPubkey(pk)).toBe(hashPubkey(pk.toUpperCase()));
  });

  it('varies by pubkey and stays within theme-mix ranges', () => {
    const a = profileBannerFallbackStyle(pk);
    const b = profileBannerFallbackStyle(other);
    expect(a).not.toBe(b);
    expect(a).toMatch(/--banner-accent-mix:\d+%/);
    expect(a).toMatch(/--banner-angle:\d+deg/);
  });
});
