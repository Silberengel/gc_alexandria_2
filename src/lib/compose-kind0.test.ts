import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import {
  buildKind0TagListFromEvent,
  kind0SavePayload
} from './compose-kind0';

function ev(over: Partial<Event> & { content: string; tags: string[][] }): Event {
  return {
    id: '1'.repeat(64),
    pubkey: 'a'.repeat(64),
    created_at: 1,
    kind: 0,
    sig: '',
    ...over
  };
}

describe('compose-kind0', () => {
  it('merges tag-only lud16 into editor and JSON on save (Laeserin shape)', () => {
    const event = ev({
      content: JSON.stringify({
        display_name: 'Laeserin',
        name: 'Laeserin',
        nip05: 'laeserin@gitcitadel.com',
        website: 'https://blog.imwald.eu'
      }),
      tags: [
        ['display_name', 'Laeserin'],
        ['name', 'Laeserin'],
        ['lud16', 'stellainforest@cake.cash'],
        ['nip05', 'laeserin@gitcitadel.com'],
        ['website', 'https://blog.imwald.eu'],
        ['client', 'imwald']
      ]
    });
    const rows = buildKind0TagListFromEvent(event);
    expect(rows).toContainEqual(['lud16', 'stellainforest@cake.cash']);
    expect(rows.some((t) => t[0] === 'client')).toBe(false);

    const payload = kind0SavePayload(rows);
    const json = JSON.parse(payload.contentJson) as Record<string, unknown>;
    expect(json.lud16).toBe('stellainforest@cake.cash');
    expect(json.display_name).toBe('Laeserin');
    expect(json.displayName).toBe('Laeserin');
    expect(payload.orderedTags).toContainEqual(['lud16', 'stellainforest@cake.cash']);
  });

  it('loads JSON-only bot into a bot tag row and writes boolean JSON', () => {
    const rows = buildKind0TagListFromEvent(
      ev({ content: JSON.stringify({ name: 'NewsBot', bot: true }), tags: [] })
    );
    expect(rows).toContainEqual(['bot', 'true']);
    const payload = kind0SavePayload(rows);
    expect(JSON.parse(payload.contentJson).bot).toBe(true);
  });

  it('keeps empty singleton placeholders and defaults bot to false', () => {
    const rows = buildKind0TagListFromEvent(null);
    expect(rows.map((r) => r[0])).toEqual([
      'display_name',
      'name',
      'about',
      'picture',
      'banner',
      'bot'
    ]);
    expect(rows).toContainEqual(['bot', 'false']);
    const payload = kind0SavePayload(rows);
    expect(JSON.parse(payload.contentJson)).toEqual({ bot: false });
    expect(payload.orderedTags).toContainEqual(['bot', 'false']);
  });
});
