import type { Event } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { relayPool } from './nostr/pool';
import { profileStack } from './nostr/selector';
import { firstTag } from './nostr/verify';
import { toNostrBuildThumbUrl } from './nostr-build';
import { session } from './stores/session';

export type TextHighlight = {
  quote: string;
  pubkey: string;
};

const profileCache = new Map<string, { name: string; picture: string }>();
const profileInflight = new Map<string, Promise<{ name: string; picture: string }>>();

function kind0Value(event: Event, tagName: string, jsonKeys: string[]): string {
  const tagged = firstTag(event, tagName)?.trim();
  if (tagged) return tagged;
  try {
    const data = JSON.parse(event.content) as Record<string, unknown>;
    for (const key of jsonKeys) {
      const value = data[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  } catch {
    /* ignore */
  }
  return '';
}

function profileFromKind0(meta: Event): { name: string; picture: string } {
  let name = '';
  try {
    name = nip19.npubEncode(meta.pubkey).slice(0, 12) + '…';
  } catch {
    name = meta.pubkey.slice(0, 12) + '…';
  }
  name =
    kind0Value(meta, 'display_name', ['display_name']) ||
    kind0Value(meta, 'name', ['name', 'display_name']) ||
    name;
  const picture = toNostrBuildThumbUrl(kind0Value(meta, 'picture', ['picture']));
  return { name, picture };
}

/** Warm the avatar cache (e.g. right after the viewer creates a highlight). */
export function seedHighlightProfile(pubkey: string, meta?: Event | null): void {
  const pk = pubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pk)) return;
  if (meta?.kind === 0 && meta.pubkey.toLowerCase() === pk) {
    profileCache.set(pk, profileFromKind0(meta));
    return;
  }
  const mine = session.getMetadata().find((e) => e.kind === 0 && e.pubkey.toLowerCase() === pk);
  if (mine) profileCache.set(pk, profileFromKind0(mine));
}

async function loadProfile(pubkey: string): Promise<{ name: string; picture: string }> {
  const pk = pubkey.trim().toLowerCase();
  const cached = profileCache.get(pk);
  if (cached) return cached;
  const pending = profileInflight.get(pk);
  if (pending) return pending;

  const job = (async () => {
    seedHighlightProfile(pk);
    const warmed = profileCache.get(pk);
    if (warmed?.picture) {
      profileInflight.delete(pk);
      return warmed;
    }

    let name = warmed?.name ?? '';
    let picture = warmed?.picture ?? '';
    if (!name) {
      try {
        name = nip19.npubEncode(pk).slice(0, 12) + '…';
      } catch {
        name = pk.slice(0, 12) + '…';
      }
    }
    try {
      const fetched = await relayPool.query(
        profileStack(),
        [{ kinds: [0], authors: [pk], limit: 1 }],
        4000
      );
      const meta = fetched[0];
      if (meta) {
        const parsed = profileFromKind0(meta);
        name = parsed.name || name;
        picture = parsed.picture || picture;
      }
    } catch {
      /* ignore */
    }
    const out = { name, picture };
    profileCache.set(pk, out);
    profileInflight.delete(pk);
    return out;
  })();

  profileInflight.set(pk, job);
  return job;
}

/** After HTML paint, attach tiny highlighter pfps to `mark.text-highlight`. */
export function attachHighlightBadges(node: HTMLElement): () => void {
  let cancelled = false;

  void (async () => {
    const marks = [...node.querySelectorAll<HTMLElement>('mark.text-highlight[data-highlight-pubkey]')];
    for (const mark of marks) {
      if (cancelled) return;
      if (mark.querySelector('.text-highlight-by')) continue;
      const pk = mark.getAttribute('data-highlight-pubkey')?.trim().toLowerCase() ?? '';
      if (!/^[0-9a-f]{64}$/.test(pk)) continue;

      let npub = pk.slice(0, 8) + '…';
      try {
        npub = nip19.npubEncode(pk);
      } catch {
        /* ignore */
      }

      const by = document.createElement('a');
      by.className = 'text-highlight-by';
      by.href = `#/p/${npub}`;
      by.setAttribute('aria-label', 'Highlighted by');
      by.title = 'Highlighted by…';
      by.addEventListener('click', (e) => e.stopPropagation());

      const anon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      anon.setAttribute('class', 'text-highlight-by-anon');
      anon.setAttribute('viewBox', '0 0 24 24');
      anon.setAttribute('aria-hidden', 'true');
      anon.innerHTML =
        '<circle cx="12" cy="12" r="12" fill="currentColor" opacity="0.18"/><circle cx="12" cy="9" r="3.4" fill="currentColor"/><path d="M5.2 19.2c1.4-3.1 3.8-4.6 6.8-4.6s5.4 1.5 6.8 4.6" fill="currentColor"/>';
      by.appendChild(anon);
      mark.appendChild(by);

      const profile = await loadProfile(pk);
      if (cancelled) return;
      by.title = profile.name;
      by.setAttribute('aria-label', `Highlighted by ${profile.name}`);
      if (profile.picture) {
        const img = document.createElement('img');
        img.className = 'text-highlight-by-avatar';
        img.src = profile.picture;
        img.alt = '';
        img.addEventListener('error', () => {
          // Clone — `anon` may still be in the tree until replaceChildren; never move it with replaceWith.
          by.replaceChildren(anon.cloneNode(true));
        });
        by.replaceChildren(img);
      }
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
    out.push({ quote, pubkey: event.pubkey });
  }
  return out;
}
