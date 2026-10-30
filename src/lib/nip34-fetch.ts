import type { Event, Filter } from 'nostr-tools';
import { KIND } from './constants';
import { cachedEventsReferencing } from './nostr/cache';
import { authorInbox, withPreferredRelays } from './nostr/mailboxes';
import { relayPool } from './nostr/pool';
import { socialStack } from './nostr/selector';
import { eventAddress } from './nostr/verify';
import { fetchByAddress } from './nostr/fetch';
import { parseAddress } from './library-scope';
import {
  ISSUE_STATUS_KINDS,
  gitRepoAuthorityPubkeys,
  issueBelongsToRepo,
  issueRepoCoordinate,
  parseGitRepository,
  repoIssueAddressVariants,
  resolveIssueStatus,
  type ResolvedIssueStatus
} from './nip34';

function normalizeRelay(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

async function repoQueryRelays(
  repo: Event
): Promise<{ relays: string[]; maxRelays: number; bypassConstrain: boolean }> {
  const info = parseGitRepository(repo);
  const hints = (info?.relays ?? []).map(normalizeRelay).filter(Boolean);
  let inbox: string[] = [];
  try {
    inbox = await authorInbox(repo.pubkey);
  } catch {
    inbox = [];
  }
  const preferred = [...hints, ...inbox];
  const scoped = withPreferredRelays(
    socialStack(),
    preferred,
    8,
    Math.min(8, preferred.length || 4)
  );
  // NIP-34: issues live on the announcement's `relays` — dial them even when
  // Outboxes is off (constrain would otherwise drop non-viewer URLs).
  return { ...scoped, bypassConstrain: hints.length > 0 };
}

export async function fetchGitRepoByCoordinate(coord: string): Promise<Event | null> {
  const parsed = parseAddress(coord);
  if (!parsed || parsed.kind !== KIND.GIT_REPO) return null;
  return fetchByAddress(parsed.kind, parsed.pubkey, parsed.d);
}

export async function fetchIssuesForRepo(
  repo: Event,
  limit = 80,
  onCache?: (issues: Event[]) => void
): Promise<Event[]> {
  const coords = repoIssueAddressVariants(repo);
  const exact = eventAddress(repo);
  const byId = new Map<string, Event>();

  const take = (event: Event) => {
    if (event.kind !== KIND.ISSUE) return;
    if (!issueBelongsToRepo(event, repo)) return;
    byId.set(event.id.toLowerCase(), event);
  };

  const cached = (await cachedEventsReferencing(repo.id)).filter((e) => e.kind === KIND.ISSUE);
  for (const event of cached) {
    // Legacy exact match or case-insensitive a-tag.
    if (
      issueBelongsToRepo(event, repo) ||
      event.tags.some((t) => (t[0] === 'a' || t[0] === 'A') && t[1] === exact)
    ) {
      byId.set(event.id.toLowerCase(), event);
    }
  }
  if (byId.size) onCache?.([...byId.values()]);

  if (!coords.length) {
    return [...byId.values()].sort((a, b) => b.created_at - a.created_at);
  }

  const scoped = await repoQueryRelays(repo);
  const ownerPk = repo.pubkey.trim().toLowerCase();
  const filters: Filter[] = [
    { kinds: [KIND.ISSUE], '#a': coords, limit },
    { kinds: [KIND.ISSUE], '#A': coords, limit }
  ];
  // Owner `p` catch-all — some older issues only tagged a case variant we missed.
  if (/^[0-9a-f]{64}$/.test(ownerPk)) {
    filters.push({ kinds: [KIND.ISSUE], '#p': [ownerPk], limit });
  }

  const hits = await relayPool.query(scoped.relays, filters, 8000, scoped.maxRelays, undefined, {
    bypassConstrain: scoped.bypassConstrain,
    includeCooling: true
  });
  for (const event of hits) take(event);

  return [...byId.values()].sort((a, b) => b.created_at - a.created_at);
}

export async function fetchIssueStatuses(
  issueIds: string[],
  repo?: Event | null,
  limit = 100
): Promise<Event[]> {
  const unique = [
    ...new Set(issueIds.map((id) => id.trim().toLowerCase()).filter((id) => /^[0-9a-f]{64}$/.test(id)))
  ];
  if (!unique.length) return [];

  const byId = new Map<string, Event>();
  const statusKindSet = new Set<number>(ISSUE_STATUS_KINDS);
  const cachedLists = await Promise.all(unique.map((id) => cachedEventsReferencing(id)));
  for (const list of cachedLists) {
    for (const event of list) {
      if (statusKindSet.has(event.kind)) {
        byId.set(event.id.toLowerCase(), event);
      }
    }
  }

  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += 20) batches.push(unique.slice(i, i + 20));

  const scoped = repo
    ? await repoQueryRelays(repo)
    : { relays: socialStack(), maxRelays: 8, bypassConstrain: false };
  const filtersFor = (batch: string[]): Filter[] => {
    const filters: Filter[] = [
      { kinds: [...ISSUE_STATUS_KINDS], '#e': batch, limit },
      { kinds: [...ISSUE_STATUS_KINDS], '#E': batch, limit }
    ];
    if (repo) {
      const coords = repoIssueAddressVariants(repo);
      if (coords.length) {
        filters.push({ kinds: [...ISSUE_STATUS_KINDS], '#a': coords, limit });
      }
    }
    return filters;
  };

  const hits = await Promise.all(
    batches.map((batch) =>
      relayPool.query(scoped.relays, filtersFor(batch), 5000, scoped.maxRelays, undefined, {
        bypassConstrain: scoped.bypassConstrain,
        includeCooling: true
      })
    )
  );
  for (const list of hits) {
    for (const event of list) {
      if (statusKindSet.has(event.kind)) {
        byId.set(event.id.toLowerCase(), event);
      }
    }
  }
  return [...byId.values()];
}

export async function statusesByIssueId(
  issues: Event[],
  repo: Event
): Promise<Map<string, ResolvedIssueStatus>> {
  const authority = gitRepoAuthorityPubkeys(repo);
  const statuses = await fetchIssueStatuses(
    issues.map((i) => i.id),
    repo
  );
  const out = new Map<string, ResolvedIssueStatus>();
  for (const issue of issues) {
    out.set(issue.id.toLowerCase(), resolveIssueStatus(issue, statuses, authority));
  }
  return out;
}

export async function resolveIssueRepoAndStatus(issue: Event): Promise<{
  repo: Event | null;
  status: ResolvedIssueStatus;
}> {
  const coord = issueRepoCoordinate(issue);
  const repo = coord ? await fetchGitRepoByCoordinate(coord) : null;
  const authority = repo
    ? gitRepoAuthorityPubkeys(repo)
    : new Set([issue.pubkey.trim().toLowerCase()].filter((pk) => /^[0-9a-f]{64}$/.test(pk)));
  const statuses = await fetchIssueStatuses([issue.id], repo);
  return {
    repo,
    status: resolveIssueStatus(issue, statuses, authority)
  };
}
