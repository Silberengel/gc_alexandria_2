import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { assertReadyToSign } from './kind-compose';
import { noteEventSource } from './nostr/event-sources';
import { rememberEvents } from './nostr/event-memory';
import {
  collapseFeedReposts,
  isProtectedEvent,
  isRepostKind,
  myRepostOf,
  parseEmbeddedRepostEvent,
  peekRepostExcerpt,
  quoteComposeSeed,
  repostDraft,
  repostKindForTarget,
  repostPointsAt,
  repostTargetId,
  uniqueReposterPubkeys
} from './repost';

function ev(partial: Partial<Event> & Pick<Event, 'kind'>): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1,
    tags: [],
    content: '',
    sig: 'c'.repeat(128),
    ...partial
  };
}

describe('repost', () => {
  it('recognizes kind 6 and 16', () => {
    expect(isRepostKind(KIND.REPOST)).toBe(true);
    expect(isRepostKind(KIND.GENERIC_REPOST)).toBe(true);
    expect(isRepostKind(KIND.TEXT_NOTE)).toBe(false);
  });

  it('reads the NIP-18 e target and embedded JSON', () => {
    const targetId = 'd'.repeat(64);
    expect(
      repostTargetId(
        ev({
          kind: KIND.REPOST,
          tags: [
            ['e', targetId],
            ['p', 'b'.repeat(64)]
          ]
        })
      )
    ).toBe(targetId);

    const embedded = ev({
      id: targetId,
      kind: KIND.TEXT_NOTE,
      content: 'hello from note'
    });
    const parsed = parseEmbeddedRepostEvent(JSON.stringify(embedded));
    expect(parsed?.id).toBe(targetId);
    expect(
      peekRepostExcerpt(ev({ kind: KIND.REPOST, content: JSON.stringify(embedded) }))
    ).toBe('hello from note');
  });

  it('uses memory for an empty kind-6 boost', () => {
    const targetId = 'e'.repeat(64);
    rememberEvents([
      ev({
        id: targetId,
        kind: KIND.TEXT_NOTE,
        content: 'boosted text'
      })
    ]);
    expect(
      peekRepostExcerpt(
        ev({
          kind: KIND.REPOST,
          tags: [
            ['e', targetId],
            ['p', 'b'.repeat(64)]
          ]
        })
      )
    ).toBe('boosted text');
  });

  it('seeds a kind-1 quote with q/p and a nostr pointer', () => {
    const note = ev({
      id: '1'.repeat(64),
      pubkey: '2'.repeat(64),
      kind: KIND.TEXT_NOTE,
      content: 'hi'
    });
    noteEventSource(note.id, 'wss://relay.example/');
    const seed = quoteComposeSeed(note);
    expect(seed.kind).toBe(KIND.TEXT_NOTE);
    expect(seed.content).toMatch(/^(\n\n)?nostr:nevent1/);
    expect(seed.freeformTags).toContainEqual([
      'q',
      note.id,
      'wss://relay.example',
      note.pubkey
    ]);
    expect(seed.freeformTags).toContainEqual(['p', note.pubkey]);

    const article = ev({
      id: '3'.repeat(64),
      pubkey: '4'.repeat(64),
      kind: KIND.LONG_FORM,
      content: 'essay',
      tags: [['d', 'essay-1']]
    });
    noteEventSource(article.id, 'wss://relay.example/');
    const articleSeed = quoteComposeSeed(article);
    expect(articleSeed.content).toMatch(/^(\n\n)?nostr:naddr1/);
    expect(articleSeed.freeformTags).toContainEqual([
      'q',
      `${KIND.LONG_FORM}:${article.pubkey}:essay-1`,
      'wss://relay.example',
      article.pubkey
    ]);
  });

  it('drafts kind 6 for notes and kind 16 for everything else', () => {
    const note = ev({
      id: '1'.repeat(64),
      pubkey: '2'.repeat(64),
      kind: KIND.TEXT_NOTE,
      content: 'hi'
    });
    noteEventSource(note.id, 'wss://relay.example/');
    expect(repostKindForTarget(note)).toBe(KIND.REPOST);
    const noteRepost = repostDraft(note);
    expect(noteRepost.kind).toBe(KIND.REPOST);
    expect(noteRepost.tags).toContainEqual([
      'e',
      note.id,
      'wss://relay.example',
      note.pubkey
    ]);
    expect(noteRepost.tags).toContainEqual(['p', note.pubkey]);
    expect(noteRepost.tags.some((t) => t[0] === 'k')).toBe(false);
    expect(JSON.parse(noteRepost.content).id).toBe(note.id);
    expect(assertReadyToSign(noteRepost).ok).toBe(true);

    const article = ev({
      id: '3'.repeat(64),
      pubkey: '4'.repeat(64),
      kind: KIND.LONG_FORM,
      content: 'essay',
      tags: [['d', 'essay-1']]
    });
    noteEventSource(article.id, 'wss://relay.example/');
    expect(repostKindForTarget(article)).toBe(KIND.GENERIC_REPOST);
    const articleRepost = repostDraft(article);
    expect(articleRepost.kind).toBe(KIND.GENERIC_REPOST);
    expect(articleRepost.content).toBe('');
    expect(articleRepost.tags).toContainEqual([
      'e',
      article.id,
      'wss://relay.example',
      article.pubkey
    ]);
    expect(articleRepost.tags).toContainEqual(['p', article.pubkey]);
    expect(articleRepost.tags).toContainEqual(['k', String(KIND.LONG_FORM)]);
    expect(articleRepost.tags).toContainEqual([
      'a',
      `${KIND.LONG_FORM}:${article.pubkey}:essay-1`
    ]);
    expect(assertReadyToSign(articleRepost).ok).toBe(true);

    const protectedNote = ev({
      id: '5'.repeat(64),
      pubkey: '6'.repeat(64),
      kind: KIND.TEXT_NOTE,
      content: 'secret',
      tags: [['-']]
    });
    expect(isProtectedEvent(protectedNote)).toBe(true);
    expect(repostDraft(protectedNote).content).toBe('');
  });

  it('collapses boosts onto the target and lists unique reposter pubkeys', () => {
    const noteId = 'a'.repeat(64);
    const note = ev({ id: noteId, kind: KIND.TEXT_NOTE, pubkey: '1'.repeat(64), content: 'hi' });
    const boostA = ev({
      id: 'b'.repeat(64),
      kind: KIND.REPOST,
      pubkey: '2'.repeat(64),
      created_at: 2,
      tags: [['e', noteId]]
    });
    const boostB = ev({
      id: 'c'.repeat(64),
      kind: KIND.REPOST,
      pubkey: '3'.repeat(64),
      created_at: 3,
      tags: [['e', noteId]]
    });
    const boostA2 = ev({
      id: 'd'.repeat(64),
      kind: KIND.REPOST,
      pubkey: '2'.repeat(64),
      created_at: 4,
      tags: [['e', noteId]]
    });

    expect(uniqueReposterPubkeys([boostA, boostB, boostA2])).toEqual([
      '2'.repeat(64),
      '3'.repeat(64)
    ]);

    const withNote = collapseFeedReposts([boostA, note, boostB]);
    expect(withNote).toHaveLength(1);
    expect(withNote[0]).toMatchObject({ type: 'event', event: note });
    expect(withNote[0]?.type === 'event' && withNote[0].boosts).toHaveLength(2);

    const boostOnly = collapseFeedReposts([boostA, boostB]);
    expect(boostOnly).toEqual([
      expect.objectContaining({ type: 'boost-only', targetId: noteId })
    ]);
    expect(boostOnly[0]?.type === 'boost-only' && boostOnly[0].boosts).toHaveLength(2);
  });

  it('finds the viewer’s newest repost of a target', () => {
    const note = ev({ id: 'a'.repeat(64), kind: KIND.TEXT_NOTE, pubkey: '1'.repeat(64) });
    const me = '2'.repeat(64);
    const older = ev({
      id: 'b'.repeat(64),
      kind: KIND.REPOST,
      pubkey: me,
      created_at: 1,
      tags: [['e', note.id]]
    });
    const newer = ev({
      id: 'c'.repeat(64),
      kind: KIND.REPOST,
      pubkey: me,
      created_at: 2,
      tags: [['e', note.id]]
    });
    const other = ev({
      id: 'd'.repeat(64),
      kind: KIND.REPOST,
      pubkey: '3'.repeat(64),
      created_at: 3,
      tags: [['e', note.id]]
    });
    expect(repostPointsAt(newer, note)).toBe(true);
    expect(myRepostOf([older, newer, other], me, note)?.id).toBe(newer.id);
    expect(myRepostOf([other], me, note)).toBeNull();
  });
});
