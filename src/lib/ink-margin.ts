import type { Event } from 'nostr-tools';

const GIF_URL = /https?:\/\/[^\s<>"']+\.gif(?:\?[^\s<>"']*)?/i;
const QUOTE_LINE = /^>\s?(.*)$/gm;

/** True when a comment looks like an ink note (quoted passage + GIF URL). */
export function isInkMarginComment(event: Event): boolean {
  const content = event.content ?? '';
  if (!GIF_URL.test(content)) return false;
  return /^>/m.test(content.trim());
}

export type InkMarginChip = {
  eventId: string;
  quote: string;
  gifUrl: string;
  pubkey: string;
};

/** Extract margin chips from comment/thread events. */
export function inkMarginChipsFromEvents(events: readonly Event[]): InkMarginChip[] {
  const out: InkMarginChip[] = [];
  for (const event of events) {
    if (!isInkMarginComment(event)) continue;
    const gif = event.content.match(GIF_URL)?.[0];
    if (!gif) continue;
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
      gifUrl: gif,
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
