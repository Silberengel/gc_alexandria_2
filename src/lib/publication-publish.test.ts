import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';

vi.mock('./nostr/pool', () => ({
  relayPool: { query: vi.fn() }
}));

vi.mock('./nostr/selector', () => ({
  documentStack: vi.fn(() => ['wss://doc.example']),
  writeStack: vi.fn(() => ['wss://write.example'])
}));

vi.mock('./sign', () => ({
  withClientTag: (tags: string[][]) => tags,
  publishSigned: vi.fn(async () => true),
  signUnsigned: vi.fn(),
  consumeSignFailure: vi.fn(() => null)
}));

vi.mock('./nostr/event-memory', () => ({
  rememberEvents: vi.fn()
}));

import { signUnsigned } from './sign';
import { publishPublicationEvent, publishPublicationSplit } from './publication-publish';

describe('publishPublicationSplit gates', () => {
  beforeEach(() => {
    vi.mocked(signUnsigned).mockReset();
  });

  it('rejects empty source without signing', async () => {
    const result = await publishPublicationSplit({
      source: '   ',
      maxIndexLevel: 2,
      form: { kind: KIND.PUBLICATION, content: '', values: { title: 'Book', d: 'book' } }
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/empty/i);
    expect(signUnsigned).not.toHaveBeenCalled();
  });

  it('rejects when there are no == chapters', async () => {
    const result = await publishPublicationSplit({
      source: 'Just a paragraph.\n',
      maxIndexLevel: 2,
      form: { kind: KIND.PUBLICATION, content: '', values: { title: 'Book', d: 'book' } }
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/chapter/i);
    expect(signUnsigned).not.toHaveBeenCalled();
  });

  it('rejects oversize leaves without signing', async () => {
    const big = `${'word '.repeat(12_000)}\n\n${'more '.repeat(12_000)}`;
    const result = await publishPublicationSplit({
      source: `== Huge\n\n${big}\n`,
      maxIndexLevel: 2,
      form: { kind: KIND.PUBLICATION, content: '', values: { title: 'Book', d: 'book' } }
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Ideal split/i);
    expect(signUnsigned).not.toHaveBeenCalled();
  });
});

describe('publishPublicationEvent', () => {
  beforeEach(() => {
    vi.mocked(signUnsigned).mockReset();
  });

  it('rejects non-publication kinds', async () => {
    const result = await publishPublicationEvent({
      form: { kind: 1, content: 'hi', values: {} }
    });
    expect(result.ok).toBe(false);
    expect(signUnsigned).not.toHaveBeenCalled();
  });

  it('publishes a section through the pipeline', async () => {
    const signed = {
      id: '44'.repeat(32),
      pubkey: 'ab'.repeat(32),
      created_at: 1,
      kind: KIND.SECTION,
      tags: [
        ['d', 'sec'],
        ['title', 'Sec']
      ],
      content: 'body',
      sig: '00'
    } satisfies Event;
    vi.mocked(signUnsigned).mockResolvedValueOnce(signed);
    const { relayPool } = await import('./nostr/pool');
    vi.mocked(relayPool.query).mockResolvedValue([signed]);

    const result = await publishPublicationEvent({
      form: {
        kind: KIND.SECTION,
        content: 'body',
        values: { title: 'Sec', d: 'sec' }
      }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.root.id).toBe(signed.id);
    expect(signUnsigned).toHaveBeenCalled();
  });
});
