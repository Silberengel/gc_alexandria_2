import type { Event } from 'nostr-tools';
import { firstTag } from './nostr/verify';

export type ProfileFields = {
  displayName: string;
  name: string;
  about: string;
  picture: string;
  banner: string;
  website: string;
  nip05: string;
  extra: Record<string, string>;
  lud16: string;
  lud06: string;
  payto: string[];
  w: string[];
};

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

export function parseKind0(event: Event | null): ProfileFields {
  const empty: ProfileFields = {
    displayName: '',
    name: '',
    about: '',
    picture: '',
    banner: '',
    website: '',
    nip05: '',
    extra: {},
    lud16: '',
    lud06: '',
    payto: [],
    w: []
  };
  if (!event) return empty;
  const json = jsonObject(event.content);
  const tag = (name: string, jsonKeys: string[]): string => {
    const tagged = firstTag(event, name)?.trim();
    if (tagged) return tagged;
    for (const key of jsonKeys) {
      const v = str(json[key]);
      if (v) return v;
    }
    return '';
  };
  const extra: Record<string, string> = {};
  const known = new Set([
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
    'w'
  ]);
  for (const [key, value] of Object.entries(json)) {
    if (known.has(key)) continue;
    if (typeof value === 'string' && value.trim()) extra[key] = value.trim();
  }

  const payto = [
    ...event.tags.filter((t) => t[0] === 'payto' && t[1]).map((t) => t[1]!),
    ...str(json.payto).split(/\s+/).filter(Boolean)
  ];
  const w = [
    ...event.tags.filter((t) => t[0] === 'w' && t[1]).map((t) => t[1]!),
    ...str(json.w).split(/\s+/).filter(Boolean)
  ];

  return {
    displayName: tag('display_name', ['display_name']),
    name: tag('name', ['name']),
    about: tag('about', ['about']),
    picture: tag('picture', ['picture']),
    banner: tag('banner', ['banner']),
    website: tag('website', ['website']),
    nip05: tag('nip05', ['nip05']),
    extra,
    lud16: tag('lud16', ['lud16']),
    lud06: tag('lud06', ['lud06']),
    payto: [...new Set(payto)],
    w: [...new Set(w)]
  };
}

export type PaymentRow = { type: string; authority: string; href: string; label: string };

function authorityOf(type: string, value: string): string {
  const trimmed = value.trim();
  if (type === 'lud16') return trimmed.toLowerCase();
  if (type === 'lud06') return trimmed.toLowerCase();
  try {
    const url = new URL(trimmed.includes(':') ? trimmed : `https://${trimmed}`);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

function paymentHref(type: string, value: string): string | null {
  if (type === 'lud16') {
    if (!value.includes('@')) return null;
    return `lightning:${value}`;
  }
  if (type === 'lud06') {
    if (!/^lnurl/i.test(value) && !/^lightning:/i.test(value)) return null;
    return value.toLowerCase().startsWith('lightning:') ? value : `lightning:${value}`;
  }
  if (type === 'payto') {
    if (!/^payto:/i.test(value)) return null;
    return value;
  }
  if (type === 'w') {
    try {
      const url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
    } catch {
      return null;
    }
  }
  return null;
}

export function paymentRows(kind0: ProfileFields, paymentEvents: Event[]): PaymentRow[] {
  const rows: PaymentRow[] = [];
  const seen = new Set<string>();
  const add = (type: string, value: string) => {
    const href = paymentHref(type, value);
    if (!href) return;
    const authority = authorityOf(type, value);
    const key = `${type}:${authority}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ type, authority, href, label: value });
  };

  add('lud16', kind0.lud16);
  add('lud06', kind0.lud06);
  for (const p of kind0.payto) add('payto', p);
  for (const w of kind0.w) add('w', w);

  for (const event of paymentEvents) {
    for (const tag of event.tags) {
      if (tag[0] === 'payto' && tag[1]) add('payto', tag[1]);
      if (tag[0] === 'lud16' && tag[1]) add('lud16', tag[1]);
      if (tag[0] === 'lud06' && tag[1]) add('lud06', tag[1]);
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
