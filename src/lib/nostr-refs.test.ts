import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  expandNostrRefPlaceholders,
  nostrRefPlaceholder,
  protectNostrRefsForMarkup,
  splitNostrRefs
} from './nostr-refs';

describe('protectNostrRefsForMarkup', () => {
  it('keeps AsciiDoc listing blocks intact around citation nevents', () => {
    const pk = '1'.repeat(64);
    const id = '2'.repeat(64);
    const nevent = nip19.neventEncode({ id, author: pk });
    const content = [
      '== Citations',
      '',
      '[source, json]',
      '----',
      '{ "kind": 32 }',
      '----',
      '',
      `Example: [[citation::end::${nevent}]]`,
      '',
      '*Markup Scheme*',
      '',
      '[source, json]',
      '----',
      '{ "kind": 33 }',
      '----'
    ].join('\n');

    const { text, refs } = protectNostrRefsForMarkup(content);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.kind).toBe('nevent');
    expect(text).toContain(nostrRefPlaceholder(0));
    expect(text).toContain('[source, json]');
    expect(text).toContain('----');
    expect(text).toContain('{ "kind": 32 }');
    expect(text).toContain('{ "kind": 33 }');
    expect(text).not.toContain(nevent);
    // One contiguous document — both fences still present for a single AsciiDoc pass.
    expect(text.match(/----/g)?.length).toBe(4);
  });

  it('does not double-match a nevent already covered by a citation macro', () => {
    const id = '3'.repeat(64);
    const nevent = nip19.neventEncode({ id });
    const { refs } = protectNostrRefsForMarkup(`see [[citation::inline::nostr:${nevent}]] please`);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.raw).toContain('citation::');
  });

  it('leaves npub/naddr intact inside AsciiDoc URL macros', () => {
    const npub = nip19.npubEncode('a'.repeat(64));
    const naddr = nip19.naddrEncode({
      kind: 30040,
      pubkey: 'b'.repeat(64),
      identifier: 'doc'
    });
    const content = [
      `We can be contacted over our https://njump.me/${npub}[project npub]: nostr:${npub}`,
      '',
      `The https://gitcitadel.com/r/${naddr}[GitCitadel repo] is for general questions.`
    ].join('\n');
    const { text, refs } = protectNostrRefsForMarkup(content);
    expect(text).toContain(`https://njump.me/${npub}[project npub]`);
    expect(text).toContain(`https://gitcitadel.com/r/${naddr}[GitCitadel repo]`);
    expect(text).toContain(nostrRefPlaceholder(0));
    expect(refs).toHaveLength(1);
    expect(refs[0]?.kind).toBe('npub');
    expect(refs[0]?.raw.toLowerCase()).toContain('nostr:');
  });

  it('round-trips placeholders after render', () => {
    const id = '4'.repeat(64);
    const nevent = nip19.neventEncode({ id });
    const { text, refs } = protectNostrRefsForMarkup(`before [[citation::quote::${nevent}]] after`);
    const fakeHtml = `<p>${text}</p>`;
    const parts = expandNostrRefPlaceholders(fakeHtml, refs);
    expect(parts[0]).toEqual({ type: 'html', html: '<p>before ' });
    expect(parts[1]?.type).toBe('ref');
    expect(parts[2]).toEqual({ type: 'html', html: ' after</p>' });
  });
});

describe('splitNostrRefs', () => {
  it('still splits bare nostr:npub for note-style bodies', () => {
    const npub = nip19.npubEncode('a'.repeat(64));
    const parts = splitNostrRefs(`hi nostr:${npub} there`);
    expect(parts).toHaveLength(3);
    expect(parts[1]?.type).toBe('ref');
  });
});
