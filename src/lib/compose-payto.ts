/** Imwald `PaytoCatalog.EDITOR_ORDER` + custom "other". */
export const PAYTO_OTHER = 'other';

export const PAYTO_TYPE_OPTIONS = [
  'lightning',
  'bitcoin',
  'bolt12',
  'bip353',
  'bip352',
  'liquid',
  'lbtc',
  'ethereum',
  'monero',
  'litecoin',
  'dogecoin',
  'bitcoin-cash',
  'solana',
  'nano',
  'usdt',
  'usdc',
  'dai',
  'euroc',
  'paypal',
  'cashme',
  'venmo',
  'revolut',
  'buymeacoffee',
  'ko-fi',
  'patreon',
  'github',
  'geyser',
  'gofundme',
  'kickstarter',
  'apple-pay',
  'google-pay',
  PAYTO_OTHER
] as const;

export type PaytoRow = { type: string; authority: string };

const KNOWN = new Set<string>(PAYTO_TYPE_OPTIONS.filter((t) => t !== PAYTO_OTHER));

/** Dropdown selection for a row type (`other` when custom). */
export function paytoSelectValue(type: string): string {
  const t = type.trim().toLowerCase();
  if (!t) return 'lightning';
  return KNOWN.has(t) ? t : PAYTO_OTHER;
}

export function parsePaytoLine(line: string): PaytoRow | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (/^payto:\/\//i.test(trimmed)) {
    const m = /^payto:\/\/([^/]+)\/(.+)$/i.exec(trimmed);
    if (!m) return { type: 'payto', authority: trimmed };
    return { type: m[1]!.toLowerCase(), authority: decodeURIComponent(m[2]!) };
  }
  const space = trimmed.search(/\s+/);
  if (space <= 0) return null;
  const type = trimmed.slice(0, space).trim().toLowerCase();
  const authority = trimmed.slice(space).trim();
  if (!type || !authority) return null;
  return { type, authority };
}

export function formatPaytoLine(row: PaytoRow): string {
  const type = row.type.trim().toLowerCase();
  const authority = row.authority.trim();
  if (!type || !authority) return '';
  return `${type} ${authority}`;
}

export function paytoRowsFromRaw(raw: string): PaytoRow[] {
  if (!raw) return [{ type: 'lightning', authority: '' }];
  const lines = raw.split('\n');
  if (lines.every((line) => !line.trim())) return [{ type: 'lightning', authority: '' }];
  return lines.map((line) => {
    if (!line.trim()) return { type: 'lightning', authority: '' };
    return parsePaytoLine(line) ?? { type: 'lightning', authority: line.trim() };
  });
}

export function formatPaytoRows(rows: PaytoRow[]): string {
  return rows.map(formatPaytoLine).join('\n');
}
