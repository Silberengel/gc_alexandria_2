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
 * Pubkey-derived geometry keeps each profile distinct while staying in the
 * library palette (parchment, oxblood, book spines, soft arcs).
 */
export function profileBannerFallbackStyle(pubkey: string): string {
  const h = hashPubkey(pubkey);
  const accentMix = 28 + (h % 24); // 28–51%
  const accentMix2 = 14 + ((h >> 5) % 20); // 14–33%
  const spotX = 58 + ((h >> 8) % 28); // prefer right side (avatar sits left)
  const spotY = 18 + ((h >> 14) % 48);
  const angle = 118 + (h % 48);
  const stripe = 10 + ((h >> 3) % 14);
  const spine = 14 + ((h >> 11) % 18);
  const arcSize = 55 + ((h >> 17) % 35);
  const discSize = 38 + ((h >> 21) % 28);
  const discX = 62 + ((h >> 7) % 26);
  const discY = -12 + ((h >> 19) % 36);
  const wedge = 18 + ((h >> 9) % 22);
  return [
    `--banner-accent-mix:${accentMix}%`,
    `--banner-accent-mix-2:${accentMix2}%`,
    `--banner-spot-x:${spotX}%`,
    `--banner-spot-y:${spotY}%`,
    `--banner-angle:${angle}deg`,
    `--banner-stripe:${stripe}px`,
    `--banner-spine:${spine}px`,
    `--banner-arc-size:${arcSize}%`,
    `--banner-disc-size:${discSize}%`,
    `--banner-disc-x:${discX}%`,
    `--banner-disc-y:${discY}%`,
    `--banner-wedge:${wedge}%`
  ].join(';');
}
