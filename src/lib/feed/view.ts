import type { Event } from 'nostr-tools';
import { filterDeletedEvents } from '../deletions';
import { filterMuted, type MuteState } from '../mute';
import { filterPageEvents } from '../page-filter';

/** Client-side view filters — never trigger a relay requery. */
export type FeedViewOpts = {
  /** Unix lower bound from lookback; null = unlimited. */
  sinceUnix: number | null;
  /** Active kind dropdown; null = all kinds. */
  kind: number | null;
  /** Text search (`?q=`). */
  q: string;
  muted: MuteState;
  /** When set, only that author's events; since/kind/q are not applied. */
  author: string | null;
};

/**
 * Mute / delete / author / since / kind / text — same rules for the timeline
 * and for the New Events pending buffer.
 */
export function applyFeedView(events: Event[], opts: FeedViewOpts): Event[] {
  const author = opts.author?.trim().toLowerCase() || null;
  let base = filterDeletedEvents(
    filterMuted(
      author ? events.filter((event) => event.pubkey.toLowerCase() === author) : events,
      opts.muted
    )
  );
  if (author) return base;
  if (opts.sinceUnix != null) {
    base = base.filter((event) => event.created_at >= opts.sinceUnix!);
  }
  if (opts.kind != null) {
    base = base.filter((event) => event.kind === opts.kind);
  }
  if (opts.q.trim()) {
    base = filterPageEvents(base, opts.q);
  }
  return base;
}

/** Scope rows for the kind dropdown options (mute/delete/since, not kind/q). */
export function applyFeedScope(events: Event[], opts: FeedViewOpts): Event[] {
  return applyFeedView(events, { ...opts, kind: null, q: '' });
}
