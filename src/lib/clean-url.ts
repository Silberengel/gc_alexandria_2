import { nip19 } from 'nostr-tools';

/**
 * Query keys that commonly identify the clicker / sharer / campaign.
 * Keep this list defensive — unknown `utm_*` / analytics prefixes are stripped too.
 */
const TRACKER_PARAMETERS = new Set([
  'fbclid',
  'fbadid',
  'gclid',
  'gclsrc',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'igsh',
  'ttclid',
  'twclid',
  'li_fat_id',
  'yclid',
  'ymclid',
  's_kwcid',
  'vero_id',
  'vero_conv',
  'nr_email_referer',
  'ncid',
  'mbid',
  'trk',
  'trkCampaign',
  'sc_campaign',
  'sc_channel',
  'sc_content',
  'sc_medium',
  'sc_outcome',
  'sc_geo',
  'sc_country',
  'ref',
  'ref_',
  'ref_src',
  'ref_url',
  'spm',
  'scm',
  'si', // YouTube / Spotify share id (also stripped host-scoped extras below)
  'share_id',
  'share_token',
  '_ga',
  '_gl',
  '_hsenc',
  '_hsmi',
  'hsa_acc',
  'hsa_cam',
  'hsa_grp',
  'hsa_ad',
  'hsa_src',
  'hsa_tgt',
  'hsa_kw',
  'hsa_mt',
  'hsa_net',
  'hsa_ver',
  'mkt_tok',
  'oly_anon_id',
  'oly_enc_id',
  'wickedid',
  'sms_ss',
  'xtor'
]);

const TRACKER_PREFIXES = ['utm_', 'mtm_', 'pk_', 'piwik_', 'ga_', 'gad_', 'mc_', 'vero_'] as const;

/** Host-scoped extras — short names that are functional elsewhere. */
const HOST_TRACKER_PARAMETERS: Record<string, ReadonlySet<string>> = {
  'youtube.com': new Set(['si', 'is', 'pp', 'feature']),
  'm.youtube.com': new Set(['si', 'is', 'pp', 'feature']),
  'music.youtube.com': new Set(['si', 'is', 'pp', 'feature']),
  'youtu.be': new Set(['si', 'is', 'pp', 'feature']),
  'youtube-nocookie.com': new Set(['si', 'is', 'pp', 'feature']),
  'open.spotify.com': new Set(['si']),
  'spotify.link': new Set(['si'])
};

/** Strip trailing punctuation often glued onto pasted links. */
export function tidyPastedUrl(raw: string): string {
  return raw.trim().replace(/[),.;:!?'"\]]+$/g, '');
}

function hostKey(hostname: string): string {
  return hostname.replace(/^www\./i, '').toLowerCase();
}

export function isTrackerParam(name: string, hostname?: string): boolean {
  const key = name.toLowerCase();
  if (TRACKER_PARAMETERS.has(key)) return true;
  if (TRACKER_PREFIXES.some((prefix) => key.startsWith(prefix))) return true;
  if (hostname) {
    const scoped = HOST_TRACKER_PARAMETERS[hostKey(hostname)];
    if (scoped?.has(key)) return true;
  }
  return false;
}

export type SplitTrackedUrl = {
  /** Original tidy input. */
  original: string;
  /** Clickable target — trackers removed, hash kept (SPA deep links). */
  safeHref: string;
  /** Visible text for the hyperlink (usually `safeHref`). */
  safeText: string;
  /**
   * Tracker query tail shown as plaintext after the link (e.g. `?si=…` or `&si=…`).
   * Empty when there is nothing unsafe to reveal.
   */
  unsafeText: string;
  /** Tracker query names that were present (lowercased, unique, stable order). */
  trackerNames: string[];
};

function formatUrl(url: URL, original: string): string {
  let out = url.toString();
  // `URL#toString` forces a trailing slash on bare origins; keep the caller's form.
  if (url.pathname === '/' && !url.search && !url.hash && !/https?:\/\/[^/]+\/$/i.test(original)) {
    out = out.replace(/\/$/, '');
  }
  return out;
}

/**
 * Drop credentials and tracking query params from an http(s) URL.
 * Preserves the hash so SPA share links (`#/spec/…?section=…`) stay intact.
 * Returns null when the input is not a usable http(s) URL.
 */
export function cleanTrackingUrl(raw: string | undefined | null): string | null {
  const split = splitTrackedUrl(raw);
  return split?.safeHref ?? null;
}

type ParamPair = [string, string];

function partitionParams(
  entries: ParamPair[],
  host: string
): { kept: ParamPair[]; stripped: ParamPair[]; names: string[] } {
  const kept: ParamPair[] = [];
  const stripped: ParamPair[] = [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const [name, param] of entries) {
    if (isTrackerParam(name, host)) {
      stripped.push([name, param]);
      const key = name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        names.push(key);
      }
    } else {
      kept.push([name, param]);
    }
  }
  return { kept, stripped, names };
}

function queryString(pairs: ParamPair[]): string {
  const q = new URLSearchParams();
  for (const [name, param] of pairs) q.append(name, param);
  return q.toString();
}

/**
 * SPA deep links put their query after `#/path?…`. `URL#searchParams` misses that;
 * pull the hash-local query so trackers there are still found (no host allowlist).
 */
function splitHashParts(hash: string): { path: string; query: string } {
  if (!hash || hash === '#') return { path: hash, query: '' };
  const body = hash.slice(1);
  const qi = body.indexOf('?');
  if (qi < 0) return { path: hash, query: '' };
  return { path: `#${body.slice(0, qi)}`, query: body.slice(qi + 1) };
}

/**
 * Threema-style split: full URL stays visible; only the tracker-free prefix is a
 * live hyperlink. Callers render `safeText` as `<a href={safeHref}>` and
 * `unsafeText` as adjacent plaintext, plus a warning when `trackerNames` is set.
 *
 * Does not special-case Alexandria (or any) hosts. Reader params like `read`,
 * `section`, and `quote` are functional deep-link fields, not share trackers.
 */
export function splitTrackedUrl(raw: string | undefined | null): SplitTrackedUrl | null {
  const value = tidyPastedUrl(raw ?? '');
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = hostKey(url.hostname);
  const search = partitionParams([...url.searchParams.entries()], host);
  const hashParts = splitHashParts(url.hash);
  const hash = partitionParams([...new URLSearchParams(hashParts.query).entries()], host);

  const trackerNames = [...search.names];
  for (const name of hash.names) {
    if (!trackerNames.includes(name)) trackerNames.push(name);
  }

  const safe = new URL(url.href);
  safe.search = '';
  for (const [name, param] of search.kept) safe.searchParams.append(name, param);
  if (!hashParts.path && !hash.kept.length) {
    safe.hash = '';
  } else {
    const keptHashQuery = queryString(hash.kept);
    safe.hash = keptHashQuery ? `${hashParts.path}?${keptHashQuery}` : hashParts.path;
  }
  const safeHref = formatUrl(safe, value);

  if (!search.stripped.length && !hash.stripped.length) {
    return {
      original: value,
      safeHref,
      safeText: value,
      unsafeText: '',
      trackerNames
    };
  }

  // Rebuild the stripped tails so `safeText + unsafeText` still reads as the URL.
  const unsafeChunks: string[] = [];
  if (search.stripped.length) {
    const body = queryString(search.stripped);
    unsafeChunks.push(`${search.kept.length === 0 ? '?' : '&'}${body}`);
  }
  if (hash.stripped.length) {
    const body = queryString(hash.stripped);
    unsafeChunks.push(`${hash.kept.length === 0 ? '?' : '&'}${body}`);
  }

  return {
    original: value,
    safeHref,
    safeText: safeHref,
    unsafeText: unsafeChunks.join(''),
    trackerNames
  };
}

/** True when an http(s) URL carries known share / campaign trackers. */
export function urlHasShareTrackers(raw: string | undefined | null): boolean {
  const split = splitTrackedUrl(raw);
  return !!split && split.trackerNames.length > 0;
}

/** True when any bare http(s) URL in prose still carries share / campaign trackers. */
export function proseHasShareTrackers(text: string): boolean {
  const re = /https?:\/\/[^\s<>"'`]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (urlHasShareTrackers(m[0])) return true;
  }
  return false;
}

/** Short caution shown beside URLs that still carry share-tracking params. */
export const SHARE_TRACKER_WARNING =
  'Share-tracking parameters in this URL can identify who shared it. Only the underlined part is a live link — copy the full text if you need the rest.';

/** Replace every bare http(s) URL in text with its tracker-scrubbed form. */
export function scrubTrackingUrlsInText(text: string): string {
  return text.replace(/https?:\/\/[^\s<>"'`]+/gi, (match) => {
    const cleaned = cleanTrackingUrl(match);
    if (!cleaned) return match;
    const trail = match.slice(tidyPastedUrl(match).length);
    return cleaned + trail;
  });
}

/**
 * Valid npub / nprofile / note / nevent / naddr tokens, with any run of `nostr:`
 * prefixes. Skip matches glued to a path (`/npub1…`) so njump-style URLs stay put.
 * Does not touch `nsec` (secret keys).
 */
const NOSTR_BECH32_IN_TEXT =
  /(?<![\w/])((?:nostr:)+)?(n(?:pub|profile|addr|event|ote)1[02-9ac-hj-np-z]+)/gi;

export type NostrBech32Style = 'prefixed' | 'bare';

/**
 * Collapse `nostr:nostr:…` and preface bare bech32 with a single `nostr:`
 * (`prefixed`, for prose) or strip to the bech32 alone (`bare`, for npub fields).
 */
export function normalizeNostrBech32InText(
  text: string,
  style: NostrBech32Style = 'prefixed'
): string {
  return text.replace(NOSTR_BECH32_IN_TEXT, (match, _prefixes: string | undefined, bech32: string) => {
    try {
      const decoded = nip19.decode(bech32);
      if (
        decoded.type !== 'npub' &&
        decoded.type !== 'nprofile' &&
        decoded.type !== 'note' &&
        decoded.type !== 'nevent' &&
        decoded.type !== 'naddr'
      ) {
        return match;
      }
    } catch {
      return match;
    }
    return style === 'bare' ? bech32 : `nostr:${bech32}`;
  });
}

/**
 * Normalize bech32 in note/comment bodies. Tracking query params are left in
 * place so the author can see them (render shows a share-tracking warning);
 * `scrubTrackingInEventPartial` still strips them at publish time.
 */
export function scrubProseText(text: string): string {
  return normalizeNostrBech32InText(text, 'prefixed');
}

/**
 * Scrub trackers from event content and from any tag cell that is an http(s) URL
 * (imeta, r, source, …). Used as the last gate before signing/publishing.
 * Content also gets a single `nostr:` on bare bech32 (never stacked prefixes).
 */
export function scrubTrackingInEventPartial<
  T extends { content: string; tags: string[][] }
>(partial: T): T {
  return {
    ...partial,
    content: normalizeNostrBech32InText(
      scrubTrackingUrlsInText(partial.content ?? ''),
      'prefixed'
    ),
    tags: partial.tags.map((tag) =>
      tag.map((cell, i) => {
        if (i === 0 || typeof cell !== 'string') return cell;
        // Bare URL cells (r, source, …) and values that embed URLs (imeta).
        // Do not prefix bech32 here — p/e/q tag values are not prose.
        return scrubTrackingUrlsInText(cell);
      })
    )
  };
}

/**
 * If clipboard plain text needs bech32 `nostr:` normalization, prevent the
 * default paste and insert the normalized text at the caret.
 * Tracking params are kept intact so long SPA / share URLs are not cropped and
 * the author can inspect them before publishing.
 * Returns true when it handled paste.
 */
export function scrubClipboardTextPaste(
  event: ClipboardEvent,
  apply: (scrubbed: string, start: number, end: number) => void,
  style: NostrBech32Style = 'prefixed'
): boolean {
  const text = event.clipboardData?.getData('text/plain') ?? '';
  if (!text) return false;
  const scrubbed =
    style === 'bare' ? normalizeNostrBech32InText(text, 'bare') : scrubProseText(text);
  if (scrubbed === text) return false;
  event.preventDefault();
  const el = event.currentTarget;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    apply(scrubbed, start, end);
    queueMicrotask(() => {
      try {
        const next = start + scrubbed.length;
        el.setSelectionRange(next, next);
      } catch {
        /* some inputs ignore selection */
      }
    });
  } else {
    apply(scrubbed, 0, 0);
  }
  return true;
}
