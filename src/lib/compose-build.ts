import {
  buildKind0Content,
  buildTagsForKind,
  getKind,
  validateCompose,
} from './kind-compose';
import { kind0SavePayload } from './compose-kind0';
import { buildDirectoryMemberTags } from './compose-directory-members';
import { buildMuteListPayload } from './compose-mute-list';
import { buildPListTags } from './compose-people-list';
import { scrubTrackingUrlsInText } from './clean-url';
import { KIND } from './constants';
import { withMarkupTag } from './markup';
import { withClientTag } from './sign';
import { isComposePointerTagName, normalizeComposeTagRow } from './compose-tag-normalize';
import { fieldSpecs } from './kind-compose';
import { isCatalogued } from '@silberengel/kind-compose-catalog';

export type ComposeFormState = {
  kind: number;
  content: string;
  values: Record<string, string>;
  hashtags?: string[];
  imetaTags?: string[][];
  freeformTags?: string[][];
  /** Kind-0 editor rows (name/value[/…]); JSON + mirror tags are derived on publish. */
  kind0Tags?: string[][];
  existingKind0?: Record<string, unknown>;
  appMergeTags?: string[][];
  /** Body markup chosen in the editor. Written as an `m` tag when set. */
  markup?: 'djot' | 'asciidoc' | null;
};

export {
  buildKind0Content,
  buildTagsForKind,
  getKind,
  parseKind0Json,
  validateCompose,
} from './kind-compose';

function contentEncodingEmpty(kind: number): boolean {
  return getKind(kind)?.content?.encoding === 'empty';
}

function scrubComposeValues(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(values)) {
    out[key] = scrubTrackingUrlsInText(String(raw ?? ''));
  }
  return out;
}

/**
 * Expand naddr/nevent/npub in catalog fields that emit a/e/p/q (and uppercase).
 * Flat `values` only store slot 1 for {@link buildTagsForKind}; multi-slot rows
 * (relay hint, author) are returned separately and merged onto the wire tags.
 */
function normalizePointerFieldValues(
  kind: number,
  values: Record<string, string>
): { values: Record<string, string>; pointerTagExtras: string[][] } {
  if (!isCatalogued(kind)) return { values, pointerTagExtras: [] };
  const out = { ...values };
  const pointerTagExtras: string[][] = [];
  for (const field of fieldSpecs(kind)) {
    const tag = (field.tag ?? '').trim();
    if (!isComposePointerTagName(tag)) continue;
    const raw = out[field.id];
    if (raw == null || !String(raw).trim()) continue;
    const row = normalizeComposeTagRow([tag, String(raw)]);
    if (row[1] != null) out[field.id] = row[1];
    if (row.length > 2) pointerTagExtras.push(row);
  }
  return { values: out, pointerTagExtras };
}

/** Copy relay / author slots from normalized pointer rows onto emitted tags. */
function mergePointerTagExtras(tags: string[][], extras: string[][]): string[][] {
  if (!extras.length) return tags;
  const out = tags.map((t) => [...t]);
  for (const extra of extras) {
    const name = extra[0];
    const value = extra[1];
    if (!name || !value) continue;
    const idx = out.findIndex((t) => t[0] === name && t[1] === value);
    if (idx < 0) continue;
    const merged = [...out[idx]!];
    for (let i = 2; i < extra.length; i++) {
      const hint = (extra[i] ?? '').trim();
      if (!hint) continue;
      while (merged.length <= i) merged.push('');
      if (!(merged[i] ?? '').trim()) merged[i] = hint;
    }
    out[idx] = merged;
  }
  return out;
}

function normalizeFreeformTagRows(rows: string[][] | undefined): string[][] | undefined {
  if (!rows?.length) return rows;
  return rows.map((row) => normalizeComposeTagRow(row));
}

export function buildComposePartial(state: ComposeFormState): {
  kind: number;
  content: string;
  tags: string[][];
} {
  const { kind } = state;
  const { values, pointerTagExtras } = normalizePointerFieldValues(
    kind,
    scrubComposeValues(state.values)
  );
  const freeformTags = normalizeFreeformTagRows(state.freeformTags);
  let content: string;
  let tags: string[][];

  if (kind === 0) {
    const payload = kind0SavePayload(state.kind0Tags ?? []);
    content = scrubTrackingUrlsInText(payload.contentJson);
    tags = [...payload.orderedTags];
    if (freeformTags?.length) {
      for (const row of freeformTags) {
        if (row[0]?.trim()) tags.push(row);
      }
    }
  } else if (
    kind === KIND.CONTACT_LIST ||
    getKind(kind)?.handler === 'nip51_p_list'
  ) {
    // Catalog emit `p_list` is not in alexandria composeEmits yet — build locally.
    content = '';
    tags = [...buildPListTags(values.authors ?? '')];
    if (freeformTags?.length) {
      for (const row of freeformTags) {
        if (row[0]?.trim()) tags.push([...row]);
      }
    }
  } else if (
    kind === KIND.MUTE ||
    getKind(kind)?.handler === 'nip51_mute_list'
  ) {
    // Catalog emit `mute_list` is not in alexandria composeEmits yet — build locally.
    const mute = buildMuteListPayload(values.muted ?? '');
    content = mute.privateJson;
    tags = [...mute.tags];
    if (freeformTags?.length) {
      for (const row of freeformTags) {
        if (row[0]?.trim()) tags.push([...row]);
      }
    }
  } else if (
    kind === KIND.DIRECTORY ||
    getKind(kind)?.handler === 'nkbip04_directory'
  ) {
    // Catalog emit `directory_members` is not in alexandria composeEmits yet.
    content = '';
    tags = buildTagsForKind(kind, values, {
      app: 'alexandria',
      content: '',
      hashtags: state.hashtags
    });
    tags = tags.filter((t) => t[0] !== 'a' && t[0] !== 'e');
    tags.push(...buildDirectoryMemberTags(values.members ?? ''));
    if (freeformTags?.length) {
      for (const row of freeformTags) {
        const name = row[0]?.trim();
        if (!name || name === 'a' || name === 'e') continue;
        tags.push([...row]);
      }
    }
  } else {
    if (contentEncodingEmpty(kind)) {
      content = '';
    } else {
      content = state.content?.trim() ? state.content : String(values.content ?? '');
    }
    content = scrubTrackingUrlsInText(content);
    tags = buildTagsForKind(kind, values, {
      app: 'alexandria',
      content,
      hashtags: state.hashtags,
      freeformTags,
    });
  }

  if (state.imetaTags?.length) {
    for (const row of state.imetaTags) {
      if (row.length) tags.push(row);
    }
  }
  if (state.appMergeTags?.length) {
    for (const row of state.appMergeTags) {
      if (row.length) tags.push(row);
    }
  }
  if (state.markup === 'djot' || state.markup === 'asciidoc') {
    tags = withMarkupTag(tags, state.markup);
  }

  tags = mergePointerTagExtras(tags, pointerTagExtras);
  return { kind, content, tags: withClientTag(tags) };
}

export function validateComposeForm(
  state: ComposeFormState,
): { ok: true } | { ok: false; error: string } {
  const partial = buildComposePartial(state);
  const result = validateCompose(state.kind, {
    content: partial.content,
    values: state.values,
    tags: partial.tags,
  });
  if (!result.ok) return result;
  return { ok: true };
}
