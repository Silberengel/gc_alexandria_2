/** Suggested author roles; free text is also allowed (imwald / catalog parity). */
export const AUTHOR_ROLE_SUGGESTIONS = [
  'author',
  'translator',
  'editor',
  'annotator',
  'commentator',
  'preface',
  'foreword',
  'introduction',
  'compiler',
  'reviser',
  'contributor',
  'ghostwriter',
  'illustrator',
  'cartographer'
] as const;

export const AUTHOR_ROLE_OTHER = 'other';

const KNOWN_ROLES = new Set<string>(AUTHOR_ROLE_SUGGESTIONS);

export interface AuthorEntry {
  name: string;
  role?: string | null;
}

/** Dropdown selection for a role (`other` when custom). */
export function authorRoleSelectValue(role: string | null | undefined): string {
  const r = (role ?? '').trim().toLowerCase() || 'author';
  return KNOWN_ROLES.has(r) ? r : AUTHOR_ROLE_OTHER;
}

/**
 * `Name|translator` or `Name (translator)` → role on author tag index 2.
 * Bare names have no role slot.
 */
export function parseAuthorLine(raw: string): AuthorEntry {
  const trimmed = raw.trim();
  const pipe = trimmed.indexOf('|');
  if (pipe > 0) {
    const name = trimmed.slice(0, pipe).trim();
    const role = trimmed.slice(pipe + 1).trim() || null;
    if (name) return { name, role };
  }
  const paren = /^(.+?)\s*\(([^)]+)\)\s*$/.exec(trimmed);
  if (paren) {
    const name = paren[1]!.trim();
    const role = paren[2]!.trim() || null;
    if (name) return { name, role };
  }
  return { name: trimmed, role: null };
}

export function splitAuthors(raw: string): AuthorEntry[] {
  return String(raw)
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(parseAuthorLine);
}

/**
 * Serialize author rows for the `publication_author` compose field.
 * Empty names become blank lines so the editor can keep placeholder rows;
 * splitAuthors / emit still ignore them.
 */
export function formatAuthors(entries: AuthorEntry[]): string {
  return entries
    .map((entry) => {
      const name = entry.name;
      const role = entry.role?.trim() ?? '';
      if (!name.trim()) return '';
      if (!role || role.toLowerCase() === 'author') return name;
      return `${name}|${role}`;
    })
    .join('\n');
}

/**
 * Rows for the authors editor. Blank raw → one empty row with role `author`.
 * Missing roles default to `author` in the UI. Preserves blank lines as empty rows.
 */
export function authorRowsFromRaw(raw: string): AuthorEntry[] {
  if (!raw) return [{ name: '', role: 'author' }];
  const lines = raw.split('\n');
  if (lines.every((line) => !line.trim())) return [{ name: '', role: 'author' }];
  return lines.map((line) => {
    if (!line.trim()) return { name: '', role: 'author' };
    const entry = parseAuthorLine(line);
    const role = entry.role?.trim() || 'author';
    return { name: entry.name, role };
  });
}
