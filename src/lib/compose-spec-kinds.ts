/** One editor row: kind number + optional display name → `k` tag. */
export type SpecKindRow = { kind: string; name: string };

/** Parse a single line the same way catalog `buildSpecKTags` does. */
export function parseSpecKindLine(line: string): SpecKindRow {
  const trimmed = line.trim();
  if (!trimmed) return { kind: '', name: '' };
  const comma = trimmed.indexOf(',');
  if (comma > 0) {
    return {
      kind: trimmed.slice(0, comma).trim(),
      name: trimmed.slice(comma + 1).trim()
    };
  }
  const space = trimmed.search(/\s+/);
  if (space > 0) {
    return {
      kind: trimmed.slice(0, space).trim(),
      name: trimmed.slice(space).trim()
    };
  }
  return { kind: trimmed, name: '' };
}

export function formatSpecKindLine(row: SpecKindRow): string {
  const kind = row.kind.trim();
  const name = row.name.trim();
  if (!kind && !name) return '';
  if (!name) return kind;
  return `${kind} ${name}`;
}

export function specKindRowsFromRaw(raw: string): SpecKindRow[] {
  if (!raw) return [{ kind: '', name: '' }];
  const lines = raw.split('\n');
  if (lines.every((line) => !line.trim())) return [{ kind: '', name: '' }];
  return lines.map((line) =>
    line.trim() ? parseSpecKindLine(line) : { kind: '', name: '' }
  );
}

export function formatSpecKindRows(rows: SpecKindRow[]): string {
  return rows.map(formatSpecKindLine).join('\n');
}
