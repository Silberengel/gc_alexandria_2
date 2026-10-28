import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND, NIP32_BOOKLIST_LABEL, NIP32_UGC_NAMESPACE } from './constants';
import {
  myPublicationListLabels,
  suggestedBookshelfFolderNames,
  suggestedPublicationLabels
} from './publication-lists';

function labelEv(slug: string, over: Partial<Event> = {}): Event {
  return {
    id: over.id ?? slug.padEnd(64, '0').slice(0, 64),
    pubkey: over.pubkey ?? 'a'.repeat(64),
    created_at: over.created_at ?? 1,
    kind: KIND.LABEL,
    tags: [
      ['L', NIP32_UGC_NAMESPACE],
      ['l', slug, NIP32_UGC_NAMESPACE],
      ['a', `30040:${'b'.repeat(64)}:book`]
    ],
    content: '',
    sig: 'c'.repeat(128)
  };
}

function dirEv(d: string, over: Partial<Event> = {}): Event {
  return {
    id: over.id ?? d.padEnd(64, '1').slice(0, 64),
    pubkey: over.pubkey ?? 'a'.repeat(64),
    created_at: over.created_at ?? 1,
    kind: KIND.DIRECTORY,
    tags: [['d', d]],
    content: '',
    sig: 'c'.repeat(128)
  };
}

describe('myPublicationListLabels', () => {
  it('returns the viewer’s distinct list slugs alphabetically', () => {
    expect(
      myPublicationListLabels([
        labelEv(NIP32_BOOKLIST_LABEL),
        labelEv('theology'),
        labelEv('adventure'),
        labelEv('Alchemy')
      ])
    ).toEqual([
      { slug: 'adventure', title: 'Adventure' },
      { slug: 'alchemy', title: 'Alchemy' },
      { slug: 'theology', title: 'theology' }
    ]);
  });

  it('ignores labels that do not target a 30040 address', () => {
    const wikiOnly: Event = {
      ...labelEv('wiki-tag'),
      tags: [
        ['L', NIP32_UGC_NAMESPACE],
        ['l', 'wiki-tag', NIP32_UGC_NAMESPACE],
        ['a', `30023:${'b'.repeat(64)}:post`]
      ]
    };
    expect(myPublicationListLabels([wikiOnly, labelEv('kept')])).toEqual([
      { slug: 'kept', title: 'kept' }
    ]);
  });
});

describe('suggestedPublicationLabels', () => {
  it('returns distinct 30040 list labels alphabetically and skips reserved slugs', () => {
    const names = suggestedPublicationLabels([
      labelEv(NIP32_BOOKLIST_LABEL),
      labelEv('Zoroastrian'),
      labelEv('alchemy'),
      labelEv('Alchemy'),
      labelEv('theology'),
      {
        ...labelEv('nope'),
        tags: [
          ['L', NIP32_UGC_NAMESPACE],
          ['l', 'nope', NIP32_UGC_NAMESPACE],
          ['e', 'd'.repeat(64)]
        ]
      }
    ]);
    expect(names).toEqual(['alchemy', 'theology', 'Zoroastrian']);
  });

  it('honors an exclude set', () => {
    expect(
      suggestedPublicationLabels([labelEv('alchemy'), labelEv('theology')], ['alchemy'])
    ).toEqual(['theology']);
  });
});

describe('suggestedBookshelfFolderNames', () => {
  it('returns other 30045 d-tags and skips home folders', () => {
    expect(
      suggestedBookshelfFolderNames([
        dirEv('root'),
        dirEv('my-book-collection'),
        dirEv('patristics'),
        dirEv('Patristics'),
        dirEv('desert-fathers')
      ])
    ).toEqual(['desert-fathers', 'patristics']);
  });

  it('honors exclude', () => {
    expect(
      suggestedBookshelfFolderNames([dirEv('patristics'), dirEv('liturgy')], ['patristics'])
    ).toEqual(['liturgy']);
  });
});
