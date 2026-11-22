import { describe, expect, it } from 'vitest';
import {
  dedupeNostrBuildGifs,
  imetaFromNostrBuildGif,
  mimeFromGifFormat,
  normalizeGifQuery,
  sha256OfNostrBuildGif,
  shouldSearchGifQuery,
  tidySuggestTerms,
  type NostrBuildGif
} from './gifs-nostr-build';

describe('normalizeGifQuery / shouldSearchGifQuery', () => {
  it('collapses and lowercases', () => {
    expect(normalizeGifQuery('  Cat   FACE  ')).toBe('cat face');
  });

  it('rejects single Latin letter', () => {
    expect(shouldSearchGifQuery('a')).toBe(false);
    expect(shouldSearchGifQuery(normalizeGifQuery('A'))).toBe(false);
  });

  it('accepts emoji and ideograph', () => {
    expect(shouldSearchGifQuery('😂')).toBe(true);
    expect(shouldSearchGifQuery('猫')).toBe(true);
    expect(shouldSearchGifQuery('개')).toBe(true);
    expect(shouldSearchGifQuery('café')).toBe(true);
  });

  it('rejects punctuation-only', () => {
    expect(shouldSearchGifQuery('!!!')).toBe(false);
  });

  it('accepts two chars and digits', () => {
    expect(shouldSearchGifQuery('gm')).toBe(true);
    expect(shouldSearchGifQuery('42')).toBe(true);
  });
});

describe('NostrBuildGif helpers', () => {
  it('mimeFromFormat', () => {
    expect(mimeFromGifFormat('gif')).toBe('image/gif');
    expect(mimeFromGifFormat('webp')).toBe('image/webp');
  });

  it('sha256Of extracts from id and url', () => {
    const hash = 'ab'.repeat(32);
    const gif: NostrBuildGif = {
      id: `${hash}.gif`,
      url: `https://gifs.nostr.build/${hash}.gif`,
      width: 100,
      height: 100,
      mp4: `https://gifs.nostr.build/mp4/orig/${hash}.gif`
    };
    expect(sha256OfNostrBuildGif(gif)).toBe(hash);
    expect(imetaFromNostrBuildGif(gif)).toContain(`x ${hash}`);
  });

  it('imeta includes required fields and omits empty alt/size', () => {
    const gif: NostrBuildGif = {
      id: 'abc.gif',
      url: 'https://gifs.nostr.build/abc.gif',
      width: 224,
      height: 126,
      bytes: 806309,
      format: 'gif',
      title: 'Giant wave',
      mp4: 'https://gifs.nostr.build/mp4/orig/abc.gif'
    };
    const tag = imetaFromNostrBuildGif(gif);
    expect(tag[0]).toBe('imeta');
    expect(tag).toContain('url https://gifs.nostr.build/abc.gif');
    expect(tag).toContain('m image/gif');
    expect(tag).toContain('dim 224x126');
    expect(tag).toContain('size 806309');
    expect(tag).toContain('alt Giant wave');

    const bare: NostrBuildGif = {
      ...gif,
      title: '  ',
      bytes: null
    };
    const bareTag = imetaFromNostrBuildGif(bare);
    expect(bareTag.some((p) => p.startsWith('size '))).toBe(false);
    expect(bareTag.some((p) => p.startsWith('alt '))).toBe(false);
  });

  it('tidySuggestTerms prefers non-fuzzy and drops the query itself', () => {
    const out = tidySuggestTerms(
      [
        { term: 'gm', n: 1 },
        { term: 'Good Morning', fuzzy: true, n: 2 },
        { term: 'good morning', n: 3 },
        { term: 'Good Morning', n: 4 }
      ],
      'gm'
    );
    expect(out.map((t) => t.term.toLowerCase())).toEqual(['good morning']);
  });

  it('dedupeNostrBuildGifs collapses same URL and same sha256', () => {
    const hash = 'ef'.repeat(32);
    const a: NostrBuildGif = {
      id: `${hash}.gif`,
      url: `https://gifs.nostr.build/${hash}.gif`,
      width: 1,
      height: 1,
      mp4: `https://gifs.nostr.build/mp4/orig/${hash}.gif`,
      title: 'first'
    };
    const b: NostrBuildGif = {
      ...a,
      url: `https://gifs.nostr.build/${hash}.gif/`,
      title: 'dup-url'
    };
    const c: NostrBuildGif = {
      id: `${hash}.webp`,
      url: `https://gifs.nostr.build/cdn/${hash}.webp`,
      width: 2,
      height: 2,
      mp4: a.mp4,
      title: 'dup-hash'
    };
    const out = dedupeNostrBuildGifs([a, b, c]);
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe('first');
  });
});
