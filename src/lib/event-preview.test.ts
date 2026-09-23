import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { eventPreview } from './event-preview';
import { kindDescription, kindLabelLine } from './kind-label';

function ev(partial: Partial<Event> & Pick<Event, 'kind' | 'pubkey'>): Event {
  return {
    id: 'ab'.repeat(32),
    created_at: 1,
    tags: [],
    content: '',
    sig: 'cd'.repeat(64),
    ...partial
  };
}

describe('kindDescription', () => {
  it('labels known and unknown kinds', () => {
    expect(kindDescription(1)).toBe('Short text note');
    expect(kindDescription(99999)).toBe('Event (kind 99999)');
    expect(kindLabelLine(1)).toBe('KIND: 1 · Short text note');
  });
});

describe('eventPreview', () => {
  it('uses title tags for headline and keeps content in the body', () => {
    const preview = eventPreview(
      ev({
        kind: 1,
        pubkey: 'aa'.repeat(32),
        tags: [['title', 'Gift card guide'], ['t', 'lnurl']],
        content: 'A longer body that explains LNURL vouchers in detail.'
      })
    );
    expect(preview.headline).toBe('Gift card guide');
    expect(preview.topics).toEqual(['lnurl']);
    expect(preview.body).toContain('LNURL');
  });

  it('does not promote content into the title', () => {
    const fromContent = eventPreview(
      ev({
        kind: 1,
        pubkey: 'aa'.repeat(32),
        content: 'Do you know of another lightning wallet that allows you to tip?'
      })
    );
    expect(fromContent.headline).toBe('Short text note');
    expect(fromContent.body?.startsWith('Do you know')).toBe(true);

    const empty = eventPreview(ev({ kind: 42, pubkey: 'aa'.repeat(32) }));
    expect(empty.headline).toBe('Event (kind 42)');
    expect(empty.body).toBeUndefined();
  });

  it('never shows stringified JSON as body or headline', () => {
    const meta = eventPreview(
      ev({
        kind: 0,
        pubkey: 'aa'.repeat(32),
        content: JSON.stringify({
          name: 'Indonesia Bitcoin Conference',
          about: 'Annual conference in Jakarta',
          banner: 'https://example.com/b.jpg',
          website: 'https://example.com'
        })
      })
    );
    expect(meta.headline).toBe(kindDescription(0));
    expect(meta.body).toContain('Annual conference');
    expect(meta.body).not.toContain('{');
    expect(meta.headline).not.toContain('{');

    const other = eventPreview(
      ev({
        kind: 30078,
        pubkey: 'aa'.repeat(32),
        content: '{"foo":1,"bar":"https://cdn.example/x.png"}'
      })
    );
    expect(other.body ?? '').not.toContain('{');
    expect(other.headline).not.toMatch(/^\{/);
  });

  it('keeps title and body as plaintext with length caps', () => {
    const preview = eventPreview(
      ev({
        kind: 30023,
        pubkey: 'aa'.repeat(32),
        tags: [['title', `= ${'Very Long Markdown **Title** Piece '.repeat(6)}`]],
        content: '= Heading\n\nimage::https://example.com/x.png[Alt]\n' + 'word '.repeat(80)
      })
    );
    expect(preview.headline).not.toMatch(/^\s*=/);
    expect(preview.headline).not.toContain('**');
    expect(preview.headline).not.toContain('image::');
    expect(preview.headline.length).toBeLessThanOrEqual(101);
    expect(preview.body ?? '').not.toMatch(/image::|^=/m);
    expect((preview.body ?? '').length).toBeLessThanOrEqual(251);
  });
});
