import { describe, expect, it } from 'vitest';
import { buildComposePartial, parseKind0Json, validateComposeForm } from './compose-build';
import { assertReadyToSign } from './kind-compose';

describe('buildComposePartial', () => {
  it('appends a NIP-36 content-warning tag when enabled', () => {
    const withWarn = buildComposePartial({
      kind: 1,
      content: 'hello',
      values: {},
      contentWarningEnabled: true,
      contentWarningLabel: 'Spoilers'
    });
    expect(withWarn.tags).toContainEqual(['content-warning', 'Spoilers']);

    const without = buildComposePartial({
      kind: 1,
      content: 'hello',
      values: {},
      freeformTags: [['content-warning', 'stale']],
      contentWarningEnabled: false
    });
    expect(without.tags.some((t) => t[0] === 'content-warning')).toBe(false);
  });

  it('adds NIP-52 D tags for time-based calendar events', () => {
    const start = 1_700_000_000;
    const partial = buildComposePartial({
      kind: 31923,
      content: 'Meetup downtown',
      values: {
        d: 'meetup-1',
        title: 'Meetup',
        start: String(start),
        end: String(start + 7200)
      }
    });
    expect(partial.tags).toContainEqual(['title', 'Meetup']);
    expect(partial.tags.some((t) => t[0] === 'D')).toBe(true);
  });

  it('builds NIP-88 poll tags from dedicated compose fields', () => {
    const partial = buildComposePartial({
      kind: 1068,
      content: 'Favorite color?',
      values: {},
      pollOptions: ['Red', 'Blue', ''],
      pollMultipleChoice: true,
      pollEndsHours: '2'
    });
    expect(partial.content).toBe('Favorite color?');
    expect(partial.tags.filter((t) => t[0] === 'option')).toHaveLength(2);
    expect(partial.tags).toContainEqual(['polltype', 'multiplechoice']);
    expect(partial.tags.some((t) => t[0] === 'endsAt')).toBe(true);

    const bad = validateComposeForm({
      kind: 1068,
      content: 'Only one?',
      values: {},
      pollOptions: ['Yes']
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/two options/i);
  });

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

  it('keeps relay and author hints from naddr/nevent/nprofile pointer fields', async () => {
    const { nip19 } = await import('nostr-tools');
    const pk = 'b'.repeat(64);
    const id = 'c'.repeat(64);
    const naddr = nip19.naddrEncode({
      kind: 30617,
      pubkey: pk,
      identifier: 'repo',
      relays: ['wss://relay.example']
    });
    const nprofile = nip19.nprofileEncode({ pubkey: pk, relays: ['wss://people.example'] });
    const nevent = nip19.neventEncode({
      id,
      relays: ['wss://notes.example'],
      author: pk
    });

    const issue = buildComposePartial({
      kind: 1621,
      content: 'Subject: bug\n\nbody',
      values: { repo_a: naddr, owner_p: nprofile }
    });
    expect(issue.tags).toContainEqual(['a', `30617:${pk}:repo`, 'wss://relay.example']);
    expect(issue.tags).toContainEqual(['p', pk, 'wss://people.example']);

    const reaction = buildComposePartial({
      kind: 7,
      content: '+',
      values: { e: nevent, a: naddr }
    });
    expect(reaction.tags).toContainEqual(['e', id, 'wss://notes.example', pk]);
    expect(reaction.tags).toContainEqual(['a', `30617:${pk}:repo`, 'wss://relay.example']);
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

  it('builds kind-3 follow p tags from the authors field', () => {
    const pk = 'c'.repeat(64);
    const partial = buildComposePartial({
      kind: 3,
      content: 'ignored',
      values: { authors: `${pk}|wss://r.example|Ada` },
    });
    expect(partial.content).toBe('');
    expect(partial.tags).toEqual([
      ['p', pk, 'wss://r.example', 'Ada'],
      ['client', 'Alexandria'],
    ]);
  });

  it('builds kind-10000 mute tags and private JSON content', () => {
    const pk = 'd'.repeat(64);
    const partial = buildComposePartial({
      kind: 10000,
      content: 'ignored',
      values: { muted: `p ${pk}\nprivate word spam` },
    });
    expect(partial.tags).toEqual([
      ['p', pk],
      ['client', 'Alexandria'],
    ]);
    expect(JSON.parse(partial.content)).toEqual([['word', 'spam']]);
  });

  it('accepts mute drafts with private JSON content (NIP-51 ciphertext slot)', () => {
    const pk = 'e'.repeat(64);
    const state = {
      kind: 10000,
      content: '',
      values: { muted: `p ${pk}\nprivate word spam` },
    };
    expect(validateComposeForm(state)).toEqual({ ok: true });
    const partial = buildComposePartial(state);
    expect(assertReadyToSign(partial).ok).toBe(true);
    expect(
      assertReadyToSign({
        kind: 10000,
        content:
          'AhMkvQCvZ6gxhyL1hYAQRG7bkm/0woOt6nV2aOQ8uZwT/EtUErJoydYhQE6Cd9AeCdciCoexgF5z7uVJGS2cJ3lj6/jXvgDtDcl768TyCdLflihc5p0J4OkU',
        tags: partial.tags,
      }).ok
    ).toBe(true);
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

  it('builds NIP-A4 kind 24 public messages with a recipient p tag', async () => {
    const { nip19 } = await import('nostr-tools');
    const pk = 'd'.repeat(64);
    const partial = buildComposePartial({
      kind: 24,
      content: 'hello publicly',
      values: { recipient_p: nip19.npubEncode(pk) },
    });
    expect(partial.kind).toBe(24);
    expect(partial.content).toBe('hello publicly');
    expect(partial.tags).toContainEqual(['p', pk]);
    expect(partial.tags.some((t) => t[0] === 'e')).toBe(false);
    expect(validateComposeForm({ kind: 24, content: 'hello publicly', values: { recipient_p: pk } })).toEqual({
      ok: true,
    });
  });
});
