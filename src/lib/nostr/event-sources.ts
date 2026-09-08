/** Where an event was observed: relay wss:// URLs (Mercury HTTP counts as MERCURY_WSS). */
const sourcesById = new Map<string, Set<string>>();

const MAX_TRACKED = 2_000;

function trimMap(): void {
  if (sourcesById.size <= MAX_TRACKED) return;
  const drop = sourcesById.size - MAX_TRACKED;
  let i = 0;
  for (const key of sourcesById.keys()) {
    sourcesById.delete(key);
    if (++i >= drop) break;
  }
}

export function noteEventSource(eventId: string, source: string): void {
  const id = eventId.toLowerCase();
  const url = source.trim();
  if (!id || !url) return;
  let set = sourcesById.get(id);
  if (!set) {
    set = new Set();
    sourcesById.set(id, set);
    trimMap();
  }
  set.add(url);
}

export function noteEventSources(eventId: string, sources: readonly string[]): void {
  for (const source of sources) noteEventSource(eventId, source);
}

export function eventSources(eventId: string): string[] {
  const set = sourcesById.get(eventId.toLowerCase());
  if (!set?.size) return [];
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function formatEventSources(eventId: string, fallback = ''): string {
  const list = eventSources(eventId);
  if (!list.length) return fallback;
  return list.join('\n');
}
