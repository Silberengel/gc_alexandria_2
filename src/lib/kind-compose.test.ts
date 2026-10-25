import { describe, expect, it } from 'vitest';
import {
  assertReadyToSign,
  buildTagsForKind,
  composeKindsForApp,
  validateCompose,
} from './kind-compose';

describe('kind-compose catalog wiring', () => {
  it('exposes alexandria compose kinds including highlights', () => {
    const kinds = composeKindsForApp('alexandria');
    expect(kinds).toContain(9802);
  });

  it('validateCompose rejects highlight text missing from context', () => {
    const result = validateCompose(9802, {
      content: 'missing',
      values: { context: 'other passage' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.toLowerCase()).toContain('context');
    }
  });

  it('assertReadyToSign accepts a minimal catalogued note', () => {
    const result = assertReadyToSign({
      kind: 1,
      content: 'hello',
      tags: [['t', 'nostr']],
    });
    expect(result.ok).toBe(true);
  });

  it('buildTagsForKind emits publication d/title', () => {
    const tags = buildTagsForKind(
      30040,
      { title: 'Guide', publication_author: 'Author', publication_type: 'book' },
      { app: 'alexandria' }
    );
    expect(tags.some((t) => t[0] === 'title' && t[1] === 'Guide')).toBe(true);
    expect(tags.some((t) => t[0] === 'd')).toBe(true);
  });
});
