/** Split a stored identifier into colon-separated parts (min 2 for the editor). */
export function identifierParts(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return ['', ''];
  const parts = trimmed.split(':');
  return parts.length >= 2 ? parts : ['', parts[0]!];
}

/**
 * Rows for the identifiers editor. Each row is colon-joined on the wire.
 * Blank raw → one empty two-part row. Blank lines stay as empty rows.
 */
export function identifierRowsFromRaw(raw: string): string[][] {
  if (!raw) return [['', '']];
  const lines = raw.split('\n');
  if (lines.every((line) => !line.trim())) return [['', '']];
  return lines.map((line) => (line.trim() ? identifierParts(line) : ['', '']));
}

/**
 * Serialize identifier part-rows for `publication_identifiers`.
 * All-empty rows become blank lines so the editor can keep placeholders;
 * catalog `parseIdentifiers` ignores them on emit.
 */
export function formatIdentifierRows(rows: string[][]): string {
  return rows
    .map((parts) => {
      const cleaned = parts.map((p) => p.trim());
      return cleaned.every((p) => !p) ? '' : cleaned.join(':');
    })
    .join('\n');
}
