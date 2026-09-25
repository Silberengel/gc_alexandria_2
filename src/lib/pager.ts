/** Page numbers and ellipsis gaps for a compact pager window. */
export type PagerItem = number | 'ellipsis';

/**
 * Build page buttons with first/last always present, neighbors around the
 * current page, and ellipses where a gap is skipped.
 */
export function pagerItems(page: number, pages: number): PagerItem[] {
  const total = Math.max(1, Math.floor(pages));
  const current = Math.min(Math.max(1, Math.floor(page)), total);

  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const set = new Set<number>([1, total, current]);
  for (let i = 1; i <= 2; i++) {
    if (current - i >= 1) set.add(current - i);
    if (current + i <= total) set.add(current + i);
  }
  // Near the ends, fill a short run so the control does not look sparse.
  if (current <= 3) {
    for (let i = 2; i <= 5; i++) if (i < total) set.add(i);
  }
  if (current >= total - 2) {
    for (let i = total - 4; i < total; i++) if (i > 1) set.add(i);
  }

  const sorted = [...set].sort((a, b) => a - b);
  const out: PagerItem[] = [];
  let prev = 0;
  for (const n of sorted) {
    if (prev && n - prev > 1) out.push('ellipsis');
    out.push(n);
    prev = n;
  }
  return out;
}
