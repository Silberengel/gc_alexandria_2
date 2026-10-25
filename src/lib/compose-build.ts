import {
  buildKind0Content,
  buildTagsForKind,
  getKind,
  validateCompose,
} from './kind-compose';
import { kind0SavePayload } from './compose-kind0';
import { withClientTag } from './sign';

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

export function buildComposePartial(state: ComposeFormState): {
  kind: number;
  content: string;
  tags: string[][];
} {
  const { kind, values } = state;
  let content: string;
  let tags: string[][];

  if (kind === 0) {
    const payload = kind0SavePayload(state.kind0Tags ?? []);
    content = payload.contentJson;
    tags = [...payload.orderedTags];
    if (state.freeformTags?.length) {
      for (const row of state.freeformTags) {
        if (row[0]?.trim()) tags.push(row);
      }
    }
  } else {
    if (contentEncodingEmpty(kind)) {
      content = '';
    } else {
      content = state.content?.trim() ? state.content : String(values.content ?? '');
    }
    tags = buildTagsForKind(kind, values, {
      app: 'alexandria',
      content,
      hashtags: state.hashtags,
      freeformTags: state.freeformTags,
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
