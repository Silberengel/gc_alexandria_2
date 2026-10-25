import { describe, expect, it } from 'vitest';
import { buildTagsForKind } from '@silberengel/kind-compose-catalog';
import {
  formatPaytoRows,
  parsePaytoLine,
  paytoRowsFromRaw,
  paytoSelectValue
} from './compose-payto';

describe('compose-payto', () => {
  it('parses type+authority and payto URIs', () => {
    expect(parsePaytoLine('lightning ada@example.com')).toEqual({
      type: 'lightning',
      authority: 'ada@example.com'
    });
    expect(parsePaytoLine('payto://bitcoin/bc1qxy')).toEqual({
      type: 'bitcoin',
      authority: 'bc1qxy'
    });
  });

  it('maps unknown types to other for the dropdown', () => {
    expect(paytoSelectValue('lightning')).toBe('lightning');
    expect(paytoSelectValue('iban')).toBe('other');
  });

  it('emits payto tags from editor rows', () => {
    const raw = formatPaytoRows([
      { type: 'lightning', authority: 'a@b.com' },
      { type: 'monero', authority: '4abc' }
    ]);
    expect(paytoRowsFromRaw(raw)).toEqual([
      { type: 'lightning', authority: 'a@b.com' },
      { type: 'monero', authority: '4abc' }
    ]);
    const tags = buildTagsForKind(10133, { payto: raw }, { app: 'alexandria' });
    expect(tags).toContainEqual(['payto', 'lightning', 'a@b.com']);
    expect(tags).toContainEqual(['payto', 'monero', '4abc']);
  });
});
