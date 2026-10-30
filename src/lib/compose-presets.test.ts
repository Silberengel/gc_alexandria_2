import { describe, expect, it } from 'vitest';
import { KIND } from './constants';
import {
  COMPOSE_DOCUMENT_PRESETS,
  COMPOSE_METADATA_KINDS,
  COMPOSE_PICKER_EXCLUDED,
  composeGrammarEligible,
  composeMarkupFormat,
  composePickerGroups,
  isMetadataComposeKind,
  showContentBox,
} from './compose-presets';

describe('composePickerGroups', () => {
  it('lists document presets first and includes metadata kinds', () => {
    const groups = composePickerGroups();
    expect(groups[0]?.id).toBe('documents');
    expect(groups[0]?.kinds).toEqual([...COMPOSE_DOCUMENT_PRESETS].sort((a, b) => a - b));
    const metadata = groups.find((g) => g.id === 'metadata');
    expect(metadata?.kinds).toEqual([...COMPOSE_METADATA_KINDS].sort((a, b) => a - b));
    for (const kind of COMPOSE_METADATA_KINDS) {
      expect(isMetadataComposeKind(kind)).toBe(true);
    }
  });

  it('orders every section by ascending kind number', () => {
    for (const group of composePickerGroups()) {
      expect(group.kinds).toEqual([...group.kinds].sort((a, b) => a - b));
    }
    expect(composePickerGroups()[0]?.kinds[0]).toBe(1);
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

  it('offers the markup editor for djot and asciidoc, not plaintext notes', () => {
    expect(composeMarkupFormat(KIND.TEXT_NOTE, 'Hello **note**.')).toBeNull();
    expect(composeMarkupFormat(KIND.COMMENT, 'A comment')).toBeNull();
    expect(composeMarkupFormat(KIND.LONG_FORM, '# Chapter')).toBe('djot');
    expect(composeMarkupFormat(KIND.WIKI, 'A short wiki paragraph.')).toBe('djot');
    expect(composeMarkupFormat(KIND.SPEC, '= Looks like AsciiDoc')).toBe('djot');
    expect(composeMarkupFormat(KIND.SECTION, '= Chapter\n\nHello.')).toBe('asciidoc');
    expect(composeMarkupFormat(KIND.WIKI, '= Title\n\n== Section\n\nSome body.\n')).toBe(
      'asciidoc'
    );
    expect(composeMarkupFormat(KIND.PUBLICATION, '')).toBeNull();
  });

  it('omits reaction/deletion/rating-style kinds from the picker', () => {
    const listed = new Set(composePickerGroups().flatMap((g) => g.kinds));
    for (const kind of COMPOSE_PICKER_EXCLUDED) {
      expect(listed.has(kind)).toBe(false);
    }
  });

  it('offers the draft relay list in metadata and hides live chat / presence', () => {
    const listed = new Set(composePickerGroups().flatMap((g) => g.kinds));
    expect(COMPOSE_METADATA_KINDS).toContain(KIND.PRIVATE_RELAY_LIST);
    expect(listed.has(KIND.PRIVATE_RELAY_LIST)).toBe(true);
    expect(listed.has(KIND.LIVE_CHAT)).toBe(false);
    expect(listed.has(KIND.ROOM_PRESENCE)).toBe(false);
    expect(listed.has(KIND.DRAFT_WRAP)).toBe(false);
    expect(listed.has(KIND.DRAFT_CHECKPOINT)).toBe(false);
  });

  it('offers follow and mute lists under metadata', () => {
    const listed = new Set(composePickerGroups().flatMap((g) => g.kinds));
    expect(COMPOSE_METADATA_KINDS).toContain(KIND.CONTACT_LIST);
    expect(COMPOSE_METADATA_KINDS).toContain(KIND.MUTE);
    expect(listed.has(KIND.CONTACT_LIST)).toBe(true);
    expect(listed.has(KIND.MUTE)).toBe(true);
  });

  it('offers directories under documents', () => {
    const listed = new Set(composePickerGroups().flatMap((g) => g.kinds));
    expect(COMPOSE_DOCUMENT_PRESETS).toContain(KIND.DIRECTORY);
    expect(listed.has(KIND.DIRECTORY)).toBe(true);
    expect(COMPOSE_PICKER_EXCLUDED).not.toContain(KIND.DIRECTORY);
  });

  it('hides the body box for NIP-51 lists (private ciphertext is not freeform content)', () => {
    expect(showContentBox(KIND.MUTE)).toBe(false);
    expect(showContentBox(KIND.CONTACT_LIST)).toBe(false);
    expect(showContentBox(10013)).toBe(false);
    expect(showContentBox(KIND.DIRECTORY)).toBe(false);
    expect(showContentBox(KIND.READING_QUEUE)).toBe(false);
    expect(showContentBox(KIND.TEXT_NOTE)).toBe(true);
  });

  it('enables grammar for freeform bodies and not for encrypted/list composers', () => {
    expect(composeGrammarEligible(KIND.TEXT_NOTE)).toBe(true);
    expect(composeGrammarEligible(KIND.COMMENT)).toBe(true);
    expect(composeGrammarEligible(KIND.LONG_FORM)).toBe(true);
    expect(composeGrammarEligible(KIND.ISSUE)).toBe(true);
    expect(composeGrammarEligible(null)).toBe(true);
    expect(composeGrammarEligible(KIND.MUTE)).toBe(false);
    expect(composeGrammarEligible(KIND.CONTACT_LIST)).toBe(false);
    expect(composeGrammarEligible(KIND.DIRECTORY)).toBe(false);
    expect(composeGrammarEligible(KIND.READING_QUEUE)).toBe(false);
    expect(composeGrammarEligible(10013)).toBe(false);
  });
});
