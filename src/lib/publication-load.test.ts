import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { enrichToc, humanizeHeading, parseToc, sectionHeading } from './publication-load';

function ev(over: Partial<Event> & { tags: string[][] }): Event {
  return {
    id: (over.id ?? 'a'.repeat(64)).toLowerCase(),
    pubkey: (over.pubkey ?? 'b'.repeat(64)).toLowerCase(),
    created_at: over.created_at ?? 1,
    kind: over.kind ?? 30041,
    tags: over.tags,
    content: over.content ?? '',
    sig: over.sig ?? 'c'.repeat(128)
  };
}

describe('sectionHeading', () => {
  it('uses title, else human T, else human d', () => {
    expect(sectionHeading(ev({ tags: [['title', 'Preface'], ['T', 'pref'], ['d', 'preface']] }))).toBe(
      'Preface'
    );
    expect(sectionHeading(ev({ tags: [['T', 'preface-to-the-fifth-edition']] }))).toBe(
      'Preface To The Fifth Edition'
    );
    expect(sectionHeading(ev({ tags: [['d', 'vii-the-charismatic-revival']] }))).toBe(
      'Vii The Charismatic Revival'
    );
  });
});

describe('parseToc', () => {
  it('humanizes a-tag d-tags when Mercury has no tree', () => {
    const pub = ev({
      kind: 30040,
      tags: [['d', 'book'], ['a', `30041:${'b'.repeat(64)}:preface-to-the-fifth-edition`]]
    });
    const toc = parseToc(null, pub);
    expect(toc[0]?.title).toBe('Preface To The Fifth Edition');
    expect(toc[0]?.address).toContain('preface-to-the-fifth-edition');
  });
});

describe('enrichToc', () => {
  it('replaces slug ToC titles with section title-tags', () => {
    const pk = 'b'.repeat(64);
    const section = ev({
      id: 'd'.repeat(64),
      tags: [
        ['d', 'preface-to-the-fifth-edition'],
        ['title', 'Preface to the Fifth Edition']
      ]
    });
    const toc = parseToc(null, ev({
      kind: 30040,
      tags: [['a', `30041:${pk}:preface-to-the-fifth-edition`]]
    }));
    expect(enrichToc(toc, [section])[0]?.title).toBe('Preface to the Fifth Edition');
    expect(enrichToc(toc, [section])[0]?.id).toBe(section.id);
  });

  it('builds a ToC from sections when none exists', () => {
    const section = ev({ tags: [['title', 'Chapter 1'], ['d', 'ch-1']] });
    expect(enrichToc([], [section])[0]?.title).toBe('Chapter 1');
  });
});

describe('humanizeHeading', () => {
  it('keeps numbered placeholders', () => {
    expect(humanizeHeading('Section 3')).toBe('Section 3');
    expect(humanizeHeading('preface')).toBe('Preface');
  });
});
