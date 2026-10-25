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

  it('preserves unknown kind-0 JSON keys', () => {
    const existing = { custom_key: 'keep-me', name: 'Old' };
    const partial = buildComposePartial({
      kind: 0,
      content: '',
      values: { name: 'New' },
      existingKind0: existing,
    });
    const json = parseKind0Json(partial.content);
    expect(json.custom_key).toBe('keep-me');
    expect(json.name).toBe('New');
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
      ['client', 'alexandria'],
    ]);
  });

  it('replaces freeform client tags with ["client", "alexandria"]', () => {
    const partial = buildComposePartial({
      kind: 1,
      content: 'hi',
      values: {},
      freeformTags: [
        ['client', 'Other'],
        ['e', 'aa'.repeat(32)],
      ],
    });
    expect(partial.tags.filter((t) => t[0] === 'client')).toEqual([['client', 'alexandria']]);
    expect(partial.tags.some((t) => t[0] === 'e')).toBe(true);
  });
});
