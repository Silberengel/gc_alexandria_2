import type { Event } from 'nostr-tools';
import { parseKind0Json } from './kind-compose';
import { isMetadataComposeKind } from './compose-presets';

/** Values + content for a replaceable metadata kind from a live event. */
export function valuesFromMetadataEvent(event: Event): {
  content: string;
  values: Record<string, string>;
  existingKind0?: Record<string, unknown>;
} {
  const kind = event.kind;
  if (kind === 0) {
    const existing = parseKind0Json(event.content);
    const values: Record<string, string> = {};
    for (const key of [
      'name',
      'display_name',
      'about',
      'picture',
      'banner',
      'nip05',
      'lud16',
      'website',
      'bot'
    ]) {
      const v = existing[key];
      if (key === 'bot') {
        values.bot = v === true || v === 'true' ? 'true' : '';
        continue;
      }
      if (typeof v === 'string' && v.trim()) values[key] = v;
      else if (key === 'display_name' && typeof existing.displayName === 'string') {
        values.display_name = existing.displayName;
      }
    }
    return { content: '', values, existingKind0: existing };
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
