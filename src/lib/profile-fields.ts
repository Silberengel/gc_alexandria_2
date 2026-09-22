import type { Event } from 'nostr-tools';
import { firstTag } from './nostr/verify';

export type ProfileFields = {
  displayName: string;
  name: string;
  /** display_name when set, else name — primary heading. */
  title: string;
  about: string;
  picture: string;
  banner: string;
  website: string;
  websites: string[];
  nip05: string;
  nip05List: string[];
  /** Non-standard JSON keys (not aliases of known fields). */
  extra: Record<string, string>;
  /** Other kind-0 tags not rendered as known fields or payments. */
  extraTags: Array<{ name: string; value: string }>;
  lud16: string;
  lud06: string;
  payto: string[];
  w: string[];
};

const KNOWN_JSON = new Set([
  'display_name',
  'displayName',
  'username',
  'name',
  'about',
  'picture',
  'banner',
  'website',
  'nip05',
  'lud16',
  'lud06',
  'payto',
  'w',
  'bot',
  'client'
]);

const KNOWN_TAG_NAMES = new Set([
  'display_name',
  'name',
  'about',
  'picture',
  'banner',
  'website',
  'nip05',
  'lud16',
  'lud06',
  'payto',
  'w',
  'bot',
  'imeta',
  'client'
]);

function jsonObject(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* invalid kind 0 JSON is ignored */
  }
  return {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function tagValues(event: Event, name: string): string[] {
  return event.tags.filter((t) => t[0] === name && t[1]?.trim()).map((t) => t[1]!.trim());
}

function firstNonEmpty(...values: string[]): string {
  for (const v of values) {
    if (v.trim()) return v.trim();
  }
  return '';
}

function nip05FromJson(raw: unknown): string[] {
  if (typeof raw === 'string' && raw.trim()) return [raw.trim()];
  if (Array.isArray(raw)) {
    return raw.map((v) => str(v)).filter(Boolean);
  }
  return [];
}

export function parseKind0(event: Event | null): ProfileFields {
  const empty: ProfileFields = {
    displayName: '',
    name: '',
    title: '',
    about: '',
    picture: '',
    banner: '',
    website: '',
    websites: [],
    nip05: '',
    nip05List: [],
    extra: {},
    extraTags: [],
    lud16: '',
    lud06: '',
    payto: [],
    w: []
  };
  if (!event) return empty;
  const json = jsonObject(event.content);

  const displayName = firstNonEmpty(
    tagValues(event, 'display_name')[0] ?? '',
    str(json.display_name),
    str(json.displayName)
  );
  const name = firstNonEmpty(tagValues(event, 'name')[0] ?? '', str(json.name), str(json.username));
  const about = firstNonEmpty(tagValues(event, 'about')[0] ?? '', str(json.about));
  const picture = firstNonEmpty(tagValues(event, 'picture')[0] ?? '', str(json.picture));
  const banner = firstNonEmpty(tagValues(event, 'banner')[0] ?? '', str(json.banner));

  const websiteTags = tagValues(event, 'website');
  const websites =
    websiteTags.length > 0
      ? [...new Set(websiteTags)]
      : str(json.website)
        ? [str(json.website)]
        : [];
  const website = websites[0] ?? '';

  const nip05Tags = tagValues(event, 'nip05');
  const nip05List =
    nip05Tags.length > 0 ? [...new Set(nip05Tags)] : [...new Set(nip05FromJson(json.nip05))];
  const nip05 = nip05List[0] ?? '';

  const lud16 = firstNonEmpty(tagValues(event, 'lud16')[0] ?? '', str(json.lud16));
  const lud06 = firstNonEmpty(tagValues(event, 'lud06')[0] ?? '', str(json.lud06));

  const payto = [
    ...event.tags
      .filter((t) => t[0] === 'payto' && t[1])
      .map((t) => (t[2] ? `payto://${t[1]}/${t[2]}` : t[1]!)),
    ...str(json.payto).split(/\s+/).filter(Boolean)
  ];

  /** HTTP(S) `w` tags only — wallet-shaped `w` tags are payment rows. */
  const wHttp = event.tags
    .filter((t) => t[0] === 'w' && t[1] && !t[2])
    .map((t) => t[1]!)
    .filter((u) => /^https?:\/\//i.test(u.trim()));
  const w = [...new Set([...wHttp, ...str(json.w).split(/\s+/).filter(Boolean)])];

  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(json)) {
    if (KNOWN_JSON.has(key)) continue;
    if (typeof value === 'string' && value.trim()) extra[key] = value.trim();
  }

  const extraTags: Array<{ name: string; value: string }> = [];
  const seenExtra = new Set<string>();
  for (const tag of event.tags) {
    const name = tag[0];
    if (!name || KNOWN_TAG_NAMES.has(name)) continue;
    const value = tag.slice(1).filter(Boolean).join(' ').trim();
    if (!value) continue;
    const key = `${name}:${value}`;
    if (seenExtra.has(key)) continue;
    seenExtra.add(key);
    extraTags.push({ name, value });
  }

  return {
    displayName,
    name,
    title: displayName || name,
    about,
    picture,
    banner,
    website,
    websites,
    nip05,
    nip05List,
    extra,
    extraTags,
    lud16,
    lud06,
    payto: [...new Set(payto)],
    w
  };
}

export type PaymentRow = { type: string; authority: string; href: string; label: string };

function authorityOf(type: string, value: string): string {
  const trimmed = value.trim();
  const t = type.toLowerCase();
  if (t === 'lud16' || t === 'lightning' || t === 'lud06' || t === 'bip353') {
    return trimmed.toLowerCase();
  }
  if (t === 'w' || t === 'http') {
    try {
      const url = new URL(trimmed.includes(':') ? trimmed : `https://${trimmed}`);
      return `${url.protocol}//${url.host}`.toLowerCase();
    } catch {
      return trimmed.toLowerCase();
    }
  }
  // Crypto / payto authorities — keep as-is (lowercased) for dedupe, no URL mangling.
  return trimmed.toLowerCase();
}

function paymentHref(type: string, value: string): string | null {
  if (type === 'lud16' || type === 'lightning') {
    if (!value.includes('@') && !/^lnurl/i.test(value)) return null;
    if (value.includes('@')) return `lightning:${value}`;
    return value.toLowerCase().startsWith('lightning:') ? value : `lightning:${value}`;
  }
  if (type === 'lud06') {
    if (!/^lnurl/i.test(value) && !/^lightning:/i.test(value)) return null;
    return value.toLowerCase().startsWith('lightning:') ? value : `lightning:${value}`;
  }
  if (type === 'payto' || type.startsWith('payto')) {
    if (/^payto:/i.test(value)) return value;
    return null;
  }
  if (type === 'w' || type === 'http') {
    try {
      const url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
    } catch {
      return null;
    }
  }
  // Generic payto://type/authority rows
  if (value.startsWith('payto://')) return value;
  return `payto://${type}/${encodeURIComponent(value).replace(/%40/g, '@')}`;
}

function addPaymentRow(
  rows: PaymentRow[],
  seen: Set<string>,
  type: string,
  value: string,
  label?: string
): void {
  const href = paymentHref(type, value);
  if (!href) return;
  const normType = type === 'lightning' ? 'lud16' : type;
  const authority = authorityOf(normType, value);
  const key = `${normType}:${authority}`;
  if (seen.has(key)) return;
  seen.add(key);
  const address = paymentAddressOnly(label ?? value, normType);
  rows.push({ type: normType, authority, href, label: address });
}

/** Address column value — never repeats the type prefix. */
export function paymentAddressOnly(value: string, type?: string): string {
  let s = value.trim();
  if (/^payto:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      // payto://type/authority → authority (+ path remainder)
      const path = decodeURIComponent(u.pathname.replace(/^\//, ''));
      s = path || u.username || s;
    } catch {
      s = s.replace(/^payto:\/\/[^/]+\//i, '');
    }
  }
  if (type) {
    const prefix = new RegExp(`^${type}\\s*:\\s*`, 'i');
    s = s.replace(prefix, '');
  }
  s = s.replace(/^(lightning|lud16|lud06|payto|geyser|monero|bitcoin|bip353|bip352)\s*:\s*/i, '');
  return s.trim();
}

/** Wallet-shaped kind 0 `["w", currency, address, network]`. */
function paymentFromWWalletTag(tag: string[]): { type: string; value: string } | null {
  if (tag[0] !== 'w' || !tag[1] || !tag[2] || !tag[3]) return null;
  const addr = tag[2].trim();
  const network = tag[3].trim().toLowerCase();
  if (!addr || !network) return null;
  if (network === 'lightning') {
    return { type: 'lightning', value: addr };
  }
  const type = network === 'bitcoin' ? 'bitcoin' : network;
  return { type, value: addr };
}

/**
 * Payment targets from kind 0 then kind 10133, jumble-style:
 * tags first (lud16/lud06/w wallets/payto type+authority), then JSON, then 10133.
 */
export function paymentRows(kind0: ProfileFields, paymentEvents: Event[], profileEvent?: Event | null): PaymentRow[] {
  const rows: PaymentRow[] = [];
  const seen = new Set<string>();

  if (profileEvent?.kind === 0) {
    for (const tag of profileEvent.tags) {
      if (tag[0] === 'lud16' && tag[1]) addPaymentRow(rows, seen, 'lightning', tag[1]);
      if (tag[0] === 'lud06' && tag[1]) addPaymentRow(rows, seen, 'lud06', tag[1]);
      const wallet = paymentFromWWalletTag(tag);
      if (wallet) addPaymentRow(rows, seen, wallet.type, wallet.value);
      if (tag[0] === 'payto' && tag[1] && tag[2]) {
        const type = tag[1].toLowerCase();
        const authority = tag[2];
        addPaymentRow(rows, seen, type, authority);
      } else if (tag[0] === 'payto' && tag[1] && !tag[2]) {
        addPaymentRow(rows, seen, 'payto', tag[1]);
      }
    }
  }

  addPaymentRow(rows, seen, 'lightning', kind0.lud16);
  addPaymentRow(rows, seen, 'lud06', kind0.lud06);
  for (const p of kind0.payto) addPaymentRow(rows, seen, 'payto', p);
  for (const w of kind0.w) addPaymentRow(rows, seen, 'w', w);

  for (const event of paymentEvents) {
    for (const tag of event.tags) {
      if (tag[0] === 'lud16' && tag[1]) addPaymentRow(rows, seen, 'lightning', tag[1]);
      if (tag[0] === 'lud06' && tag[1]) addPaymentRow(rows, seen, 'lud06', tag[1]);
      if (tag[0] === 'payto' && tag[1] && tag[2]) {
        const type = tag[1].toLowerCase();
        addPaymentRow(rows, seen, type, tag[2]);
      } else if (tag[0] === 'payto' && tag[1] && !tag[2]) {
        addPaymentRow(rows, seen, 'payto', tag[1]);
      }
    }
  }
  return rows;
}

export function activeStatus(events: Event[]): Event | null {
  const now = Math.floor(Date.now() / 1000);
  const hits = events.filter((e) => {
    if (e.kind !== 30315) return false;
    const d = firstTag(e, 'd') ?? '';
    if (d !== 'general' && d !== 'music') return false;
    const exp = firstTag(e, 'expiration');
    if (exp && Number(exp) > 0 && Number(exp) < now) return false;
    return true;
  });
  hits.sort((a, b) => b.created_at - a.created_at);
  return hits[0] ?? null;
}

/** Display label for payment type column. */
export function paymentTypeLabel(type: string): string {
  const t = type.toLowerCase();
  if (t === 'lud16' || t === 'lightning') return 'Lightning';
  if (t === 'lud06') return 'LNURL';
  if (t === 'w' || t === 'http') return 'URL';
  if (t === 'payto') return 'Payto';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/** Truncate for payment address column. */
export function cropPaymentAddress(value: string, max = 50): string {
  const s = value.trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

const ABOUT_URL = /https?:\/\/[^\s<>"')\]]+/gi;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escape about text and turn http(s) URLs into safe links. */
export function aboutHtml(about: string): string {
  const raw = about.trim();
  if (!raw) return '';
  const parts: string[] = [];
  let last = 0;
  for (const match of raw.matchAll(ABOUT_URL)) {
    const url = match[0] ?? '';
    const start = match.index ?? 0;
    if (start > last) parts.push(escapeHtml(raw.slice(last, start)));
    const href = url.replace(/[.,;:!?)]+$/, '');
    const trailing = url.slice(href.length);
    try {
      const parsed = new URL(href);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        parts.push(
          `<a href="${escapeHtml(href)}" rel="noopener noreferrer" target="_blank">${escapeHtml(href)}</a>`
        );
        parts.push(escapeHtml(trailing));
      } else {
        parts.push(escapeHtml(url));
      }
    } catch {
      parts.push(escapeHtml(url));
    }
    last = start + url.length;
  }
  if (last < raw.length) parts.push(escapeHtml(raw.slice(last)));
  return parts.join('').replace(/\n/g, '<br>');
}
