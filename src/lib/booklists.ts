import type { Event } from 'nostr-tools';
import { KIND, NIP32_BOOKLIST_LABEL } from './constants';
import { parseAddress } from './library-scope';
import { extractNip32LabelValues, isListPublicationLabelEvent, isReadLabelSlug } from './nip32';
import { mergeById } from './nostr/fetch';
import { followPubkeysFromMetadata, type MuteState, notMuted } from './mute';
import { displayTitleForPublicationLabel, isHomeShelfSlug } from './publication-lists';
import { relayPool } from './nostr/pool';
import { socialStack, viewerOutboxStack } from './nostr/selector';
import { session } from './stores/session';

export type BooklistScope = 'all' | 'mine' | 'follows';

export type BooklistContributor = {
  pubkey: string;
  scope: 'mine' | 'follows' | 'network';
  pubs: string[];
};

export type BooklistEntry = {
  slug: string;
  title: string;
  contributors: BooklistContributor[];
  mine: boolean;
  follows: boolean;
  network: boolean;
};

export type BooklistScopedView = {
  slug: string;
  title: string;
  authors: string[];
  publicationCount: number;
};

type Acc = {
  /** author hex → publication addresses they labeled */
  byAuthor: Map<string, Set<string>>;
  authorScope: Map<string, 'mine' | 'follows' | 'network'>;
  mine: boolean;
  follows: boolean;
  network: boolean;
  display: string;
};

/** Publication `a` tags only — ignore wiki/spec/other targets and bare `e` ids. */
function publicationAddressKeys(event: Event): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of event.tags) {
    if (tag[0] !== 'a' || !tag[1]) continue;
    const parsed = parseAddress(tag[1]);
    if (parsed?.kind !== KIND.PUBLICATION) continue;
    if (seen.has(tag[1])) continue;
    seen.add(tag[1]);
    out.push(tag[1]);
  }
  return out;
}

/** Aggregate distinct publication list labels with authorship scope. */
export function aggregateBooklists(
  events: Event[],
  viewer: string | null,
  follows: Set<string>,
  mute?: MuteState
): BooklistEntry[] {
  const bySlug = new Map<string, Acc>();
  const viewerPk = viewer?.toLowerCase() ?? null;

  for (const event of events) {
    if (!isListPublicationLabelEvent(event)) continue;
    if (mute && !notMuted(event, mute)) continue;
    const pubs = publicationAddressKeys(event);
    if (!pubs.length) continue;
    const author = event.pubkey.toLowerCase();
    const scope: 'mine' | 'follows' | 'network' =
      viewerPk && author === viewerPk ? 'mine' : follows.has(author) ? 'follows' : 'network';

    for (const label of extractNip32LabelValues(event.tags)) {
      const key = label.toLowerCase();
      if (isReadLabelSlug(key)) continue;
      let acc = bySlug.get(key);
      if (!acc) {
        acc = {
          byAuthor: new Map(),
          authorScope: new Map(),
          mine: false,
          follows: false,
          network: false,
          display: label
        };
        bySlug.set(key, acc);
      }
      let authorPubs = acc.byAuthor.get(author);
      if (!authorPubs) {
        authorPubs = new Set();
        acc.byAuthor.set(author, authorPubs);
      }
      for (const pub of pubs) authorPubs.add(pub);
      acc.authorScope.set(author, scope);
      if (scope === 'mine') acc.mine = true;
      if (scope === 'follows') acc.follows = true;
      if (scope === 'network') acc.network = true;
    }
  }

  return [...bySlug.entries()]
    .map(([slug, acc]) => {
      const contributors: BooklistContributor[] = [...acc.byAuthor.entries()]
        .map(([pubkey, pubs]) => ({
          pubkey,
          scope: acc.authorScope.get(pubkey) ?? 'network',
          pubs: [...pubs]
        }))
        .sort((a, b) => b.pubs.length - a.pubs.length || a.pubkey.localeCompare(b.pubkey));
      return {
        slug,
        title:
          slug === NIP32_BOOKLIST_LABEL || isHomeShelfSlug(slug)
            ? displayTitleForPublicationLabel(slug)
            : acc.display,
        contributors,
        mine: acc.mine,
        follows: acc.follows,
        network: acc.network
      };
    })
    .sort((a, b) => {
      const aPubs = new Set(a.contributors.flatMap((c) => c.pubs)).size;
      const bPubs = new Set(b.contributors.flatMap((c) => c.pubs)).size;
      if (bPubs !== aPubs) return bPubs - aPubs;
      return a.title.localeCompare(b.title);
    });
}

export function filterBooklists(entries: BooklistEntry[], scope: BooklistScope): BooklistEntry[] {
  if (scope === 'mine') return entries.filter((e) => e.mine);
  if (scope === 'follows') return entries.filter((e) => e.follows);
  return entries;
}

/** Authors + publication count for the active scope filter. */
export function scopedBooklistView(entry: BooklistEntry, scope: BooklistScope): BooklistScopedView {
  const contributors =
    scope === 'mine'
      ? entry.contributors.filter((c) => c.scope === 'mine')
      : scope === 'follows'
        ? entry.contributors.filter((c) => c.scope === 'follows')
        : entry.contributors;
  const pubs = new Set<string>();
  for (const c of contributors) for (const p of c.pubs) pubs.add(p);
  return {
    slug: entry.slug,
    title: entry.title,
    authors: contributors.map((c) => c.pubkey),
    publicationCount: pubs.size
  };
}

export function parseBooklistScope(raw: string | null | undefined): BooklistScope {
  if (raw === 'mine' || raw === 'follows' || raw === 'all') return raw;
  return 'all';
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Fetch recent publication labels for the booklists overview. */
export async function loadBooklistLabelEvents(): Promise<Event[]> {
  const social = socialStack();
  const outbox = viewerOutboxStack();
  const viewer = session.getPubkey();
  const follows = [...followPubkeysFromMetadata(session.getMetadata())].slice(0, 60);
  const mineMeta = session.getMetadata().filter((e) => isListPublicationLabelEvent(e));

  const queries: Promise<Event[]>[] = [
    relayPool.query(social, [{ kinds: [KIND.LABEL], limit: 120 }], 4000)
  ];
  if (viewer) {
    queries.push(
      relayPool.query(social, [{ kinds: [KIND.LABEL], authors: [viewer], limit: 100 }], 4000),
      relayPool.query(
        outbox,
        [{ kinds: [KIND.LABEL], authors: [viewer], limit: 80 }],
        3500,
        2
      )
    );
  }
  for (const authors of chunk(follows, 20)) {
    queries.push(
      relayPool.query(social, [{ kinds: [KIND.LABEL], authors, limit: 80 }], 3500, 3)
    );
  }

  const settled = await Promise.allSettled(queries);
  const live: Event[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') live.push(...result.value);
  }
  return mergeById(live, mineMeta).filter(isListPublicationLabelEvent);
}
