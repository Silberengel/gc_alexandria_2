import {
  SHARE_TRACKER_WARNING,
  splitTrackedUrl,
  tidyPastedUrl
} from './clean-url';

/**
 * Soft label budget for chrome (profile lists, tip rows) — not used for note body
 * rendering. Prefer `formatUrlHtml` / `formatUrlsInHtml` for content.
 */
export const RENDERED_URL_MAX = 150;
const RENDERED_URL_HEAD = 100;
const RENDERED_URL_TAIL = 50;

const URL_IN_TEXT = /(?:https?|wss?):\/\/[^\s<]+/gi;

/**
 * Compact label for UI chrome (menus, metadata lists).
 * Note bodies use {@link formatUrlHtml} instead so long SPA / share URLs stay whole.
 */
export function cropRenderedUrl(url: string): string {
  if (url.length <= RENDERED_URL_MAX) return url;
  return `${url.slice(0, RENDERED_URL_HEAD)}...${url.slice(-RENDERED_URL_TAIL)}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function peelTrailingPunctuation(raw: string): { url: string; trail: string } {
  const peeled = raw.match(/^(.*?)([.,;:!?)]*)$/);
  return { url: peeled?.[1] || raw, trail: peeled?.[2] ?? '' };
}

function trackerWarnHtml(): string {
  return `<span class="url-track-warn" title="${escapeHtml(SHARE_TRACKER_WARNING)}">share tracking</span>`;
}

/**
 * Threema-style URL HTML: full string stays visible; only the tracker-free prefix
 * is a hyperlink. Tracker tails render as plaintext with a caution chip.
 */
export function formatUrlHtml(raw: string, opts?: { asAnchor?: boolean }): string {
  const asAnchor = opts?.asAnchor !== false;
  const tidy = tidyPastedUrl(raw);
  const split = splitTrackedUrl(tidy);
  if (!split) return escapeHtml(raw);

  const safe = escapeHtml(split.safeText);
  const unsafe = split.unsafeText ? escapeHtml(split.unsafeText) : '';
  const warn = split.trackerNames.length ? ` ${trackerWarnHtml()}` : '';

  if (!asAnchor) {
    return `<span class="url-split">${safe}${unsafe}</span>${warn}`;
  }

  const href = escapeHtml(split.safeHref);
  return (
    `<span class="url-split">` +
    `<a href="${href}" rel="noopener noreferrer" target="_blank">${safe}</a>` +
    (unsafe ? `<span class="url-split-tail">${unsafe}</span>` : '') +
    `</span>${warn}`
  );
}

/** Leave plain-text bodies uncropped so long deep links stay copyable. */
export function cropRenderedUrlsInText(text: string): string {
  return text;
}

function formatHtmlTextUrls(segment: string): string {
  return segment.replace(URL_IN_TEXT, (raw) => {
    const decoded = decodeHtmlText(raw);
    const { url, trail } = peelTrailingPunctuation(decoded);
    if (!/^https?:\/\//i.test(url)) return raw;
    return formatUrlHtml(url) + escapeHtml(trail);
  });
}

/** Format URLs in text nodes. Tags, including href and src, are copied through. */
function formatTextNodes(html: string): string {
  let out = '';
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      if (end < 0) {
        out += html.slice(i);
        break;
      }
      out += html.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    const next = html.indexOf('<', i);
    const text = html.slice(i, next === -1 ? html.length : next);
    out += formatHtmlTextUrls(text);
    if (next === -1) break;
    i = next;
  }
  return out;
}

/**
 * Rewrite an existing `<a href="url">url</a>` into a safe-prefix link + plaintext
 * tracker tail. Labels that are not the URL itself are left alone (href cleaned).
 */
function formatAnchor(anchor: string): string {
  const openEnd = anchor.indexOf('>');
  if (openEnd < 0) return anchor;
  const open = anchor.slice(0, openEnd + 1);
  const inner = anchor.slice(openEnd + 1, -4);
  const hrefMatch = /\bhref\s*=\s*(["'])([\s\S]*?)\1/i.exec(open);
  const href = hrefMatch ? decodeHtmlText(hrefMatch[2]) : '';
  if (!href || !/^https?:\/\//i.test(href)) {
    return open + formatTextNodes(inner) + '</a>';
  }

  const visible = decodeHtmlText(inner).replace(/\s+/g, '').trim();
  const hrefCompact = href.replace(/\s+/g, '');
  const labelIsUrl = visible === hrefCompact || visible === tidyPastedUrl(hrefCompact);

  if (!labelIsUrl) {
    const split = splitTrackedUrl(href);
    if (!split || !split.trackerNames.length) {
      return open + formatTextNodes(inner) + '</a>';
    }
    // Keep the custom label, but point at the cleaned href and show a warning.
    const cleanedOpen = open.replace(
      /\bhref\s*=\s*(["'])([\s\S]*?)\1/i,
      `href="${escapeHtml(split.safeHref)}"`
    );
    return cleanedOpen + formatTextNodes(inner) + '</a> ' + trackerWarnHtml();
  }

  const { trail } = peelTrailingPunctuation(decodeHtmlText(inner));
  return formatUrlHtml(href) + escapeHtml(trail);
}

/**
 * Present URLs in rendered HTML without ellipsis cropping.
 * Bare http(s) text and URL-as-label anchors become safe-prefix links; tracker
 * query tails stay visible as plaintext with a share-tracking caution.
 */
export function cropRenderedUrlsInHtml(html: string): string {
  if (!html || !/https?:\/\/|wss?:\/\//i.test(html)) return html;
  const pieces: string[] = [];
  const re = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
  let last = 0;
  for (const match of html.matchAll(re)) {
    const index = match.index ?? 0;
    pieces.push(formatTextNodes(html.slice(last, index)));
    pieces.push(formatAnchor(match[0]));
    last = index + match[0].length;
  }
  pieces.push(formatTextNodes(html.slice(last)));
  return pieces.join('');
}
