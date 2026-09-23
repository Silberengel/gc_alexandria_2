import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { firstTag } from './nostr/verify';

/** Kind-30041 sections published as bible verses (`type` = bible). */
export function isBibleSection(event: Event): boolean {
  if (event.kind !== KIND.SECTION) return false;
  return event.tags.some((t) => t[0] === 'type' && (t[1] ?? '').trim().toLowerCase() === 'bible');
}

/** Edition or loaded sections look like a bible — show the verse-styling toggle. */
export function offersVerseStyling(
  event: Event | null | undefined,
  sections: Event[] = []
): boolean {
  if (event) {
    const type = (firstTag(event, 'type') ?? '').trim().toLowerCase();
    if (type === 'bible') return true;
    if (event.tags.some((t) => t[0] === 'C' && (t[1] ?? '').trim().toLowerCase() === 'bible')) {
      return true;
    }
  }
  return sections.some(isBibleSection);
}

export type BibleDisplay =
  | { kind: 'verse'; chapter: string; verse: string; label: string }
  | { kind: 'heading'; title: string };

/** How to show a bible-typed section in the reading pane. */
export function bibleDisplay(event: Event): BibleDisplay {
  const title = (firstTag(event, 'title') ?? '').trim();
  const c = (firstTag(event, 'c') ?? '').trim();
  const s = (firstTag(event, 's') ?? '').trim();
  if (c && s) return { kind: 'verse', chapter: c, verse: s, label: `${c}:${s}` };
  const m = title.match(/^(\d+)\s*:\s*(\d+)\s*$/);
  if (m) return { kind: 'verse', chapter: m[1]!, verse: m[2]!, label: `${m[1]}:${m[2]}` };
  return { kind: 'heading', title: title || 'Section' };
}

export type ReaderGroup =
  | { kind: 'bible'; verses: Event[] }
  | { kind: 'block'; event: Event };

/** Collapse consecutive bible verse sections into flowing prose groups. */
export function groupReaderSections(list: Event[]): ReaderGroup[] {
  const out: ReaderGroup[] = [];
  for (const ev of list) {
    if (isBibleSection(ev)) {
      const last = out[out.length - 1];
      if (last?.kind === 'bible') last.verses.push(ev);
      else out.push({ kind: 'bible', verses: [ev] });
    } else {
      out.push({ kind: 'block', event: ev });
    }
  }
  return out;
}
