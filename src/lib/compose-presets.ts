import {
  getKind,
  kindPickerLabel,
  kindsWrittenBy,
} from '@silberengel/kind-compose-catalog';
import { resolveMarkup } from './markup';

export const COMPOSE_DOCUMENT_PRESETS = [30040, 30818, 30817, 30023, 1, 30041, 30045] as const;
export const COMPOSE_METADATA_KINDS = [
  0, 3, 30315, 10133, 10000, 10002, 10006, 10012, 10013, 10243
] as const;
/** Action / context kinds composed elsewhere — not offered in the picker. */
export const COMPOSE_PICKER_EXCLUDED = [
  5, 7, 819, 1621, 1985, 16374, 34259,
  /** NIP-53 live chat / presence — composed from the live room UI. */
  1311, 10312,
  /** NIP-37 wraps/checkpoints — Save to Draft, not the picker. */
  1234, 31234
] as const;
export const OTHER_KIND_SENTINEL = -1;

export type ComposePickerGroup = {
  id: 'documents' | 'metadata' | 'other';
  label: string;
  kinds: number[];
};

const METADATA_SET = new Set<number>(COMPOSE_METADATA_KINDS);

function byKindNumber(a: number, b: number): number {
  return a - b;
}

export function composePickerGroups(): ComposePickerGroup[] {
  const alexandriaKinds = kindsWrittenBy('alexandria');
  const excluded = new Set<number>([
    ...COMPOSE_DOCUMENT_PRESETS,
    ...COMPOSE_METADATA_KINDS,
    ...COMPOSE_PICKER_EXCLUDED
  ]);
  const otherKinds = alexandriaKinds.filter((k) => !excluded.has(k)).sort(byKindNumber);

  return [
    {
      id: 'documents',
      label: 'Documents',
      kinds: [...COMPOSE_DOCUMENT_PRESETS].sort(byKindNumber),
    },
    {
      id: 'metadata',
      label: 'Metadata',
      kinds: [...COMPOSE_METADATA_KINDS].sort(byKindNumber),
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

/**
 * Whether the kind has a content slot on the wire (not encoding empty).
 * NIP-51 private ciphertext still counts — it is just not shown as a freeform body.
 */
export function hasContentField(kind: number): boolean {
  return getKind(kind)?.content?.encoding !== 'empty';
}

/**
 * Body textarea — hide for empty/json encodings and for kinds whose content is
 * app-built ciphertext (NIP-51 private tags, NIP-37 draft relays). Those still
 * publish non-empty content; the composer must not clear it.
 */
export function showContentBox(kind: number): boolean {
  const def = getKind(kind);
  const handler = def?.handler ?? '';
  if (
    kind === 10013 ||
    handler === 'nip37_private_relay_list' ||
    handler.startsWith('nip51_')
  ) {
    return false;
  }
  const encoding = def?.content?.encoding;
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
