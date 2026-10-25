import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  appHandlerSupportsKind,
  parseAppHandler,
  uniqueAppHandlers
} from './app-handlers';
import { partitionWorkResponses } from './comments';

function ev(partial: Partial<Event> & Pick<Event, 'kind' | 'pubkey'>): Event {
  return {
    id: (partial.id ?? 'a'.repeat(64)).slice(0, 64),
    created_at: partial.created_at ?? 1_700_000_000,
    content: partial.content ?? '',
    tags: partial.tags ?? [],
    sig: 'c'.repeat(128),
    ...partial
  };
}

describe('app-handlers', () => {
  it('reads content JSON picture (NIP-89) and thumbs i.nostr.build', () => {
    const handler = ev({
      kind: KIND.APP_HANDLER,
      pubkey: 'fd208ee8c8f283780a9552896e4823cc9dc6bfd442063889577106940fd927c1',
      id: 'b85d341ec37ddf983cc3c7b1a173db9413f26f248d012e17a1a22808b4fe6b98',
      content: JSON.stringify({
        name: 'Imwald Android',
        about: 'Android-native client for the full #Imwald web app.',
        picture: 'https://i.nostr.build/PuPCulLncURMAaeh.png',
        website: 'https://jumble.imwald.eu/'
      }),
      tags: [
        ['d', '9ribc64o'],
        ['alt', 'NIP-89 handler: Imwald Android'],
        ['k', '1'],
        ['android', 'https://jumble.imwald.eu/<bech32>']
      ]
    });
    const info = parseAppHandler(handler);
    expect(info?.name).toBe('Imwald Android');
    expect(info?.picture).toBe('https://i.nostr.build/PuPCulLncURMAaeh.png');
    expect(info?.about).toContain('Android-native');
    expect(info?.href).toBe('https://jumble.imwald.eu/');
    expect(info?.supportedKinds).toEqual([1]);
    expect(appHandlerSupportsKind(handler, 1)).toBe(true);
    expect(appHandlerSupportsKind(handler, 30818)).toBe(false);
  });

  it('falls back to a picture tag when content has no picture', () => {
    const handler = ev({
      kind: KIND.APP_HANDLER,
      pubkey: 'f'.repeat(64),
      content: JSON.stringify({ name: 'Tag App' }),
      tags: [
        ['d', 'x'],
        ['picture', 'https://cdn.example.com/icon.png']
      ]
    });
    expect(parseAppHandler(handler)?.picture).toBe('https://cdn.example.com/icon.png');
  });

  it('dedupes handlers by addressable coordinate', () => {
    const pk = 'f'.repeat(64);
    const older = ev({
      kind: KIND.APP_HANDLER,
      pubkey: pk,
      id: '1'.repeat(64),
      created_at: 10,
      content: JSON.stringify({ name: 'Old', picture: 'https://example.com/a.png' }),
      tags: [['d', 'app1'], ['k', '1']]
    });
    const newer = ev({
      kind: KIND.APP_HANDLER,
      pubkey: pk,
      id: '2'.repeat(64),
      created_at: 20,
      content: JSON.stringify({ name: 'New', picture: 'https://example.com/b.png' }),
      tags: [['d', 'app1'], ['k', '1']]
    });
    const list = uniqueAppHandlers([older, newer]);
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('New');
  });

  it('partitions handlers out of other responses', () => {
    const note = ev({
      kind: KIND.TEXT_NOTE,
      pubkey: 'b'.repeat(64),
      id: 'a'.repeat(64),
      content: 'hi'
    });
    const handler = ev({
      kind: KIND.APP_HANDLER,
      pubkey: 'f'.repeat(64),
      id: 'c'.repeat(64),
      content: JSON.stringify({ name: 'App', picture: 'https://example.com/i.png' }),
      tags: [
        ['d', 'x'],
        ['k', '1'],
        ['e', note.id]
      ]
    });
    const parts = partitionWorkResponses([note, handler], note);
    expect(parts.appHandlers.map((e) => e.id)).toEqual([handler.id]);
    expect(parts.other).toEqual([]);
  });

  it('includes handlers that only match via k tag', () => {
    const wiki = ev({
      kind: KIND.WIKI,
      pubkey: 'b'.repeat(64),
      id: 'a'.repeat(64),
      tags: [['d', 'bitcoin']],
      content: 'wiki'
    });
    const handler = ev({
      kind: KIND.APP_HANDLER,
      pubkey: 'f'.repeat(64),
      id: 'c'.repeat(64),
      content: JSON.stringify({ name: 'Wiki App', website: 'https://example.com' }),
      tags: [['d', 'wa'], ['k', '30818']]
    });
    const parts = partitionWorkResponses([wiki, handler], wiki);
    expect(parts.appHandlers).toHaveLength(1);
  });
});
