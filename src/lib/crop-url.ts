/** Visible URL budget: the first 100 characters, "...", then the last 50. */
export const RENDERED_URL_MAX = 150;
const RENDERED_URL_HEAD = 100;
const RENDERED_URL_TAIL = 50;

const URL_IN_TEXT = /(?:https?|wss?):\/\/[^\s<]+/gi;

/**
 * Shorten a URL that is shown as text.
 * The link target stays the original string. 150 characters or fewer are left whole.
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

/** Crop URL text. Trailing sentence punctuation stays after the shortened URL. */
export function cropRenderedUrlsInText(text: string): string {
  return text.replace(URL_IN_TEXT, (raw) => {
    const peeled = raw.match(/^(.*?)([.,;:!?)]*)$/);
    const url = peeled?.[1] || raw;
    const trail = peeled?.[2] ?? '';
    if (!/^https?:\/\/|^wss?:\/\//i.test(url) || url.length <= RENDERED_URL_MAX) return raw;
    return cropRenderedUrl(url) + trail;
  });
}

function cropHtmlText(segment: string): string {
  return segment.replace(URL_IN_TEXT, (raw) => {
    const decoded = decodeHtmlText(raw);
    const peeled = decoded.match(/^(.*?)([.,;:!?)]*)$/);
    const url = peeled?.[1] || decoded;
    const trail = peeled?.[2] ?? '';
    if (url.length <= RENDERED_URL_MAX) return raw;
    return escapeHtml(cropRenderedUrl(url)) + escapeHtml(trail);
  });
}

/** Crop URLs in text nodes. Tags, including href and src, are copied through. */
function cropTextNodes(html: string): string {
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
    out += cropHtmlText(text);
    if (next === -1) break;
    i = next;
  }
  return out;
}

function withFullUrlTitle(open: string, href: string): string {
  if (/\btitle\s*=/i.test(open) || href.length <= RENDERED_URL_MAX) return open;
  return `${open.slice(0, -1)} title="${escapeHtml(href)}">`;
}

function cropAnchor(anchor: string): string {
  const openEnd = anchor.indexOf('>');
  if (openEnd < 0) return anchor;
  const open = anchor.slice(0, openEnd + 1);
  const inner = anchor.slice(openEnd + 1, -4);
  const hrefMatch = /\bhref\s*=\s*(["'])([\s\S]*?)\1/i.exec(open);
  const href = hrefMatch ? decodeHtmlText(hrefMatch[2]) : '';
  const croppedInner = cropTextNodes(inner);
  const visible = decodeHtmlText(inner).replace(/\s+/g, '').trim();
  const nextOpen =
    href && visible === href.replace(/\s+/g, '') ? withFullUrlTitle(open, href) : open;
  return nextOpen + croppedInner + '</a>';
}

/**
 * Shorten URL text in rendered HTML. href, src, and other attributes stay intact.
 * An anchor whose label is the URL itself keeps the full target in `title`.
 */
export function cropRenderedUrlsInHtml(html: string): string {
  if (!html || !/https?:\/\/|wss?:\/\//i.test(html)) return html;
  const pieces: string[] = [];
  const re = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
  let last = 0;
  for (const match of html.matchAll(re)) {
    const index = match.index ?? 0;
    pieces.push(cropTextNodes(html.slice(last, index)));
    pieces.push(cropAnchor(match[0]));
    last = index + match[0].length;
  }
  pieces.push(cropTextNodes(html.slice(last)));
  return pieces.join('');
}
