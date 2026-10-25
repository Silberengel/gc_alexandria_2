import { describe, expect, it } from 'vitest';
import { buildTagsForKind } from '@silberengel/kind-compose-catalog';
import {
  formatSpecKindRows,
  parseSpecKindLine,
  specKindRowsFromRaw
} from './compose-spec-kinds';

describe('compose-spec-kinds', () => {
  it('parses kind-only and kind+name lines', () => {
    expect(parseSpecKindLine('1111')).toEqual({ kind: '1111', name: '' });
    expect(parseSpecKindLine('30100 Game Session')).toEqual({
      kind: '30100',
      name: 'Game Session'
    });
    expect(parseSpecKindLine('30100,Game Session')).toEqual({
      kind: '30100',
      name: 'Game Session'
    });
  });

  it('round-trips editor rows into k tags', () => {
    const raw = formatSpecKindRows([
      { kind: '1111', name: '' },
      { kind: '30100', name: 'Game Session' }
    ]);
    expect(specKindRowsFromRaw(raw)).toEqual([
      { kind: '1111', name: '' },
      { kind: '30100', name: 'Game Session' }
    ]);
    const tags = buildTagsForKind(
      30817,
      { title: 'Spec', d: 'my-spec', spec_kinds: raw },
      { app: 'alexandria' }
    );
    expect(tags).toContainEqual(['k', '1111']);
    expect(tags).toContainEqual(['k', '30100', 'Game Session']);
  });
});
