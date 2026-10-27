/**
 * Compatibility: former split-publish tests live in publication-publish-pipeline.test.ts
 * and publication-publish.test.ts. Keep this file as a thin re-export smoke check.
 */
import { describe, expect, it } from 'vitest';
import {
  publishPublicationSplit,
  retryPublicationSplitEvents,
  verifyEventOnRelays
} from './publication-split-publish';

describe('publication-split-publish re-exports', () => {
  it('exposes the public API', () => {
    expect(typeof publishPublicationSplit).toBe('function');
    expect(typeof retryPublicationSplitEvents).toBe('function');
    expect(typeof verifyEventOnRelays).toBe('function');
  });
});
