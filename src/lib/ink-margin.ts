import type { Event } from 'nostr-tools';

/** Drawing image in a comment body (animated GIF or static PNG/JPEG/WebP). */
const INK_IMAGE_URL =
  /https?:\/\/[^\s<>"']+\.(?:gif|png|jpe?g|webp)(?:\?[^\s<>"']*)?/i;
const QUOTE_LINE = /^>\s?(.*)$/gm;

/** True when a comment looks like an ink note (quoted passage + drawing image URL). */
export function isInkMarginComment(event: Event): boolean {
  const content = event.content ?? '';
  if (!INK_IMAGE_URL.test(content)) return false;
  return /^>/m.test(content.trim());
}

export type InkMarginChip = {
  eventId: string;
  quote: string;
  /** Drawing image URL (GIF, PNG, …). */
  gifUrl: string;
  pubkey: string;
};

/** Extract margin chips from comment/thread events. */
export function inkMarginChipsFromEvents(events: readonly Event[]): InkMarginChip[] {
  const out: InkMarginChip[] = [];
  for (const event of events) {
    if (!isInkMarginComment(event)) continue;
    const image = event.content.match(INK_IMAGE_URL)?.[0];
    if (!image) continue;
    const quotes: string[] = [];
    QUOTE_LINE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = QUOTE_LINE.exec(event.content))) {
      quotes.push(m[1] ?? '');
    }
    const quote = quotes.join('\n').trim();
    if (!quote) continue;
    out.push({
      eventId: event.id,
      quote,
      gifUrl: image,
      pubkey: event.pubkey
    });
  }
  return out;
}

/** Locate a quote inside plain text; returns start index or -1. */
export function findQuoteOffset(haystack: string, quote: string): number {
  const h = haystack.replace(/\s+/g, ' ');
  const q = quote.replace(/\s+/g, ' ').trim();
  if (!q) return -1;
  return h.indexOf(q);
}
