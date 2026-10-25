import {
  getKind,
  kindPickerLabel,
  kindsWrittenBy,
} from '@silberengel/kind-compose-catalog';
import { resolveMarkup } from './markup';

export const COMPOSE_DOCUMENT_PRESETS = [30040, 30818, 30817, 30023, 1, 30041] as const;
export const COMPOSE_METADATA_KINDS = [0, 30315, 10133, 10002, 10006, 10012, 10243] as const;
/** Action / context kinds composed elsewhere — not offered in the picker. */
export const COMPOSE_PICKER_EXCLUDED = [5, 7, 819, 1621, 1985, 16375, 30045, 34259] as const;
export const OTHER_KIND_SENTINEL = -1;

export type ComposePickerGroup = {
  id: 'documents' | 'metadata' | 'other';
  label: string;
  kinds: number[];
};

const METADATA_SET = new Set<number>(COMPOSE_METADATA_KINDS);

export function composePickerGroups(): ComposePickerGroup[] {
  const alexandriaKinds = kindsWrittenBy('alexandria');
  const excluded = new Set<number>([
    ...COMPOSE_DOCUMENT_PRESETS,
    ...COMPOSE_METADATA_KINDS,
    ...COMPOSE_PICKER_EXCLUDED
  ]);
  const otherKinds = alexandriaKinds.filter((k) => !excluded.has(k));

  return [
    {
      id: 'documents',
      label: 'Documents',
      kinds: [...COMPOSE_DOCUMENT_PRESETS],
    },
    {
      id: 'metadata',
      label: 'Metadata',
      kinds: [...COMPOSE_METADATA_KINDS],
    },
    {
      id: 'other',
      label: 'Other',
      kinds: otherKinds,
    },
  ];
}

export function isMetadataComposeKind(kind: number): boolean {
  return METADATA_SET.has(kind);
}

export function hasContentField(kind: number): boolean {
  return getKind(kind)?.content?.encoding !== 'empty';
}

/** Body textarea — hide for empty encoding and kind-0 JSON (fields own the body). */
export function showContentBox(kind: number): boolean {
  const encoding = getKind(kind)?.content?.encoding;
  if (!encoding || encoding === 'empty' || encoding === 'json') return false;
  return true;
}

/**
 * Djot or AsciiDoc for this compose body.
 * Plaintext kinds stay on the normal editor (NostrRichText).
 */
export function composeMarkupFormat(
  kind: number,
  content = '',
  tags?: string[][]
): 'djot' | 'asciidoc' | null {
  const format = resolveMarkup(kind, content, tags);
  if (format === 'plaintext') return null;
  return format;
}

export function composeKindLabel(kind: number): string {
  return kindPickerLabel(kind);
}
