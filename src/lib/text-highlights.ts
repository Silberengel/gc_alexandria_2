import type { Event } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { mount, unmount } from 'svelte';
import NostrRichText from '$lib/components/NostrRichText.svelte';
import { KIND } from './constants';
import { ensureMetadata } from './ensure-metadata';
import type { InkMarginChip } from './ink-margin';
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
  /** NIP-84 `comment` tag on the highlight. */
  note?: string;
  /** Ink-note GIF thumbnail URL. */
  inkUrl?: string;
  /** Ink-note event id (kind 1111) for its own thread link. */
  inkEventId?: string;
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

function highlightThreadHref(eventId: string, pubkey: string, kind: number = KIND.HIGHLIGHT): string {
  const id = eventId.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id)) return '';
  try {
    const pk = pubkey.trim().toLowerCase();
    const pointer = /^[0-9a-f]{64}$/.test(pk)
      ? nip19.neventEncode({ id, author: pk, kind })
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

function noteIconSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'text-highlight-note-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    '<path fill="currentColor" d="M5 3h10l4 4v14H5V3zm9 1.5V8h3.5L14 4.5zM7 11h10v1.5H7V11zm0 3.5h10V16H7v-1.5zm0 3.5h7V19.5H7V18z"/>';
  return svg;
}

function attachNoteChip(mark: HTMLElement, cleanups: Array<() => void>): void {
  if (mark.querySelector('.text-highlight-note')) return;
  const note = mark.getAttribute('data-highlight-note')?.trim() ?? '';
  if (!note) return;
  const eventId = mark.getAttribute('data-highlight-id')?.trim().toLowerCase() ?? '';
  const pk = mark.getAttribute('data-highlight-pubkey')?.trim().toLowerCase() ?? '';
  const href = highlightThreadHref(eventId, pk);

  const chip = document.createElement('span');
  chip.className = 'text-highlight-note';
  chip.addEventListener('click', (e) => e.stopPropagation());

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'text-highlight-note-btn';
  btn.setAttribute('aria-label', 'Show highlight note');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.appendChild(noteIconSvg());

  const pop = document.createElement('div');
  pop.className = 'text-highlight-note-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Highlight note');
  // Manual popover: auto light-dismiss raced with the icon click and reopened.
  const supportsPopover = typeof pop.showPopover === 'function';
  if (supportsPopover) pop.setAttribute('popover', 'manual');
  pop.hidden = true;

  const head = document.createElement('div');
  head.className = 'text-highlight-note-head';
  const headLabel = document.createElement('span');
  headLabel.className = 'text-highlight-note-label';
  headLabel.textContent = 'Note';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'text-highlight-note-close';
  closeBtn.setAttribute('aria-label', 'Close note');
  closeBtn.textContent = '×';
  head.appendChild(headLabel);
  head.appendChild(closeBtn);
  pop.appendChild(head);

  const body = document.createElement('div');
  body.className = 'text-highlight-note-body';
  pop.appendChild(body);

  if (href) {
    const openLink = document.createElement('a');
    openLink.className = 'text-highlight-note-open';
    openLink.href = href;
    openLink.setAttribute('aria-label', 'Open highlight thread');
    openLink.textContent = 'Open';
    openLink.addEventListener('click', (e) => e.stopPropagation());
    pop.appendChild(openLink);
  }

  chip.appendChild(btn);
  // Keep popover in the chip tree for fallback; showPopover still top-layers it.
  chip.appendChild(pop);
  mark.appendChild(chip);

  let open = false;
  let mounted = false;

  const ensureRichText = () => {
    if (mounted) return;
    mounted = true;
    const ui = mount(NostrRichText, {
      target: body,
      props: {
        content: note,
        showEmbeds: false,
        maxLines: 6
      }
    });
    cleanups.push(() => {
      try {
        unmount(ui);
      } catch {
        /* already gone */
      }
    });
  };

  const placePop = () => {
    const rect = btn.getBoundingClientRect();
    const margin = 8;
    const maxW = Math.min(352, window.innerWidth - margin * 2);
    pop.style.width = `${maxW}px`;
    const popH = Math.max(pop.offsetHeight || 0, 72);
    let top = rect.top - popH - 8;
    if (top < margin) top = Math.min(rect.bottom + 8, window.innerHeight - popH - margin);
    let left = rect.left;
    if (left + maxW > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - margin - maxW);
    }
    pop.style.top = `${Math.round(Math.max(margin, top))}px`;
    pop.style.left = `${Math.round(Math.max(margin, left))}px`;
  };

  const setOpen = (next: boolean) => {
    if (next === open) return;
    open = next;
    chip.classList.toggle('is-open', next);
    btn.setAttribute('aria-expanded', next ? 'true' : 'false');
    if (next) {
      ensureRichText();
      pop.hidden = false;
      placePop();
      if (supportsPopover) {
        try {
          pop.showPopover();
        } catch {
          /* fallback: already unhidden */
        }
      }
      requestAnimationFrame(() => {
        placePop();
        requestAnimationFrame(placePop);
      });
    } else {
      if (supportsPopover) {
        try {
          pop.hidePopover();
        } catch {
          /* ignore */
        }
      }
      pop.hidden = true;
    }
  };

  const onToggleClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(!open);
  };

  const onCloseClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      btn.focus();
    }
  };

  const onDocPointerDown = (e: PointerEvent) => {
    if (!open) return;
    const t = e.target;
    if (t instanceof Node && (btn.contains(t) || pop.contains(t))) return;
    setOpen(false);
  };

  btn.addEventListener('click', onToggleClick);
  closeBtn.addEventListener('click', onCloseClick);
  pop.addEventListener('keydown', onKeyDown);
  document.addEventListener('pointerdown', onDocPointerDown, true);

  cleanups.push(() => {
    btn.removeEventListener('click', onToggleClick);
    closeBtn.removeEventListener('click', onCloseClick);
    pop.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('pointerdown', onDocPointerDown, true);
    if (supportsPopover) {
      try {
        pop.hidePopover();
      } catch {
        /* ignore */
      }
    }
  });
}

function attachInkThumb(mark: HTMLElement): void {
  if (mark.querySelector('.text-highlight-ink')) return;
  const inkUrl = mark.getAttribute('data-ink-url')?.trim() ?? '';
  if (!/^https?:\/\//i.test(inkUrl)) return;
  const inkId = mark.getAttribute('data-ink-id')?.trim().toLowerCase() ?? '';
  const pk = mark.getAttribute('data-highlight-pubkey')?.trim().toLowerCase() ?? '';
  const href =
    highlightThreadHref(inkId, pk, KIND.COMMENT) ||
    highlightThreadHref(mark.getAttribute('data-highlight-id')?.trim() ?? '', pk);
  const thumb = document.createElement(href ? 'a' : 'span');
  thumb.className = 'text-highlight-ink';
  thumb.title = 'Open ink note';
  thumb.setAttribute('aria-label', 'Ink note');
  if (thumb instanceof HTMLAnchorElement) {
    thumb.href = href;
    thumb.addEventListener('click', (e) => e.stopPropagation());
  }
  const img = document.createElement('img');
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.addEventListener('error', () => {
    thumb.remove();
  });
  void cachedImageSrc(inkUrl).then((src) => {
    img.src = src || inkUrl;
  });
  img.src = inkUrl;
  thumb.appendChild(img);
  mark.appendChild(thumb);
}

/** After HTML paint, attach tiny highlighter pfps / notes / ink thumbs to marks. */
export function attachHighlightBadges(node: HTMLElement): () => void {
  let cancelled = false;
  const cleanups: Array<() => void> = [];
  const marks = [...node.querySelectorAll<HTMLElement>('mark.text-highlight')];

  // Notes/ink sync first so remounts don't leave a blank hover window.
  for (const mark of marks) {
    attachNoteChip(mark, cleanups);
    attachInkThumb(mark);
  }

  void (async () => {
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
    for (const stop of cleanups) stop();
  };
}

function highlightCommentTag(event: Event): string {
  for (const tag of event.tags) {
    if (tag[0] === 'comment' && tag[1]?.trim()) return tag[1].replace(/\s+/g, ' ').trim();
  }
  return '';
}

function quoteKey(quote: string): string {
  return quote.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function textHighlightsFromEvents(events: Event[]): TextHighlight[] {
  const out: TextHighlight[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    const quote = event.content.replace(/\s+/g, ' ').trim();
    if (quote.length < 8) continue;
    const key = `${event.pubkey.toLowerCase()}:${quoteKey(quote)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const note = highlightCommentTag(event);
    out.push({
      quote,
      pubkey: event.pubkey,
      eventId: event.id,
      ...(note ? { note } : {})
    });
  }
  return out;
}

/**
 * Fold ink-note chips into highlight annotations so one mark can carry a note
 * and/or a GIF thumbnail on the quoted source passage.
 */
export function mergeInkIntoHighlights(
  highlights: TextHighlight[],
  ink: readonly InkMarginChip[]
): TextHighlight[] {
  const byQuote = new Map<string, TextHighlight>();
  for (const h of highlights) {
    byQuote.set(quoteKey(h.quote), { ...h });
  }
  for (const chip of ink) {
    const key = quoteKey(chip.quote);
    if (!key || chip.quote.replace(/\s+/g, ' ').trim().length < 8) continue;
    const existing = byQuote.get(key);
    if (existing) {
      byQuote.set(key, {
        ...existing,
        inkUrl: chip.gifUrl,
        inkEventId: chip.eventId,
        pubkey: existing.pubkey || chip.pubkey
      });
    } else {
      byQuote.set(key, {
        quote: chip.quote.replace(/\s+/g, ' ').trim(),
        pubkey: chip.pubkey,
        eventId: chip.eventId,
        inkUrl: chip.gifUrl,
        inkEventId: chip.eventId
      });
    }
  }
  return [...byQuote.values()];
}
