import {
  buildKind0Content,
  buildTagsForKind,
  getKind,
  validateCompose,
} from './kind-compose';
import { withClientTag } from './sign';

export type ComposeFormState = {
  kind: number;
  content: string;
  values: Record<string, string>;
  hashtags?: string[];
  imetaTags?: string[][];
  freeformTags?: string[][];
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

  if (kind === 0) {
    content = buildKind0Content(values, state.existingKind0 ?? {});
  } else if (contentEncodingEmpty(kind)) {
    content = '';
  } else {
    content = state.content?.trim() ? state.content : String(values.content ?? '');
  }

  const tags = buildTagsForKind(kind, values, {
    app: 'alexandria',
    content,
    hashtags: state.hashtags,
    freeformTags: state.freeformTags,
  });

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
