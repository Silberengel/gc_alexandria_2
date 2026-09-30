/** Build-time string. Blank or unset keeps `fallback`. */
export function viteString(raw: string | undefined, fallback: string): string {
  const trimmed = raw?.trim() ?? '';
  return trimmed || fallback;
}

/** 64-char pubkey. Blank or unset keeps `fallback`. Stored lowercase. */
export function viteHex(raw: string | undefined, fallback: string): string {
  return viteString(raw, fallback).toLowerCase();
}

/**
 * Comma-separated build-time list. Blank or unset keeps `fallback`.
 * A trailing comma does not add an empty entry.
 */
export function viteList(raw: string | undefined, fallback: readonly string[]): readonly string[] {
  if (!raw?.trim()) return fallback;
  const items = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}
