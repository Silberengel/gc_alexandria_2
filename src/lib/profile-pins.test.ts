import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  composeProfilePinboardSlips,
  pinboardEventExcerpt,
  pinboardFirstEventRef,
  pinboardFirstOgUrl,
  pinboardHandText,
  pinboardResolveEmbeddedExcerpt,
  pinboardSlipImage,
  pinboardSlipPreview,
  pinboardSlipVideo,
  pinboardSyncFaceImage,
  pinEventIds,
  pickOriginalPostsForPinboard,
  pickPinList,
  resolvePinnedNotes,
  samePinnedNoteIds,
  youtubeStillUrl
} from './profile-pins';
import { rememberEvents } from './nostr/event-memory';
import { rememberProfileFromKind0 } from './profile-cache';
import { nip19 } from 'nostr-tools';

function ev(over: Partial<Event> & { tags?: string[][] }): Event {
  return {
    id: (over.id ?? 'a'.repeat(64)).toLowerCase(),
    pubkey: (over.pubkey ?? 'b'.repeat(64)).toLowerCase(),
    created_at: over.created_at ?? 1,
    kind: over.kind ?? 1,
    tags: over.tags ?? [],
    content: over.content ?? '',
    sig: over.sig ?? 'c'.repeat(128)
  };
}

describe('profile pins', () => {
  it('extracts ordered unique e-tag ids from a kind 10001 list', () => {
    const id1 = '1'.repeat(64);
    const id2 = '2'.repeat(64);
    const list = ev({
      kind: KIND.PIN,
      tags: [
        ['e', id1],
        ['p', 'd'.repeat(64)],
        ['e', id2],
        ['e', id1]
      ]
    });
    expect(pinEventIds(list)).toEqual([id1, id2]);
    expect(pinEventIds(ev({ kind: KIND.BOOKMARK, tags: [['e', id1]] }))).toEqual([]);
  });

  it('picks the newest pin list for a pubkey', () => {
    const pk = 'b'.repeat(64);
    const older = ev({ id: '1'.repeat(64), kind: KIND.PIN, pubkey: pk, created_at: 1 });
    const newer = ev({ id: '2'.repeat(64), kind: KIND.PIN, pubkey: pk, created_at: 5 });
    const other = ev({ id: '3'.repeat(64), kind: KIND.PIN, pubkey: 'c'.repeat(64), created_at: 9 });
    expect(pickPinList([older, newer, other], pk)?.id).toBe(newer.id);
  });

  it('compares pinned note id sequences', () => {
    const a = ev({ id: 'a'.repeat(64) });
    const b = ev({ id: 'b'.repeat(64) });
    expect(samePinnedNoteIds([a, b], [a, b])).toBe(true);
    expect(samePinnedNoteIds([a, b], [b, a])).toBe(false);
    expect(samePinnedNoteIds([a], [])).toBe(false);
  });

  it('resolves pinned note ids via memory and fetch fallback', async () => {
    const noteA = ev({ id: 'a'.repeat(64), kind: KIND.TEXT_NOTE, content: 'first' });
    const noteB = ev({ id: 'b'.repeat(64), kind: KIND.TEXT_NOTE, content: 'second' });
    rememberEvents([noteA]);
    const list = ev({
      kind: KIND.PIN,
      tags: [
        ['e', noteA.id],
        ['e', noteB.id],
        ['e', 'f'.repeat(64)]
      ]
    });
    const notes = await resolvePinnedNotes(list, {
      fetchIds: async (ids) => {
        expect(ids).toEqual([noteB.id, 'f'.repeat(64)]);
        return [noteB];
      }
    });
    expect(notes.map((e) => e.id)).toEqual([noteA.id, noteB.id]);
  });

  it('composes pinboard slips: pins first, then OPs, capped and deduped', () => {
    const pin1 = ev({ id: '1'.repeat(64), content: 'pin one', created_at: 1 });
    const pin2 = ev({ id: '2'.repeat(64), content: 'pin two', created_at: 2 });
    const opNew = ev({ id: '3'.repeat(64), content: 'op new', created_at: 50 });
    const opOld = ev({ id: '4'.repeat(64), content: 'op old', created_at: 10 });
    const dup = ev({ id: '1'.repeat(64), content: 'same as pin', created_at: 99 });
    const reply = ev({
      id: '5'.repeat(64),
      content: 'reply',
      created_at: 80,
      tags: [['e', 'a'.repeat(64), '', 'reply']]
    });
    const board = composeProfilePinboardSlips([pin1, pin2], [opNew, opOld, dup, reply], 5);
    expect(board.hasPins).toBe(true);
    expect(board.slips.map((e) => e.id)).toEqual([pin1.id, pin2.id, opNew.id, opOld.id]);
  });

  it('returns empty pinboard when there are no pins or OPs', () => {
    expect(composeProfilePinboardSlips([], [], 5)).toEqual({ slips: [], hasPins: false });
  });

  it('uses Latest heading source when only OPs fill the board', () => {
    const op = ev({ id: '9'.repeat(64), content: 'solo', created_at: 3 });
    const board = composeProfilePinboardSlips([], [op], 5);
    expect(board.hasPins).toBe(false);
    expect(board.slips.map((e) => e.id)).toEqual([op.id]);
  });

  it('orders original-post fill newest first and skips replies', () => {
    const newer = ev({ id: 'a'.repeat(64), created_at: 20, content: 'n' });
    const older = ev({ id: 'b'.repeat(64), created_at: 5, content: 'o' });
    const reply = ev({
      id: 'c'.repeat(64),
      created_at: 30,
      content: 'r',
      tags: [['e', 'd'.repeat(64)]]
    });
    expect(pickOriginalPostsForPinboard([older, reply, newer], 5).map((e) => e.id)).toEqual([
      newer.id,
      older.id
    ]);
  });

  it('builds slip preview without media urls', () => {
    const url = 'https://cdn.example.com/pic.png';
    const note = ev({
      content: `hello\n${url}`,
      tags: [['image', url]]
    });
    expect(pinboardSlipPreview(note, 80)).toBe('hello');
  });

  it('strips nostr: refs from slip preview text', () => {
    const quotedId = 'd'.repeat(64);
    const nevent = nip19.neventEncode({ id: quotedId });
    const note = ev({ content: `peak UX too\n\nnostr:${nevent}` });
    expect(pinboardSlipPreview(note, 120)).toBe('peak UX too');
    expect(pinboardSlipPreview(note, 120)).not.toContain('nevent1');
  });

  it('strips markdown headings and emphasis from slip preview text', () => {
    const note = ev({
      content:
        '# TeX Test\n\n## Simple Math Rendering Test\n\nThis is a **minimal** test note for TeX math rendering.'
    });
    const preview = pinboardSlipPreview(note, 120);
    expect(preview).toContain('TeX Test');
    expect(preview).toContain('Simple Math Rendering Test');
    expect(preview).toContain('minimal');
    expect(preview).not.toMatch(/#/);
    expect(preview).not.toContain('**');
  });

  it('finds the first embedded note/nevent and resolves its excerpt', async () => {
    const quotedId = 'd'.repeat(64);
    const quoted = ev({
      id: quotedId,
      content: 'The real quoted note with substance.',
      tags: [['image', 'https://cdn.example.com/quote.png']]
    });
    rememberEvents([quoted]);
    const nevent = nip19.neventEncode({ id: quotedId });
    const note = ev({ content: `nostr:${nevent}` });
    expect(pinboardFirstEventRef(note)?.id).toBe(quotedId);
    expect(pinboardSlipPreview(note, 80)).toBe('');
    expect(await pinboardResolveEmbeddedExcerpt(note, { maxChars: 80 })).toBe(
      'The real quoted note with substance.'
    );
    expect(pinboardEventExcerpt(quoted, 80)).toBe('The real quoted note with substance.');
    expect(pinboardSyncFaceImage(note)).toBe('https://cdn.example.com/quote.png');
  });

  it('picks the first OG-worthy https link and handwriting text without urls', () => {
    const note = ev({
      content: 'GM\n\nhttps://biblestr.imwald.eu\n\nhttps://gc-alexandria.imwald.eu\n\n#GitCitadel'
    });
    expect(pinboardFirstOgUrl(note)).toBe('https://biblestr.imwald.eu');
    expect(pinboardHandText(note)).toBe('GM');
  });

  it('uses title and d-tag URL for empty-content web bookmarks', () => {
    const bookmark = ev({
      kind: KIND.WEB_BOOKMARK,
      content: '',
      tags: [
        ['d', 'www.lewrockwell.com/2026/09/no_author/the-anarcho-capitalist-case-for-alberta/'],
        ['title', 'The Anarcho-Capitalist Case for Alberta']
      ]
    });
    expect(pinboardSlipPreview(bookmark, 80)).toBe('The Anarcho-Capitalist Case for Alberta');
    expect(pinboardFirstOgUrl(bookmark)).toBe(
      'https://www.lewrockwell.com/2026/09/no_author/the-anarcho-capitalist-case-for-alberta/'
    );
    expect(pinboardHandText(bookmark, 40)).toBe('The Anarcho-Capitalist Case for Alberta');
  });

  it('builds a YouTube still URL and uses it as a sync face image', () => {
    const watch = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    expect(youtubeStillUrl(watch)).toBe(
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
    );
    const note = ev({ content: `check this\n${watch}` });
    expect(pinboardSyncFaceImage(note)).toBe(
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
    );
  });

  it('prefers tagged media over YouTube stills for the sync face', () => {
    const pic = 'https://cdn.example.com/hero.png';
    const note = ev({
      content: `see https://youtu.be/dQw4w9WgXcQ`,
      tags: [['image', pic]]
    });
    expect(pinboardSyncFaceImage(note)).toBe(pic);
  });

  it('exposes video media for pinboard faces (Amethyst shorts)', () => {
    const mp4 =
      'https://24242.io/6aca0e05f76ce92115d9614323e514fc8636531114b5c50f245e916d6889ba9a.mp4';
    const note = ev({
      content: `spend some #sats\n${mp4}`,
      tags: [
        [
          'imeta',
          `url ${mp4}`,
          'm video/mp4',
          'dim 1440x1792',
          'alt Frankie'
        ]
      ]
    });
    expect(pinboardSlipImage(note)).toBeNull();
    expect(pinboardSyncFaceImage(note)).toBeNull();
    expect(pinboardSlipVideo(note)).toEqual({ url: mp4, poster: undefined });
  });

  it('uses an imeta video poster as the sync face still', () => {
    const mp4 = 'https://cdn.example.com/clip.mp4';
    const poster = 'https://cdn.example.com/poster.jpg';
    const note = ev({
      content: mp4,
      tags: [['imeta', `url ${mp4}`, 'm video/mp4', `image ${poster}`]]
    });
    expect(pinboardSlipVideo(note)).toEqual({ url: mp4, poster });
    expect(pinboardSyncFaceImage(note)).toBe(poster);
  });

  it('uses a cached profile picture from an embedded npub', () => {
    const pk = 'e'.repeat(64);
    rememberProfileFromKind0(
      ev({
        kind: KIND.METADATA,
        pubkey: pk,
        content: JSON.stringify({
          name: 'Face',
          picture: 'https://cdn.example.com/face.jpg'
        })
      })
    );
    const note = ev({ content: `hello nostr:${nip19.npubEncode(pk)}` });
    expect(pinboardSyncFaceImage(note)).toBe('https://cdn.example.com/face.jpg');
  });
});
