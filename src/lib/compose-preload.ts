import type { Event } from 'nostr-tools';
import { parseKind0Json } from './kind-compose';
import { buildKind0TagListFromEvent } from './compose-kind0';
import { isMetadataComposeKind } from './compose-presets';

/** Values + content for a replaceable metadata kind from a live event. */
export function valuesFromMetadataEvent(event: Event): {
  content: string;
  values: Record<string, string>;
  existingKind0?: Record<string, unknown>;
  kind0Tags?: string[][];
} {
  const kind = event.kind;
  if (kind === 0) {
    const existing = parseKind0Json(event.content);
    const kind0Tags = buildKind0TagListFromEvent(event);
    // Flat values kept for draft/compat; the kind-0 editor uses kind0Tags.
    const values: Record<string, string> = {};
    for (const row of kind0Tags) {
      const key = row[0];
      if (!key || key in values) continue;
      if (key === 'bot') {
        const v = (row[1] ?? '').trim().toLowerCase();
        values.bot = !v || v === 'true' ? 'true' : v === 'false' ? 'false' : '';
        continue;
      }
      const v = (row[1] ?? '').trim();
      if (v) values[key] = v;
    }
    return { content: '', values, existingKind0: existing, kind0Tags };
  }

  if (kind === 30315) {
    const values: Record<string, string> = {
      d: event.tags.find((t) => t[0] === 'd')?.[1] ?? 'general'
    };
    const link = event.tags.find((t) => t[0] === 'r')?.[1];
    if (link) values.link_r = link;
    const exp = event.tags.find((t) => t[0] === 'expiration')?.[1];
    if (exp) values.expiration = exp;
    return { content: event.content ?? '', values };
  }

  if (kind === 10133) {
    const lines = event.tags.filter((t) => t[0] === 'payto').map((t) => t.slice(1).join(' '));
    return { content: '', values: { payto: lines.join('\n') } };
  }

  if (kind === 10002 || kind === 10006 || kind === 10012 || kind === 10243) {
    const lines = event.tags
      .filter((t) => t[0] === 'r' || t[0] === 'relay' || t[0] === 'server')
      .map((t) => t.slice(1).join(' '));
    return { content: '', values: { relays: lines.join('\n') } };
  }

  return { content: event.content ?? '', values: {} };
}

export function pickLatestByKind(events: Event[], kind: number): Event | null {
  let best: Event | null = null;
  for (const ev of events) {
    if (ev.kind !== kind) continue;
    if (!best || ev.created_at > best.created_at) best = ev;
  }
  return best;
}

export function shouldPreloadMetadata(kind: number): boolean {
  return isMetadataComposeKind(kind);
}
