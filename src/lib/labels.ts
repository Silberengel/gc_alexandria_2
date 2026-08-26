import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { parseAddress } from './library-scope';
import { extractNip32LabelValues } from './nip32';
import { type MuteState, notMuted } from './mute';

export function landingLabels(events: Event[], mute?: MuteState): string[] {
  const counts = new Map<string, Set<string>>();
  for (const event of events) {
    if (event.kind !== KIND.LABEL) continue;
    if (mute && !notMuted(event, mute)) continue;
    const pubs = new Set<string>();
    for (const tag of event.tags) {
      if (tag[0] === 'a' && tag[1]) {
        const parsed = parseAddress(tag[1]);
        if (parsed?.kind === KIND.PUBLICATION) pubs.add(tag[1]);
      }
    }
    if (!pubs.size) continue;
    for (const label of extractNip32LabelValues(event.tags)) {
      const key = label.toLowerCase();
      let set = counts.get(key);
      if (!set) {
        set = new Set();
        counts.set(key, set);
      }
      for (const pub of pubs) set.add(pub);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => {
      if (b[1].size !== a[1].size) return b[1].size - a[1].size;
      return a[0].localeCompare(b[0]);
    })
    .slice(0, 25)
    .map(([label]) => label);
}
