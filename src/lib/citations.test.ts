import { describe, expect, it } from 'vitest';
import {
  buildCitationPartial,
  citationMacro,
  citationModeFromMacro,
  citationModesForKind,
  formatCitationFull,
  formatCitationInline,
  parseCitationMeta
} from './citations';
import { KIND } from './constants';

describe('citationModeFromMacro', () => {
  it('normalizes known modes', () => {
    expect(citationModeFromMacro('Inline')).toBe('inline');
    expect(citationModeFromMacro('prompt-end')).toBe('prompt-end');
    expect(citationModeFromMacro('nope')).toBeUndefined();
  });
});

describe('citationModesForKind', () => {
  it('uses prompt modes for kind 33', () => {
    expect(citationModesForKind(KIND.CITATION_PROMPT)).toEqual(['prompt-end', 'prompt-inline']);
    expect(citationModesForKind(KIND.CITATION_WEB)).toContain('quote');
  });
});

describe('formatCitationInline / full', () => {
  it('formats web citation', () => {
    const meta = parseCitationMeta({
      kind: KIND.CITATION_WEB,
      content: 'Hello world',
      tags: [
        ['u', 'https://example.com'],
        ['accessed_on', '2024-06-01T12:00:00Z'],
        ['title', 'Example'],
        ['author', 'Jane Doe'],
        ['published_on', '2024-01-15']
      ]
    });
    expect(formatCitationInline(meta)).toBe('(Jane Doe, 2024)');
    expect(formatCitationFull(meta)).toContain('Jane Doe');
    expect(formatCitationFull(meta)).toContain('Example');
    expect(formatCitationFull(meta)).toContain('https://example.com');
  });

  it('formats prompt citation', () => {
    const meta = parseCitationMeta({
      kind: KIND.CITATION_PROMPT,
      content: 'Model said this',
      tags: [
        ['llm', 'ChatGPT'],
        ['accessed_on', '2023-11-01T00:00:00Z'],
        ['version', 'GPT-4']
      ]
    });
    expect(formatCitationInline(meta)).toBe('(ChatGPT, 2023)');
    expect(formatCitationFull(meta)).toContain('ChatGPT');
    expect(formatCitationFull(meta)).toContain('GPT-4');
  });
});

describe('citationMacro', () => {
  it('builds a NKBIP-03 macro', () => {
    expect(citationMacro('inline', 'nevent1abc')).toBe('[[citation::inline::nevent1abc]]');
    expect(citationMacro('end', 'nostr:nevent1abc')).toBe('[[citation::end::nevent1abc]]');
  });
});

describe('buildCitationPartial', () => {
  it('emits required web citation tags', () => {
    const partial = buildCitationPartial({
      kind: KIND.CITATION_WEB,
      content: 'Hello',
      values: {
        u: 'https://example.com/a',
        accessed_on: '2024-01-01T00:00:00Z',
        title: 'Example',
        author: 'Ada'
      }
    });
    expect(partial.kind).toBe(31);
    expect(partial.content).toBe('Hello');
    const names = partial.tags.map((t) => t[0]);
    expect(names).toEqual(expect.arrayContaining(['u', 'accessed_on', 'title', 'author']));
  });

  it('rejects non-citation kinds and incomplete forms', () => {
    expect(() =>
      buildCitationPartial({ kind: KIND.TEXT_NOTE, content: 'x', values: {} })
    ).toThrow(/Not a citation kind/);
    expect(() =>
      buildCitationPartial({
        kind: KIND.CITATION_WEB,
        content: 'Hello',
        values: { title: 'Only title' }
      })
    ).toThrow();
  });
});
