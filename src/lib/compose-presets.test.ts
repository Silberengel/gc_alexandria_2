import { describe, expect, it } from 'vitest';
import {
  COMPOSE_DOCUMENT_PRESETS,
  COMPOSE_METADATA_KINDS,
  COMPOSE_PICKER_EXCLUDED,
  composePickerGroups,
  isMetadataComposeKind,
} from './compose-presets';

describe('composePickerGroups', () => {
  it('lists document presets first and includes metadata kinds', () => {
    const groups = composePickerGroups();
    expect(groups[0]?.id).toBe('documents');
    expect(groups[0]?.kinds).toEqual([...COMPOSE_DOCUMENT_PRESETS]);
    const metadata = groups.find((g) => g.id === 'metadata');
    expect(metadata?.kinds).toEqual([...COMPOSE_METADATA_KINDS]);
    for (const kind of COMPOSE_METADATA_KINDS) {
      expect(isMetadataComposeKind(kind)).toBe(true);
    }
  });

  it('puts remaining alexandria write kinds in other without duplicating presets', () => {
    const groups = composePickerGroups();
    const other = groups.find((g) => g.id === 'other');
    expect(other).toBeDefined();
    const presetSet = new Set<number>(COMPOSE_DOCUMENT_PRESETS);
    const metaSet = new Set<number>(COMPOSE_METADATA_KINDS);
    const excluded = new Set<number>(COMPOSE_PICKER_EXCLUDED);
    for (const kind of other!.kinds) {
      expect(presetSet.has(kind)).toBe(false);
      expect(metaSet.has(kind)).toBe(false);
      expect(excluded.has(kind)).toBe(false);
    }
  });

  it('omits reaction/deletion/rating-style kinds from the picker', () => {
    const listed = new Set(composePickerGroups().flatMap((g) => g.kinds));
    for (const kind of COMPOSE_PICKER_EXCLUDED) {
      expect(listed.has(kind)).toBe(false);
    }
  });
});
