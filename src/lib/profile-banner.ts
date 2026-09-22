/** Stable hash bits from a hex pubkey (or any string). */
export function hashPubkey(pubkey: string): number {
  const pk = pubkey.trim().toLowerCase();
  let h = 2166136261;
  for (let i = 0; i < pk.length; i++) {
    h ^= pk.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * CSS custom properties for an empty profile banner.
 * Mixes theme accent/surface tokens with pubkey-derived geometry so each
 * profile looks distinct without leaving the active palette.
 */
export function profileBannerFallbackStyle(pubkey: string): string {
  const h = hashPubkey(pubkey);
  const accentMix = 22 + (h % 28); // 22–49%
  const accentMix2 = 12 + ((h >> 5) % 22); // 12–33%
  const spotX = 12 + ((h >> 8) % 76);
  const spotY = 8 + ((h >> 14) % 55);
  const angle = 105 + (h % 70);
  const stripe = 8 + ((h >> 3) % 18);
  return [
    `--banner-accent-mix:${accentMix}%`,
    `--banner-accent-mix-2:${accentMix2}%`,
    `--banner-spot-x:${spotX}%`,
    `--banner-spot-y:${spotY}%`,
    `--banner-angle:${angle}deg`,
    `--banner-stripe:${stripe}px`
  ].join(';');
}
