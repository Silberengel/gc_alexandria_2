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
  'si', // YouTube share id
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

/** Strip trailing punctuation often glued onto pasted links. */
export function tidyPastedUrl(raw: string): string {
  return raw.trim().replace(/[),.;:!?'"\]]+$/g, '');
}

function isTrackerParam(name: string): boolean {
  const key = name.toLowerCase();
  if (TRACKER_PARAMETERS.has(key)) return true;
  return TRACKER_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Drop credentials, fragments, and tracking query params from an http(s) URL.
 * Returns null when the input is not a usable http(s) URL.
 */
export function cleanTrackingUrl(raw: string | undefined | null): string | null {
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

  const kept = [...url.searchParams.entries()].filter(([name]) => !isTrackerParam(name));
  url.hash = '';
  url.search = '';
  for (const [name, param] of kept) url.searchParams.append(name, param);
  let out = url.toString();
  // `URL#toString` forces a trailing slash on bare origins; keep the caller's form.
  if (url.pathname === '/' && !url.search && !/https?:\/\/[^/]+\/$/i.test(value)) {
    out = out.replace(/\/$/, '');
  }
  return out;
}

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

/** Tracker scrub + single `nostr:` on bech32 — for note/comment/prose bodies. */
export function scrubProseText(text: string): string {
  return normalizeNostrBech32InText(scrubTrackingUrlsInText(text), 'prefixed');
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
    content: scrubProseText(partial.content ?? ''),
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
 * If clipboard plain text needs URL tracker scrubbing or bech32 `nostr:`
 * normalization, prevent the default paste and insert the scrubbed text at the
 * caret. Returns true when it handled paste.
 */
export function scrubClipboardTextPaste(
  event: ClipboardEvent,
  apply: (scrubbed: string, start: number, end: number) => void,
  style: NostrBech32Style = 'prefixed'
): boolean {
  const text = event.clipboardData?.getData('text/plain') ?? '';
  if (!text) return false;
  const scrubbed =
    style === 'bare'
      ? normalizeNostrBech32InText(scrubTrackingUrlsInText(text), 'bare')
      : scrubProseText(text);
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
