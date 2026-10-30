import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { eventAddress, firstTag } from './nostr/verify';

export type GitRepositoryInfo = {
  identifier: string;
  name: string;
  description: string;
  webUrls: string[];
  cloneUrls: string[];
  relays: string[];
  maintainers: string[];
  topics: string[];
  earliestUniqueCommit: string | null;
  isFork: boolean;
};

export type IssueStatusKind =
  | typeof KIND.ISSUE_STATUS_OPEN
  | typeof KIND.ISSUE_STATUS_RESOLVED
  | typeof KIND.ISSUE_STATUS_CLOSED
  | typeof KIND.ISSUE_STATUS_DRAFT;

export type IssueStatusId = 'open' | 'resolved' | 'closed' | 'draft';

export type ResolvedIssueStatus = {
  id: IssueStatusId;
  kind: IssueStatusKind;
  label: string;
  event: Event | null;
};

export const ISSUE_STATUS_KINDS = [
  KIND.ISSUE_STATUS_OPEN,
  KIND.ISSUE_STATUS_RESOLVED,
  KIND.ISSUE_STATUS_CLOSED,
  KIND.ISSUE_STATUS_DRAFT
] as const;

const ISSUE_STATUS_SET = new Set<number>(ISSUE_STATUS_KINDS);

const STATUS_META: Record<
  IssueStatusKind,
  { id: IssueStatusId; label: string }
> = {
  [KIND.ISSUE_STATUS_OPEN]: { id: 'open', label: 'Open' },
  [KIND.ISSUE_STATUS_RESOLVED]: { id: 'resolved', label: 'Resolved' },
  [KIND.ISSUE_STATUS_CLOSED]: { id: 'closed', label: 'Closed' },
  [KIND.ISSUE_STATUS_DRAFT]: { id: 'draft', label: 'Draft' }
};

const DEFAULT_STATUS: ResolvedIssueStatus = {
  id: 'open',
  kind: KIND.ISSUE_STATUS_OPEN,
  label: 'Open',
  event: null
};

function multiTagValues(event: Pick<Event, 'tags'>, name: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of event.tags) {
    if ((tag[0] ?? '').toLowerCase() !== name.toLowerCase()) continue;
    for (const raw of tag.slice(1)) {
      const v = raw.trim();
      if (!v) continue;
      const key = v.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

export function isIssueStatusKind(kind: number): boolean {
  return ISSUE_STATUS_SET.has(kind);
}

export function isGitRepoKind(kind: number): boolean {
  return kind === KIND.GIT_REPO;
}

export function isGitIssueKind(kind: number): boolean {
  return kind === KIND.ISSUE;
}

export function parseGitRepository(event: Pick<Event, 'kind' | 'content' | 'tags'>): GitRepositoryInfo | null {
  if (event.kind !== KIND.GIT_REPO) return null;
  const identifier = (firstTag(event as Event, 'd') ?? '').trim();
  if (!identifier) return null;
  const nameTag = (firstTag(event as Event, 'name') ?? '').trim();
  const name =
    nameTag ||
    identifier.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) ||
    'Repository';
  const description =
    (firstTag(event as Event, 'description') ?? '').trim() ||
    (event.content ?? '').trim();
  const euc = event.tags
    .find(
      (t) =>
        (t[0] ?? '').toLowerCase() === 'r' &&
        (t[2] ?? '').toLowerCase() === 'euc' &&
        (t[1] ?? '').trim()
    )
    ?.[1]
    ?.trim();

  return {
    identifier,
    name,
    description,
    webUrls: multiTagValues(event, 'web'),
    cloneUrls: multiTagValues(event, 'clone'),
    relays: multiTagValues(event, 'relays'),
    maintainers: multiTagValues(event, 'maintainers'),
    topics: multiTagValues(event, 't'),
    earliestUniqueCommit: euc || null,
    isFork: event.tags.some((t) => (t[0] ?? '').toLowerCase() === 'u')
  };
}

/** Repo author + `maintainers` tags (hex pubkeys). */
export function gitRepoAuthorityPubkeys(repo: Event): Set<string> {
  const out = new Set<string>();
  const owner = repo.pubkey.trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(owner)) out.add(owner);
  for (const m of multiTagValues(repo, 'maintainers')) {
    const pk = m.trim().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(pk)) out.add(pk);
  }
  return out;
}

export function issueSubject(event: Pick<Event, 'content' | 'tags'>): string {
  const tagged = (firstTag(event as Event, 'subject') ?? '').trim();
  if (tagged) return tagged;
  const content = (event.content ?? '').trim();
  const match = content.match(/^Subject:\s*(.+)$/im);
  if (match?.[1]?.trim()) return match[1].trim();
  const firstLine = content.split(/\r?\n/).find((line) => line.trim())?.trim() ?? '';
  return firstLine.slice(0, 120);
}

export function issueBody(event: Pick<Event, 'content' | 'tags'>): string {
  const content = event.content ?? '';
  if ((firstTag(event as Event, 'subject') ?? '').trim()) return content.trim();
  return content.replace(/^Subject:\s*.+\n*/i, '').trim();
}

export function issueLabels(event: Pick<Event, 'tags'>): string[] {
  return multiTagValues(event, 't');
}

export function issueRepoCoordinate(event: Pick<Event, 'tags'>): string | null {
  for (const tag of event.tags) {
    if (tag[0] !== 'a' && tag[0] !== 'A') continue;
    const coord = (tag[1] ?? '').trim();
    if (coord.startsWith(`${KIND.GIT_REPO}:`)) return coord;
  }
  return null;
}

/** Common case spellings of a repo `d` (Alexandria vs alexandria). */
export function gitRepoDTagVariants(d: string): string[] {
  const raw = d.trim();
  if (!raw) return [];
  const lower = raw.toLowerCase();
  const titled = lower.charAt(0).toUpperCase() + lower.slice(1);
  return [...new Set([raw, lower, titled])];
}

/**
 * Address coordinates to query for issues under this announcement.
 * Relays index `#a` exactly — `Alexandria` and `alexandria` are different keys.
 */
export function repoIssueAddressVariants(repo: Event): string[] {
  const d = (firstTag(repo, 'd') ?? '').trim();
  const pk = repo.pubkey.trim().toLowerCase();
  if (!d || !/^[0-9a-f]{64}$/.test(pk)) return [];
  return gitRepoDTagVariants(d).map((id) => `${KIND.GIT_REPO}:${pk}:${id}`);
}

/** True when an issue's `a`/`A` tag points at this repo (d-tag case-insensitive). */
export function issueBelongsToRepo(issue: Pick<Event, 'tags'>, repo: Event): boolean {
  const wantPk = repo.pubkey.trim().toLowerCase();
  const wantD = (firstTag(repo, 'd') ?? '').trim().toLowerCase();
  if (!wantPk || !wantD) return false;
  for (const tag of issue.tags) {
    if (tag[0] !== 'a' && tag[0] !== 'A') continue;
    const coord = (tag[1] ?? '').trim();
    const parts = coord.split(':');
    if (parts.length < 3) continue;
    if (parts[0] !== String(KIND.GIT_REPO)) continue;
    if ((parts[1] ?? '').toLowerCase() !== wantPk) continue;
    if (parts.slice(2).join(':').toLowerCase() === wantD) return true;
  }
  return false;
}

/**
 * NIP-34: most recent status (by created_at) from the issue author or a
 * repository maintainer wins. Default Open when none apply.
 */
export function resolveIssueStatus(
  issue: Event,
  statusEvents: Event[],
  authorityPubkeys: Set<string>
): ResolvedIssueStatus {
  const issueId = issue.id.trim().toLowerCase();
  const author = issue.pubkey.trim().toLowerCase();
  const allowed = new Set(authorityPubkeys);
  if (/^[0-9a-f]{64}$/.test(author)) allowed.add(author);

  const candidates = statusEvents
    .filter((event) => {
      if (!isIssueStatusKind(event.kind)) return false;
      const pk = event.pubkey.trim().toLowerCase();
      if (!allowed.has(pk)) return false;
      return event.tags.some(
        (t) =>
          (t[0] === 'e' || t[0] === 'E') &&
          (t[1] ?? '').trim().toLowerCase() === issueId
      );
    })
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));

  const latest = candidates[0];
  if (!latest || !isIssueStatusKind(latest.kind)) return { ...DEFAULT_STATUS };

  const meta = STATUS_META[latest.kind as IssueStatusKind];
  return {
    id: meta.id,
    kind: latest.kind as IssueStatusKind,
    label: meta.label,
    event: latest
  };
}

export function statusLabelForKind(kind: number): string {
  if (!isIssueStatusKind(kind)) return 'Open';
  return STATUS_META[kind as IssueStatusKind].label;
}

export function shortCommit(commit: string): string {
  const c = commit.trim();
  return c.length <= 12 ? c : `${c.slice(0, 8)}…`;
}

export function displayRelayHost(url: string): string {
  return url.replace(/^wss?:\/\//i, '').replace(/\/+$/, '');
}

export function gitRepoAddress(event: Event): string {
  return eventAddress(event);
}

/** Compose prefill values for a new issue against this repository announcement. */
export function issueComposeValuesFromRepo(repo: Event): {
  repo_a: string;
  owner_p: string;
} {
  return {
    repo_a: eventAddress(repo),
    owner_p: repo.pubkey
  };
}
