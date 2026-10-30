import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  coalesceInlineMentions,
  coalescePlainMentionFlows,
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
    expect(refs[0]?.citationMode).toBe('inline');
    expect(refs[0]?.presentation).toBe('inline');
  });

  it('maps citation modes to presentation', () => {
    const id = '7'.repeat(64);
    const nevent = nip19.neventEncode({ id });
    const quote = protectNostrRefsForMarkup(`[[citation::quote::${nevent}]]`);
    expect(quote.refs[0]?.citationMode).toBe('quote');
    expect(quote.refs[0]?.presentation).toBe('block');
    const foot = protectNostrRefsForMarkup(`[[citation::foot::${nevent}]]`);
    expect(foot.refs[0]?.citationMode).toBe('foot');
    expect(foot.refs[0]?.presentation).toBe('block');
    const footEnd = protectNostrRefsForMarkup(`[[citation::foot-end::${nevent}]]`);
    expect(footEnd.refs[0]?.citationMode).toBe('foot-end');
    expect(footEnd.refs[0]?.presentation).toBe('block');
    const prompt = protectNostrRefsForMarkup(`[[citation::prompt-inline::${nevent}]]`);
    expect(prompt.refs[0]?.citationMode).toBe('prompt-inline');
    expect(prompt.refs[0]?.presentation).toBe('inline');
  });

  it('keeps citation inline macros inside a flow sentence', () => {
    const id = '8'.repeat(64);
    const nevent = nip19.neventEncode({ id });
    const { text, refs } = protectNostrRefsForMarkup(`see [[citation::inline::${nevent}]] here`);
    const parts = expandNostrRefPlaceholders(`<p>${text}</p>`, refs);
    const blocks = coalesceInlineMentions(parts);
    const flow = blocks.find((b) => b.type === 'flow');
    expect(flow?.type).toBe('flow');
    if (flow?.type === 'flow') {
      expect(flow.parts.some((p) => p.type === 'citation')).toBe(true);
    }
  });

  it('peels nostrdown {{ref:nevent|label}} as an inline labeled link, not a bare embed', () => {
    const id = '5'.repeat(64);
    const nevent = nip19.neventEncode({ id });
    const body = `essay called Knowledge. {{ref:${nevent}|Anarchistic Knowledge}} It argues.`;
    const { text, refs } = protectNostrRefsForMarkup(body);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.presentation).toBe('inline');
    expect(refs[0]?.displayLabel).toBe('Anarchistic Knowledge');
    expect(refs[0]?.kind).toBe('nevent');
    expect(text).toContain(nostrRefPlaceholder(0));
    expect(text).not.toContain(nevent);
    expect(text).not.toContain('{{ref:');
  });

  it('treats nostrdown {{embed:nevent}} as a block card', () => {
    const id = '6'.repeat(64);
    const nevent = nip19.neventEncode({ id });
    const { refs } = protectNostrRefsForMarkup(`See {{embed:${nevent}}} below.`);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.presentation).toBe('block');
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

describe('coalesceInlineMentions', () => {
  it('keeps an npub inside the surrounding sentence', () => {
    const blocks = coalesceInlineMentions([
      { type: 'html', html: '<p>Hey, checkout what ' },
      {
        type: 'ref',
        kind: 'npub',
        raw: 'nostr:npub1',
        bech32: 'npub1',
        pubkey: 'a'.repeat(64)
      },
      { type: 'html', html: ' is building.</p><p>Next.</p>' }
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      type: 'flow',
      parts: [
        { type: 'html', html: 'Hey, checkout what ' },
        { type: 'mention', pubkey: 'a'.repeat(64) },
        { type: 'html', html: ' is building.' }
      ]
    });
    expect(blocks[1]).toEqual({ type: 'html', html: '<p>Next.</p>' });
  });
});

describe('coalescePlainMentionFlows', () => {
  it('keeps plaintext npub mentions on the same line as surrounding words', () => {
    const npub = nip19.npubEncode('a'.repeat(64));
    const parts = splitNostrRefs(`over at nostr:${npub} \nhttps://cdn.example/x.gif`);
    const blocks = coalescePlainMentionFlows(parts);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('flow');
    if (blocks[0]?.type !== 'flow') return;
    expect(blocks[0].parts).toEqual([
      { type: 'text', text: 'over at ' },
      { type: 'mention', pubkey: 'a'.repeat(64) },
      { type: 'text', text: ' \nhttps://cdn.example/x.gif' }
    ]);
  });
});

describe('splitNostrRefs', () => {
  it('still splits bare nostr:npub for note-style bodies', () => {
    const npub = nip19.npubEncode('a'.repeat(64));
    const parts = splitNostrRefs(`hi nostr:${npub} there`);
    expect(parts).toHaveLength(3);
    expect(parts[1]?.type).toBe('ref');
  });

  it('does not tear hash-router URLs that embed an npub in the path', () => {
    const npub = nip19.npubEncode('a'.repeat(64));
    const url =
      `https://gc-alexandria.imwald.eu/#/publication/d/bible/p/${npub}?read=1&book=matthew&chapter=22`;
    const parts = splitNostrRefs(`See\n\n${url}\n\nDone.`);
    expect(parts).toEqual([
      { type: 'text', text: `See\n\n${url}\n\nDone.` }
    ]);
  });

  it('trims blank lines glued to block embeds', () => {
    const note = nip19.noteEncode('b'.repeat(64));
    const parts = splitNostrRefs(`Hello everyone\n\nnostr:${note}\n\nMore.`);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ type: 'text', text: 'Hello everyone' });
    expect(parts[1]?.type).toBe('ref');
    expect(parts[2]).toEqual({ type: 'text', text: 'More.' });
  });
});

describe('expandNostrRefPlaceholders', () => {
  it('strips empty paragraphs glued to block embeds', () => {
    const id = 'c'.repeat(64);
    const note = nip19.noteEncode(id);
    const ref = splitNostrRefs(`nostr:${note}`)[0];
    expect(ref?.type).toBe('ref');
    if (ref?.type !== 'ref') return;
    const segs = expandNostrRefPlaceholders(
      `<p>Intro</p><p></p>${nostrRefPlaceholder(0)}<p><br></p><p>Outro</p>`,
      [ref]
    );
    expect(segs).toEqual([
      { type: 'html', html: '<p>Intro</p>' },
      ref,
      { type: 'html', html: '<p>Outro</p>' }
    ]);
  });
});
