/**
 * Pure builders for NKBIP-01 publication / section event partials (no sign/publish).
 */
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import type { PublicationSplitNode } from './publication-asciidoc-split';
import { buildComposePartial, type ComposeFormState } from './compose-build';
import { withMarkupTag } from './markup';
import { withClientTag } from './sign';

export type ComposePartial = {
  kind: number;
  content: string;
  tags: string[][];
};

/** NKBIP membership `a` tag: kind:pubkey:d + event id. */
export function membershipATag(child: Event, relayHint = ''): string[] {
  const d = child.tags.find((t) => t[0] === 'd')?.[1]?.trim() ?? '';
  const coord = `${child.kind}:${child.pubkey.toLowerCase()}:${d}`;
  return ['a', coord, relayHint, child.id.toLowerCase()];
}

export function stripSectionTags(tags: string[][]): string[][] {
  return tags.filter((t) => t[0] !== 'a' && t[0] !== 'e');
}

export function ensureTitleD(tags: string[][], title: string, dTag: string): string[][] {
  const out = tags.filter((t) => t[0] !== 'title' && t[0] !== 'd');
  out.unshift(['d', dTag]);
  out.unshift(['title', title]);
  return out;
}

export function buildSectionPartial(node: PublicationSplitNode): ComposePartial {
  let tags: string[][] = [
    ['title', node.title],
    ['d', node.dTag]
  ];
  tags = withMarkupTag(tags, 'asciidoc');
  return {
    kind: KIND.SECTION,
    content: node.content,
    tags: withClientTag(tags)
  };
}

export function buildNestedIndexPartial(
  node: PublicationSplitNode,
  childEvents: Event[]
): ComposePartial {
  const tags: string[][] = [
    ['title', node.title],
    ['d', node.dTag],
    ...childEvents.map((ev) => membershipATag(ev))
  ];
  return {
    kind: KIND.PUBLICATION,
    content: '',
    tags: withClientTag(tags)
  };
}

export function buildRootPartial(
  form: ComposeFormState,
  root: PublicationSplitNode,
  childEvents: Event[]
): ComposePartial {
  const base = buildComposePartial({
    ...form,
    kind: KIND.PUBLICATION,
    content: '',
    values: { ...form.values, sections: '' }
  });
  let tags = stripSectionTags(base.tags);
  tags = ensureTitleD(tags, form.values.title?.trim() || root.title, root.dTag);
  for (const ev of childEvents) tags.push(membershipATag(ev));
  return { kind: KIND.PUBLICATION, content: '', tags: withClientTag(tags) };
}
