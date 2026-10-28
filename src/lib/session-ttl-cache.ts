/**
 * Small in-memory TTL map with inflight dedupe for session-scoped relay/API
 * results (wiki search, booklists, directory lookups, suggest, …).
 */
export class SessionTtlCache<T> {
  private entries = new Map<string, { at: number; value: T }>();
  private inflight = new Map<string, Promise<T>>();

  constructor(
    readonly ttlMs: number,
    readonly maxEntries = 80
  ) {}

  /** Fresh entry if present and not expired (`null` values are valid). */
  getFresh(key: string): { value: T } | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return { value: hit.value };
  }

  set(key: string, value: T): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, { at: Date.now(), value });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /** Drop one key, all keys with a prefix, or the whole cache. */
  invalidate(keyOrPrefix?: string): void {
    if (keyOrPrefix == null || keyOrPrefix === '') {
      this.entries.clear();
      this.inflight.clear();
      return;
    }
    for (const k of [...this.entries.keys()]) {
      if (k === keyOrPrefix || k.startsWith(keyOrPrefix)) this.entries.delete(k);
    }
    for (const k of [...this.inflight.keys()]) {
      if (k === keyOrPrefix || k.startsWith(keyOrPrefix)) this.inflight.delete(k);
    }
  }

  async getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
    const fresh = this.getFresh(key);
    if (fresh) return fresh.value;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const run = (async () => {
      const value = await load();
      this.set(key, value);
      return value;
    })();
    this.inflight.set(key, run);
    try {
      return await run;
    } finally {
      this.inflight.delete(key);
    }
  }
}
