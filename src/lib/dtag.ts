/** NIP-54 d-tag normalization per features/catalog/dtag_normalize.feature */

export function normalizeDTag(input: string): string {
  const lowered = input.normalize('NFC').toLowerCase();
  let out = '';
  for (const ch of lowered) {
    if (/\s/u.test(ch) || ch === '-' || ch === '.' || ch === '_') {
      out += '-';
    } else if (/[\p{L}\p{N}]/u.test(ch)) {
      out += ch;
    }
  }
  return out.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
}

export function indexSlug(input: string, maxLen = 255): string {
  if (!input.trim()) return '';
  const folded = input.normalize('NFD').replace(/\p{M}/gu, '');
  let out = '';
  for (const ch of folded) {
    if (/\s/u.test(ch) || ch === '_') out += '-';
    else if (ch === '-') out += '-';
    else if (/[0-9A-Za-z]/u.test(ch)) out += ch.toLowerCase();
  }
  let slug = out.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length > maxLen) slug = slug.slice(0, maxLen).replace(/-+$/g, '');
  return slug;
}

export function dTagVariants(input: string): string[] {
  const variants = new Set<string>();
  const add = (raw: string) => {
    const d = normalizeDTag(raw);
    if (d) variants.add(d);
  };
  add(input);
  const folded = input.normalize('NFD').replace(/\p{M}/gu, '');
  if (folded !== input) add(folded);
  return [...variants];
}
