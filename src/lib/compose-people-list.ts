import { hexPubkey } from './metadata';

/** One NIP-02 follow row: pubkey + optional relay + petname. */
export type PeopleRow = {
  pubkey: string;
  relay: string;
  petname: string;
};

const emptyRow = (): PeopleRow => ({ pubkey: '', relay: '', petname: '' });

function looksLikeRelay(token: string): boolean {
  return /^(wss?|https?):\/\//i.test(token.trim());
}

/** Parse a single follow line (`pubkey|relay|petname` or space-separated). */
export function parsePeopleLine(line: string): PeopleRow {
  const trimmed = line.trim();
  if (!trimmed) return emptyRow();
  if (trimmed.includes('|')) {
    const parts = trimmed.split('|');
    return {
      pubkey: (parts[0] ?? '').trim(),
      relay: (parts[1] ?? '').trim(),
      petname: parts.slice(2).join('|').trim()
    };
  }
  const tokens = trimmed.split(/\s+/);
  const pubkey = tokens[0] ?? '';
  if (tokens[1] && looksLikeRelay(tokens[1])) {
    return {
      pubkey,
      relay: tokens[1]!,
      petname: tokens.slice(2).join(' ')
    };
  }
  return {
    pubkey,
    relay: '',
    petname: tokens.slice(1).join(' ')
  };
}

export function peopleRowsFromRaw(raw: string): PeopleRow[] {
  if (!raw) return [emptyRow()];
  const lines = raw.split('\n');
  if (lines.every((line) => !line.trim())) return [emptyRow()];
  return lines.map(parsePeopleLine);
}

export function formatPeopleRow(row: PeopleRow): string {
  const pubkey = row.pubkey.trim();
  if (!pubkey) return '';
  const relay = row.relay.trim();
  const petname = row.petname.trim();
  if (!relay && !petname) return pubkey;
  return `${pubkey}|${relay}|${petname}`;
}

export function formatPeopleRows(rows: PeopleRow[]): string {
  return rows.map(formatPeopleRow).join('\n');
}

/** Map live kind-3 `p` tags into the authors field value. */
export function authorsRawFromTags(tags: string[][]): string {
  return tags
    .filter((t) => t[0] === 'p' && (t[1] ?? '').trim())
    .map((t) => {
      const pubkey = (t[1] ?? '').trim();
      const relay = (t[2] ?? '').trim();
      const petname = (t[3] ?? '').trim();
      if (!relay && !petname) return pubkey;
      return `${pubkey}|${relay}|${petname}`;
    })
    .join('\n');
}

/**
 * Build NIP-02 `p` tags from the authors field.
 * Accepts hex / npub / nprofile; drops duplicates (case-insensitive hex).
 */
export function buildPListTags(raw: string): string[][] {
  const tags: string[][] = [];
  const seen = new Set<string>();
  for (const row of peopleRowsFromRaw(raw)) {
    const hex = hexPubkey(row.pubkey);
    if (!hex) continue;
    if (seen.has(hex)) continue;
    seen.add(hex);
    const relay = row.relay.trim();
    const petname = row.petname.trim();
    if (relay || petname) tags.push(['p', hex, relay, petname]);
    else tags.push(['p', hex]);
  }
  return tags;
}
