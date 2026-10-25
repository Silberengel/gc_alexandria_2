/**
 * Small LRU for compose preview embeds / blossom server lookups.
 * Live relays first; this only dedupes short-lived session hits.
 */

const MAX = 400;

const byKey = new Map<string, unknown>();

export function lruGet<T>(key: string): T | undefined {
  const k = key.trim().toLowerCase();
  if (!k || !byKey.has(k)) return undefined;
  const value = byKey.get(k) as T;
  byKey.delete(k);
  byKey.set(k, value);
  return value;
}

export function lruSet(key: string, value: unknown): void {
  const k = key.trim().toLowerCase();
  if (!k) return;
  if (byKey.has(k)) byKey.delete(k);
  byKey.set(k, value);
  while (byKey.size > MAX) {
    const oldest = byKey.keys().next().value;
    if (oldest == null) break;
    byKey.delete(oldest);
  }
}

export function lruClear(): void {
  byKey.clear();
}
