import { KIND } from './constants';

/** Max length for card blurb when deriving from content. */
export const CARD_BLURB_MAX = 280;

export type CardBlurbMarkup = 'markdown' | 'asciidoc';

/** Prefer AsciiDoc stripping for wiki/spec/section bodies. */
export function blurbMarkupForKind(kind: number): CardBlurbMarkup {
  if (kind === KIND.SECTION || kind === KIND.WIKI || kind === KIND.SPEC) return 'asciidoc';
  return 'markdown';
}

/**
 * Replace `[[target]]` / `[[target|label]]` with display text.
 * Citation markers (`[[citation::…]]`) are removed.
 */
function wikilinksToPlaintext(s: string): string {
  return s.replace(/\[\[([^[\]]+)\]\]/g, (_m, inner: string) => {
    const linkContent = String(inner).trim();
    if (linkContent.toLowerCase().startsWith('citation::')) return ' ';
    if (linkContent.includes('|')) {
      const display = linkContent.split('|').slice(1).join('|').trim();
      return display || linkContent.split('|')[0]?.trim() || ' ';
    }
    return linkContent || ' ';
  });
}

/** Drop bare http(s) URLs left after macro stripping. */
function stripBareUrls(s: string): string {
  return s.replace(/https?:\/\/[^\s<>'")\]]+/gi, ' ');
}

/**
 * Plain-text teaser for cards: strip AsciiDoc / Markdown so summaries never show
 * raw `=`, `#`, `image::`, infobox attrs, or link markup.
 */
export function cardBlurb(
  raw: string | undefined,
  opts: { max?: number; markup?: CardBlurbMarkup } = {}
): string {
  const max = opts.max ?? CARD_BLURB_MAX;
  const markup = opts.markup ?? 'markdown';
  if (raw == null) return '';
  let s = raw.trim();
  if (!s) return '';

  s = wikilinksToPlaintext(s);

  s = s.replace(/```[\s\S]*?```/g, ' ');
  // Keep inline code text; drop only the backticks.
  s = s.replace(/`([^`]+)`/g, '$1');
  s = s.replace(/<[^>]+>/g, ' ');

  // ATX headings — wiki/spec often use Markdown even when blurb mode is AsciiDoc.
  s = s.replace(/^#{1,6}\s+/gm, '');
  s = s.replace(/\s#{1,6}\s+/g, ' ');

  if (markup === 'asciidoc') {
    s = s.replace(/^(={4,}|-{4,}|\*{4,}|_{4,}|\+{4,}|\.{4,}|\/{4,}|\|={3,})\s*$/gm, ' ');
    s = s.replace(/^:[A-Za-z0-9_!-]+:.*$/gm, ' ');
    s = s.replace(/^\[[^\]\n]*\]\s*$/gm, ' ');
    s = s.replace(/^\/\/.*$/gm, ' ');
    s = s.replace(/^=+\s+/gm, '');
    // Mid-line heading leftovers like "= Title == Description"
    s = s.replace(/\s==+\s+/g, ' ');
    s = s.replace(/^\.(?=\S)/gm, '');
    // Macros first — otherwise definition-list stripping eats `image::…` lines.
    s = s.replace(/image::?[^\s\[]+(?:\[[^\]]*\]|"[^\]]*")?/g, (m) => {
      const bracket = m.match(/\[([^\]]*)\]/);
      if (bracket) return bracket[1] || ' ';
      const quoted = m.match(/"([^\]]*)"/);
      if (quoted) return quoted[1] || ' ';
      return ' ';
    });
    s = s.replace(/link:[^[\s]+\[([^\]]*)\]/g, '$1');
    s = s.replace(/link:[^\s\[]+/g, ' ');
    s = s.replace(/https?:\/\/[^[\s]+\[([^\]]*)\]/g, '$1');
    // Infobox / attribute noise (role=orange, Foundation bloodstock:: …)
    s = s.replace(/\bInfobox\b/gi, ' ');
    s = s.replace(/\brole\s*=\s*[^\s,\]]+/gi, ' ');
    s = s.replace(
      /^(?!include::|ifdef::|ifndef::|endif::|literal::)[^\n:]{1,60}::\s*/gim,
      ''
    );
    s = s.replace(/\s::+\s*/g, ' ');
  } else {
    s = s.replace(/!\[[^\]]*]\([^)]*\)/g, ' ');
    s = s.replace(/\[([^\]]+)]\([^)]*\)/g, '$1');
    s = s.replace(/^>\s?/gm, '');
  }

  s = s.replace(/^\s{0,3}(=+|-+|~+|\^+|\*\s*\*[\s*]*)\s*$/gm, ' ');
  s = s.replace(/^[-*+]\s+/gm, '');
  s = s.replace(/^\d+\.\s+/gm, '');
  s = s.replace(/\*\*|__/g, '');
  s = s.replace(/~~/g, '');
  s = s.replace(/\*|_/g, ' ');
  // Percent-encoded leftovers from stripped link targets.
  s = s.replace(/%[0-9A-Fa-f]{2}/g, ' ');

  s = stripBareUrls(s);
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max).trimEnd()}…`;
}
