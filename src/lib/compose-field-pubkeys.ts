import { hexPubkey } from './metadata';

const HEX64 = /(?:^|[^0-9a-fA-F])([0-9a-fA-F]{64})(?![0-9a-fA-F])/g;

/**
 * Unique hex pubkeys from a composer field value (whole value, tokens, or
 * embedded 64-char hex). Accepts hex / npub / nprofile via {@link hexPubkey}.
 */
export function hexPubkeysFromComposerText(raw: string): string[] {
  const text = (raw ?? '').trim();
  if (!text) return [];

  const out: string[] = [];
  const seen = new Set<string>();

  const add = (hex: string | null | undefined) => {
    if (!hex || seen.has(hex)) return;
    seen.add(hex);
    out.push(hex);
  };

  add(hexPubkey(text));

  for (const token of text.split(/[\s,;|]+/)) {
    const t = token.trim();
    if (!t) continue;
    add(hexPubkey(t));
  }

  HEX64.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEX64.exec(text))) {
    add(m[1].toLowerCase());
  }

  return out;
}

/** True when a catalog field is meant to hold pubkey(s). */
export function fieldHoldsPubkeys(field: {
  tag?: string;
  valueType?: string;
  emit?: string;
}): boolean {
  const tag = (field.tag ?? '').trim();
  if (tag === 'p' || tag === 'P') return true;
  if (field.valueType === 'pubkey') return true;
  if (field.emit === 'p_tag' || field.emit === 'p_list') return true;
  return false;
}
