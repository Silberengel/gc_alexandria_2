import {
  decodePointer,
  sectionDTagFromRow
} from '@silberengel/kind-compose-catalog';

export { sectionDTagFromRow };

/** Editor rows: blank raw → one empty placeholder; preserves blank lines. */
export function sectionRowsFromRaw(raw: string): string[] {
  if (!raw) return [''];
  const lines = raw.split('\n');
  if (lines.every((line) => !line.trim())) return [''];
  return lines;
}

export function formatSectionRows(rows: string[]): string {
  return rows.join('\n');
}

/** Move row `from` to index `to` (same list semantics as imwald). */
export function moveSectionRow(rows: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) {
    return rows;
  }
  const next = [...rows];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** True when the row is a parseable section pointer. */
export function isValidSectionRow(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  return decodePointer(trimmed) != null;
}

/** Coordinate string for address rows (`kind:pubkey:d`), else null. */
export function sectionAddressCoord(raw: string): string | null {
  const pointer = decodePointer(raw);
  if (pointer?.type !== 'addr') return null;
  return `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`;
}
