/**
 * NIP-51 deprecated standard lists (addressable 30000/30001 with reserved `d`)
 * → normal replaceable 100xx lists.
 *
 * | deprecated        | use instead      |
 * | 30000 d=mute      | kind 10000       |
 * | 30001 d=pin       | kind 10001       |
 * | 30001 d=bookmark  | kind 10003       |
 * | 30001 d=communities | kind 10004     |
 */
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { firstTag, eventAddress } from './nostr/verify';
import { isNewerReplaceable, pickLatestReplaceable } from './nostr/replaceable';

/** @deprecated Prefer {@link KIND.DEPRECATED_CATEGORIZED_LIST}. */
export const NIP51_DEPRECATED_LIST_KIND = KIND.DEPRECATED_CATEGORIZED_LIST;

export type Nip51DeprecatedListD = 'mute' | 'pin' | 'bookmark' | 'communities';

export type Nip51DeprecatedMigration = {
  deprecated: Event;
  d: Nip51DeprecatedListD;
  standardKind: number;
  label: string;
};

const DEPRECATED_D_TO_KIND: Record<Nip51DeprecatedListD, number> = {
  mute: KIND.MUTE,
  pin: KIND.PIN,
  bookmark: KIND.BOOKMARK,
  communities: KIND.COMMUNITIES
};

const DEPRECATED_D_LABEL: Record<Nip51DeprecatedListD, string> = {
  mute: 'Mute list',
  pin: 'Pinned notes',
  bookmark: 'Bookmarks',
  communities: 'Communities'
};

function normalizeDeprecatedD(raw: string | undefined | null): Nip51DeprecatedListD | null {
  const d = (raw ?? '').trim().toLowerCase();
  if (d === 'mute' || d === 'mutes') return 'mute';
  if (d === 'pin' || d === 'pins' || d === 'pinned') return 'pin';
  if (d === 'bookmark' || d === 'bookmarks') return 'bookmark';
  if (d === 'communities' || d === 'community') return 'communities';
  return null;
}

/** True when this event is a deprecated NIP-51 list (not a normal follow/bookmark set). */
export function isDeprecatedNip51List(event: Event): boolean {
  return deprecatedListD(event) != null;
}

export function deprecatedListD(event: Event): Nip51DeprecatedListD | null {
  if (event.kind === KIND.FOLLOW_SET) {
    // Only d=mute is deprecated on 30000; other d values are normal follow sets.
    return normalizeDeprecatedD(firstTag(event, 'd')) === 'mute' ? 'mute' : null;
  }
  if (event.kind === NIP51_DEPRECATED_LIST_KIND) {
    return normalizeDeprecatedD(firstTag(event, 'd'));
  }
  return null;
}

export function standardKindForDeprecatedList(event: Event): number | null {
  const d = deprecatedListD(event);
  return d ? DEPRECATED_D_TO_KIND[d] : null;
}

/** Drop reserved deprecated `d` values so 30000 follow-set reads never treat mute as follows. */
export function isDeprecatedFollowSetMute(event: Event): boolean {
  return event.kind === KIND.FOLLOW_SET && normalizeDeprecatedD(firstTag(event, 'd')) === 'mute';
}

function newestForAuthor(events: Event[], kind: number, pubkey: string, d?: string): Event | null {
  const pk = pubkey.toLowerCase();
  const candidates = events.filter((e) => {
    if (e.kind !== kind || e.pubkey.toLowerCase() !== pk) return false;
    if (d == null) return true;
    return (firstTag(e, 'd') ?? '').trim().toLowerCase() === d;
  });
  if (!candidates.length) return null;
  return candidates.reduce((best, cur) => (isNewerReplaceable(cur, best) ? cur : best));
}

/**
 * Prefer the standard replaceable list; fall back to the deprecated addressable form.
 */
export function pickMuteList(events: Event[], pubkey?: string): Event | null {
  const standard = pickLatestReplaceable(events, KIND.MUTE, pubkey);
  if (standard) return standard;
  if (pubkey) return newestForAuthor(events, KIND.FOLLOW_SET, pubkey, 'mute');
  const deprecated = events.filter((e) => isDeprecatedFollowSetMute(e));
  if (!deprecated.length) return null;
  return deprecated.reduce((best, cur) => (isNewerReplaceable(cur, best) ? cur : best));
}

export function pickPinListWithDeprecated(events: Event[], pubkey: string): Event | null {
  const standard = pickLatestReplaceable(events, KIND.PIN, pubkey);
  if (standard) return standard;
  return newestForAuthor(events, NIP51_DEPRECATED_LIST_KIND, pubkey, 'pin');
}

export function pickBookmarkListWithDeprecated(events: Event[], pubkey?: string): Event | null {
  const standard = pickLatestReplaceable(events, KIND.BOOKMARK, pubkey);
  if (standard) return standard;
  if (pubkey) return newestForAuthor(events, NIP51_DEPRECATED_LIST_KIND, pubkey, 'bookmark');
  const deprecated = events.filter(
    (e) => e.kind === NIP51_DEPRECATED_LIST_KIND && normalizeDeprecatedD(firstTag(e, 'd')) === 'bookmark'
  );
  if (!deprecated.length) return null;
  return deprecated.reduce((best, cur) => (isNewerReplaceable(cur, best) ? cur : best));
}

/** Deprecated lists owned by `pubkey` that still exist (migrate + delete). */
export function findPendingNip51Migrations(events: Event[], pubkey: string): Nip51DeprecatedMigration[] {
  const pk = pubkey.toLowerCase();
  const byKey = new Map<string, Event>();
  for (const event of events) {
    if (event.pubkey.toLowerCase() !== pk) continue;
    const d = deprecatedListD(event);
    if (!d) continue;
    const key = `${event.kind}:${d}`;
    const prev = byKey.get(key);
    if (!prev || isNewerReplaceable(event, prev)) byKey.set(key, event);
  }

  const out: Nip51DeprecatedMigration[] = [];
  for (const event of byKey.values()) {
    const d = deprecatedListD(event)!;
    out.push({
      deprecated: event,
      d,
      standardKind: DEPRECATED_D_TO_KIND[d],
      label: DEPRECATED_D_LABEL[d]
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** Public tags for the standard list — drop the addressable `d` identifier. */
export function standardListTagsFromDeprecated(deprecated: Event): string[][] {
  return deprecated.tags.filter((t) => t[0] !== 'd');
}

function tagKey(tag: string[]): string {
  return tag.map((c) => c.toLowerCase()).join('\0');
}

/** Merge public tags from deprecated into an existing standard list (deduped). */
export function mergeStandardListTags(standard: Event | null, deprecated: Event): string[][] {
  const out: string[][] = [];
  const seen = new Set<string>();
  for (const tag of [...(standard?.tags ?? []), ...standardListTagsFromDeprecated(deprecated)]) {
    if (!tag[0] || tag[0] === 'd' || tag[0] === 'client') continue;
    const key = tagKey(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([...tag]);
  }
  return out;
}

/**
 * Publish the standard 100xx list (merging public tags with any existing twin +
 * preferring non-empty content), then NIP-09 delete the deprecated addressable event.
 */
export async function migrateDeprecatedNip51List(
  deprecated: Event,
  knownEvents: Event[] = []
): Promise<{ ok: true; standard: Event } | { ok: false; error: string }> {
  const d = deprecatedListD(deprecated);
  if (!d) return { ok: false, error: 'Not a deprecated NIP-51 list.' };
  const standardKind = DEPRECATED_D_TO_KIND[d];
  let twin: Event | null = knownEvents.length
    ? pickLatestReplaceable(knownEvents, standardKind, deprecated.pubkey)
    : null;
  if (!twin) {
    try {
      const { session } = await import('./stores/session');
      twin = pickLatestReplaceable(session.getMetadata(), standardKind, deprecated.pubkey);
    } catch {
      twin = null;
    }
  }

  const tags = mergeStandardListTags(twin, deprecated);
  const twinContent = (twin?.content ?? '').trim();
  const deprecatedContent = (deprecated.content ?? '').trim();
  const content = twinContent || deprecatedContent;

  // Lazy imports avoid a session ↔ mute ↔ migrate cycle at module load.
  const [{ signAndPublish }, { deletionDraft }] = await Promise.all([
    import('./sign'),
    import('./drafts')
  ]);
  const standard = await signAndPublish(
    {
      kind: standardKind,
      content,
      tags
    },
    { quiet: true }
  );
  if (!standard) return { ok: false, error: 'Could not publish the standard list.' };

  const deleted = await signAndPublish(deletionDraft(deprecated), { quiet: true });
  if (!deleted) {
    return {
      ok: false,
      error: `Published kind ${standardKind}, but could not delete ${eventAddress(deprecated)}.`
    };
  }
  return { ok: true, standard };
}
