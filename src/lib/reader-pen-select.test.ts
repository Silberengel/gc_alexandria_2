import { describe, expect, it } from 'vitest';
import { attachReaderPenSelect } from './reader-pen-select';

describe('attachReaderPenSelect', () => {
  it('exports an attach helper', () => {
    expect(typeof attachReaderPenSelect).toBe('function');
  });
});
