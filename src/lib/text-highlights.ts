import type { Event } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { KIND } from './constants';
import { ensureMetadata } from './ensure-metadata';
import { memoryFindMetadata } from './nostr/event-memory';
import {
  peekProfileThumb,
  rememberProfileFromKind0,
  type ProfileThumb
} from './profile-cache';
import { pickLatestReplaceable } from './nostr/replaceable';
import { session } from './stores/session';
import { cachedImageSrc } from './image-cache';

export type TextHighlight = {
  quote: string;
  pubkey: string;
  /** Kind-9802 event id — badge opens this highlight as a feed thread OP. */
  eventId?: string;
};

function fallbackName(pubkey: string): string {
  try {
    return nip19.npubEncode(pubkey).slice(0, 12) + '…';
  } catch {
    return pubkey.slice(0, 12) + '…';
  }
}

/** Warm the shared profile cache (e.g. right after the viewer creates a highlight). */
export function seedHighlightProfile(pubkey: string, meta?: Event | null): void {
  const pk = pubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pk)) return;
  if (meta?.kind === 0 && meta.pubkey.toLowerCase() === pk) {
    rememberProfileFromKind0(meta);
    return;
  }
  const mine = pickLatestReplaceable(session.getMetadata(), KIND.METADATA, pk);
  if (mine) rememberProfileFromKind0(mine);
}

async function loadProfile(pubkey: string): Promise<ProfileThumb> {
  const pk = pubkey.trim().toLowerCase();
  const peeked = peekProfileThumb(pk);
  if (peeked?.picture) return peeked;

  const mem = memoryFindMetadata(pk);
  if (mem) return rememberProfileFromKind0(mem);

  seedHighlightProfile(pk);
  const afterSeed = peekProfileThumb(pk);
  if (afterSeed?.picture) return afterSeed;

  const meta = await ensureMetadata(pk);
  if (meta) return rememberProfileFromKind0(meta);

  return afterSeed ?? peeked ?? { name: fallbackName(pk), picture: '' };
}

function highlightThreadHref(eventId: string, pubkey: string): string {
  const id = eventId.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id)) return '';
  try {
    const pk = pubkey.trim().toLowerCase();
    const pointer = /^[0-9a-f]{64}$/.test(pk)
      ? nip19.neventEncode({ id, author: pk, kind: KIND.HIGHLIGHT })
      : nip19.neventEncode({ id });
    return `#/feed?thread=${pointer}`;
  } catch {
    return '';
  }
}

function anonSvg(): SVGSVGElement {
  const anon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  anon.setAttribute('class', 'text-highlight-by-anon');
  anon.setAttribute('viewBox', '0 0 24 24');
  anon.setAttribute('aria-hidden', 'true');
  anon.innerHTML =
    '<circle cx="12" cy="12" r="12" fill="currentColor" opacity="0.18"/><circle cx="12" cy="9" r="3.4" fill="currentColor"/><path d="M5.2 19.2c1.4-3.1 3.8-4.6 6.8-4.6s5.4 1.5 6.8 4.6" fill="currentColor"/>';
  return anon;
}

function paintBadge(by: HTMLAnchorElement, profile: ProfileThumb): void {
  by.title = profile.name;
  by.setAttribute('aria-label', `Highlighted by ${profile.name}`);
  if (!profile.picture) {
    by.replaceChildren(anonSvg());
    return;
  }
  const img = document.createElement('img');
  img.className = 'text-highlight-by-avatar';
  img.alt = '';
  img.addEventListener('error', () => {
    by.replaceChildren(anonSvg());
  });
  void cachedImageSrc(profile.picture).then((src) => {
    img.src = src || profile.picture;
  });
  img.src = profile.picture;
  by.replaceChildren(img);
}

/** After HTML paint, attach tiny highlighter pfps to `mark.text-highlight`. */
export function attachHighlightBadges(node: HTMLElement): () => void {
  let cancelled = false;

  void (async () => {
    const marks = [
      ...node.querySelectorAll<HTMLElement>('mark.text-highlight[data-highlight-pubkey]')
    ];
    for (const mark of marks) {
      if (cancelled) return;
      if (mark.querySelector('.text-highlight-by')) continue;
      const pk = mark.getAttribute('data-highlight-pubkey')?.trim().toLowerCase() ?? '';
      if (!/^[0-9a-f]{64}$/.test(pk)) continue;
      const eventId = mark.getAttribute('data-highlight-id')?.trim().toLowerCase() ?? '';

      let npub = pk.slice(0, 8) + '…';
      try {
        npub = nip19.npubEncode(pk);
      } catch {
        /* ignore */
      }
      const href = highlightThreadHref(eventId, pk) || `#/p/${npub}`;
      const by = document.createElement('a');
      by.className = 'text-highlight-by';
      by.href = href;
      by.setAttribute('aria-label', 'Highlighted by');
      by.title = href.includes('thread=') ? 'Open highlight thread' : 'Highlighted by…';
      by.addEventListener('click', (e) => e.stopPropagation());
      by.appendChild(anonSvg());
      mark.appendChild(by);

      // Paint from shared cache immediately when warm.
      const peeked = peekProfileThumb(pk);
      if (peeked?.picture) paintBadge(by, peeked);

      const profile = await loadProfile(pk);
      if (cancelled) return;
      paintBadge(by, profile);
    }
  })();

  return () => {
    cancelled = true;
  };
}

export function textHighlightsFromEvents(events: Event[]): TextHighlight[] {
  const out: TextHighlight[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    const quote = event.content.replace(/\s+/g, ' ').trim();
    if (quote.length < 8) continue;
    const key = `${event.pubkey.toLowerCase()}:${quote.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ quote, pubkey: event.pubkey, eventId: event.id });
  }
  return out;
}
