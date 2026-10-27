import { nip19 } from 'nostr-tools';
import { hexPubkey } from './metadata';

export type MuteTagName = 'p' | 'e' | 'word' | 't';

/** One NIP-51 mute entry (public or private). */
export type MuteRow = {
  tag: MuteTagName;
  value: string;
  private: boolean;
};

const TAGS = new Set<MuteTagName>(['p', 'e', 'word', 't']);

const emptyRow = (): MuteRow => ({ tag: 'p', value: '', private: false });

function isMuteTag(name: string): name is MuteTagName {
  return TAGS.has(name as MuteTagName);
}

function normalizeHex64(raw: string): string | null {
  const trimmed = raw.trim().replace(/^nostr:/i, '');
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  return null;
}

/** Resolve mute values: pubkeys via npub, event ids as hex / note / nevent. */
export function normalizeMuteValue(tag: MuteTagName, raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (tag === 'p') return hexPubkey(trimmed);
  if (tag === 'e') {
    const hex = normalizeHex64(trimmed);
    if (hex) return hex;
    try {
      const decoded = nip19.decode(trimmed.replace(/^nostr:/i, ''));
      if (decoded.type === 'note') return decoded.data;
      if (decoded.type === 'nevent') return decoded.data.id;
    } catch {
      /* fall through */
    }
    return null;
  }
  if (tag === 't') {
    return trimmed.replace(/^#/, '').trim().toLowerCase() || null;
  }
  return trimmed;
}

/** Parse one mute line: `p hex`, `word spam`, or `private e id`. */
export function parseMuteLine(line: string): MuteRow | null {
  let rest = line.trim();
  if (!rest) return null;
  let priv = false;
  if (/^private\s+/i.test(rest)) {
    priv = true;
    rest = rest.replace(/^private\s+/i, '').trim();
  }
  const m = /^(p|e|word|t)\s+(.+)$/i.exec(rest);
  if (!m) return null;
  const tag = m[1]!.toLowerCase() as MuteTagName;
  if (!isMuteTag(tag)) return null;
  return { tag, value: m[2]!.trim(), private: priv };
}

export function muteRowsFromRaw(raw: string): MuteRow[] {
  if (!raw) return [emptyRow()];
  const lines = raw.split('\n');
  if (lines.every((line) => !line.trim())) return [emptyRow()];
  const rows: MuteRow[] = [];
  for (const line of lines) {
    if (!line.trim()) {
      rows.push(emptyRow());
      continue;
    }
    const parsed = parseMuteLine(line);
    rows.push(parsed ?? { tag: 'p', value: line.trim(), private: false });
  }
  return rows.length ? rows : [emptyRow()];
}

export function formatMuteRow(row: MuteRow): string {
  const value = row.value.trim();
  if (!value) return '';
  const body = `${row.tag} ${value}`;
  return row.private ? `private ${body}` : body;
}

export function formatMuteRows(rows: MuteRow[]): string {
  return rows.map(formatMuteRow).join('\n');
}

/** Map public + private mute tags into the muted field value. */
export function mutedRawFromTags(publicTags: string[][], privateTags: string[][] = []): string {
  const lines: string[] = [];
  for (const t of publicTags) {
    const name = (t[0] ?? '').toLowerCase();
    if (!isMuteTag(name)) continue;
    const value = t.slice(1).join(' ').trim();
    if (!value) continue;
    lines.push(`${name} ${value}`);
  }
  for (const t of privateTags) {
    const name = (t[0] ?? '').toLowerCase();
    if (!isMuteTag(name)) continue;
    const value = t.slice(1).join(' ').trim();
    if (!value) continue;
    lines.push(`private ${name} ${value}`);
  }
  return lines.join('\n');
}

export type MuteListPayload = {
  tags: string[][];
  /** Plaintext JSON array of private tags, or empty when none. */
  privateJson: string;
};

/**
 * Build public mute tags + private JSON payload from the muted field.
 * Does not encrypt — callers may nip44-wrap `privateJson` into event content.
 */
export function buildMuteListPayload(raw: string): MuteListPayload {
  const publicTags: string[][] = [];
  const privateTags: string[][] = [];
  const seenPublic = new Set<string>();
  const seenPrivate = new Set<string>();

  for (const row of muteRowsFromRaw(raw)) {
    const value = normalizeMuteValue(row.tag, row.value);
    if (!value) continue;
    const key = `${row.tag}:${value.toLowerCase()}`;
    const bucket = row.private ? privateTags : publicTags;
    const seen = row.private ? seenPrivate : seenPublic;
    if (seen.has(key)) continue;
    seen.add(key);
    bucket.push([row.tag, value]);
  }

  return {
    tags: publicTags,
    privateJson: privateTags.length ? JSON.stringify(privateTags) : ''
  };
}

/** Convenience: public tags only (empty content). */
export function buildMuteListTags(raw: string): string[][] {
  return buildMuteListPayload(raw).tags;
}
