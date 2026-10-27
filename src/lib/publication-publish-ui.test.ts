import { describe, expect, it } from 'vitest';
import { KIND } from './constants';
import {
  formatPublicationMissingDTags,
  publicationPublishContinueEvents,
  publicationPublishFailureUi,
  publicationPublishRootD,
  publicationPublishRootFromEvents
} from './publication-publish-ui';

describe('publication-publish-ui', () => {
  it('formats missing d-tags for the form error suffix', () => {
    expect(formatPublicationMissingDTags([])).toBe('');
    expect(formatPublicationMissingDTags(['a', 'b'])).toBe(' Missing: a, b');
    expect(formatPublicationMissingDTags(['1', '2', '3', '4', '5', '6', '7', '8', '9'])).toBe(
      ' Missing: 1, 2, 3, 4, 5, 6, 7, 8…'
    );
  });

  it('derives root d like publishPublicationSplit (d, else title slug, else untitled)', () => {
    expect(publicationPublishRootD({ d: 'my-book', title: 'Other' })).toBe('my-book');
    expect(publicationPublishRootD({ title: 'The Castle' })).toBe('the-castle');
    expect(publicationPublishRootD({})).toBe('untitled');
  });

  it('prefers missingEvents for retry and keeps continueEvents on sign failure', () => {
    const kept = {
      id: 'aa'.repeat(32),
      pubkey: 'ab'.repeat(32),
      created_at: 1,
      kind: KIND.SECTION,
      tags: [['d', 'kept']],
      content: '',
      sig: '00'
    };
    const miss = { ...kept, id: 'bb'.repeat(32), tags: [['d', 'miss']] };
    const ui = publicationPublishFailureUi({
      ok: false,
      error: 'Could not confirm 1 event(s) on relays.',
      missingDTags: ['miss'],
      events: [kept, miss],
      missingEvents: [miss]
    });
    expect(ui.retryEvents).toEqual([miss]);
    expect(ui.continueEvents).toEqual([]);
    expect(ui.formError).toContain('Missing: miss');

    const signFail = publicationPublishFailureUi({
      ok: false,
      error: 'Could not sign “Next”.',
      missingDTags: [],
      events: [kept],
      missingEvents: [],
      canContinueSigning: true
    });
    expect(signFail.retryEvents).toEqual([]);
    expect(signFail.continueEvents).toEqual([kept]);
    expect(signFail.formError).toMatch(/publish again to continue/i);
    expect(
      publicationPublishContinueEvents({
        ok: false,
        error: 'Could not sign “Next”.',
        missingDTags: [],
        events: [kept],
        missingEvents: [],
        canContinueSigning: true
      })
    ).toEqual([kept]);
    // Root-resolution after full verify must not look like a sign-resume.
    expect(
      publicationPublishContinueEvents({
        ok: false,
        error: 'Events verified on relays, but the root publication could not be resolved.',
        missingDTags: [],
        events: [kept],
        missingEvents: []
      })
    ).toEqual([]);
  });

  it('picks the last 30040 as root (nested indexes precede root in batch order)', () => {
    const section = {
      id: '11'.repeat(32),
      pubkey: 'ab'.repeat(32),
      created_at: 1,
      kind: KIND.SECTION,
      tags: [['d', 'book-ch']],
      content: 'x',
      sig: '00'
    };
    const nested = {
      ...section,
      id: '22'.repeat(32),
      kind: KIND.PUBLICATION,
      tags: [['d', 'book-mansions']],
      content: ''
    };
    const root = {
      ...section,
      id: '33'.repeat(32),
      kind: KIND.PUBLICATION,
      tags: [['d', 'book']],
      content: ''
    };
    // Bottom-up order: section → nested index → root
    expect(publicationPublishRootFromEvents([section, nested, root])?.id).toBe(root.id);
    expect(publicationPublishRootFromEvents([section, nested, root], 'book')?.id).toBe(
      root.id
    );
    // preferredD missing from a partial batch → undefined (not nested index)
    expect(publicationPublishRootFromEvents([section, nested], 'book')).toBeUndefined();
  });
});
