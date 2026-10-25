import { describe, expect, it } from 'vitest';
import { buildComposePartial, parseKind0Json } from './compose-build';

describe('buildComposePartial', () => {
  it('forces empty content for kind 30040', () => {
    const partial = buildComposePartial({
      kind: 30040,
      content: 'should not appear',
      values: {
        title: 'Guide',
        publication_author: 'Author',
        publication_type: 'book',
      },
    });
    expect(partial.content).toBe('');
    expect(partial.tags.some((t) => t[0] === 'title' && t[1] === 'Guide')).toBe(true);
  });

  it('publishes 30040 naddr sections as a-tags', async () => {
    const { nip19 } = await import('nostr-tools');
    const pk = 'a'.repeat(64);
    const naddr = nip19.naddrEncode({
      kind: 30041,
      pubkey: pk,
      identifier: 'intro',
    });
    const partial = buildComposePartial({
      kind: 30040,
      content: '',
      values: {
        title: 'Guide',
        publication_author: 'Author',
        publication_type: 'book',
        sections: `${naddr}\n${pk}`,
      },
    });
    expect(partial.tags).toContainEqual(['a', `30041:${pk}:intro`]);
    expect(partial.tags).toContainEqual(['e', pk]);
  });

  it('builds kind-0 JSON and mirror tags from editor rows', () => {
    const partial = buildComposePartial({
      kind: 0,
      content: '',
      values: {},
      kind0Tags: [
        ['name', 'Ada'],
        ['lud16', 'ada@example.com'],
        ['website', 'https://a.example'],
        ['website', 'https://b.example'],
      ],
    });
    const json = parseKind0Json(partial.content);
    expect(json.name).toBe('Ada');
    expect(json.lud16).toBe('ada@example.com');
    expect(json.website).toBe('https://a.example');
    expect(partial.tags).toContainEqual(['name', 'Ada']);
    expect(partial.tags).toContainEqual(['lud16', 'ada@example.com']);
    expect(partial.tags.filter((t) => t[0] === 'website')).toEqual([
      ['website', 'https://a.example'],
      ['website', 'https://b.example'],
    ]);
  });

  it('emits relay_list_rw r tags for kind 10002', () => {
    const partial = buildComposePartial({
      kind: 10002,
      content: 'ignored',
      values: {
        relays: 'wss://relay.example\nwss://read.example read',
      },
    });
    expect(partial.content).toBe('');
    expect(partial.tags).toEqual([
      ['r', 'wss://relay.example'],
      ['r', 'wss://read.example', 'read'],
      ['client', 'Alexandria'],
    ]);
  });

  it('replaces freeform client tags with ["client", "Alexandria"]', () => {
    const partial = buildComposePartial({
      kind: 1,
      content: 'hi',
      values: {},
      freeformTags: [
        ['client', 'Other'],
        ['e', 'aa'.repeat(32)],
      ],
    });
    expect(partial.tags.filter((t) => t[0] === 'client')).toEqual([['client', 'Alexandria']]);
    expect(partial.tags.some((t) => t[0] === 'e')).toBe(true);
  });
});
