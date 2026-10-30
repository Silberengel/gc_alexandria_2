<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link, push } from 'svelte-spa-router';
  import UserBadge from './UserBadge.svelte';
  import IssueStatusBadge from './IssueStatusBadge.svelte';
  import LoadingHint from './LoadingHint.svelte';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { feedThreadPath } from '$lib/feed';
  import { formatRelativeTime } from '$lib/relative-time';
  import { fetchIssuesForRepo, statusesByIssueId } from '$lib/nip34-fetch';
  import {
    issueComposeValuesFromRepo,
    issueLabels,
    issueSubject,
    type IssueStatusId,
    type ResolvedIssueStatus
  } from '$lib/nip34';

  type StatusFilter = IssueStatusId | 'all';

  const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
    { id: 'open', label: 'Open' },
    { id: 'resolved', label: 'Resolved' },
    { id: 'closed', label: 'Closed' },
    { id: 'draft', label: 'Draft' },
    { id: 'all', label: 'All' }
  ];

  interface Props {
    repo: Event;
  }

  let { repo }: Props = $props();

  let issues = $state<Event[]>([]);
  let statuses = $state<Map<string, ResolvedIssueStatus>>(new Map());
  let statusFilter = $state<StatusFilter>('open');
  let loading = $state(true);
  let fetchGen = 0;

  function issueStatusId(issue: Event): IssueStatusId {
    return statuses.get(issue.id.toLowerCase())?.id ?? 'open';
  }

  const filteredIssues = $derived(
    statusFilter === 'all'
      ? issues
      : issues.filter((issue) => issueStatusId(issue) === statusFilter)
  );

  function composeHref(): string {
    const values = issueComposeValuesFromRepo(repo);
    const q = new URLSearchParams();
    q.set('kind', '1621');
    q.set('a', values.repo_a);
    q.set('p', values.owner_p);
    return `#/compose?${q.toString()}`;
  }

  function openNewIssue(): void {
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    void push(composeHref().slice(1));
  }

  $effect(() => {
    const current = repo;
    const gen = ++fetchGen;
    loading = true;
    void (async () => {
      try {
        const list = await fetchIssuesForRepo(current, 80, (cached) => {
          if (gen === fetchGen) issues = cached;
        });
        if (gen !== fetchGen) return;
        issues = list;
        statuses = await statusesByIssueId(list, current);
      } finally {
        if (gen === fetchGen) loading = false;
      }
    })();
  });
</script>

<section class="repo-issues-panel">
  <div class="repo-issues-toolbar">
    <h2 class="section-title">Issues</h2>
    <div class="repo-issues-toolbar-actions">
      <label class="repo-issues-status-filter">
        <span class="visually-hidden">Status</span>
        <select
          class="page-filter"
          bind:value={statusFilter}
          aria-label="Issue status"
        >
          {#each STATUS_FILTERS as opt (opt.id)}
            <option value={opt.id}>{opt.label}</option>
          {/each}
        </select>
      </label>
      <button class="btn btn-primary" type="button" onclick={openNewIssue}>New issue</button>
    </div>
  </div>

  {#if loading && !issues.length}
    <LoadingHint message="Loading issues…" compact />
  {:else if !issues.length}
    <p class="muted">No issues yet.</p>
  {:else if !filteredIssues.length}
    <p class="muted">
      {#if statusFilter === 'all'}
        No issues yet.
      {:else}
        No {STATUS_FILTERS.find((o) => o.id === statusFilter)?.label.toLowerCase() ?? statusFilter} issues.
      {/if}
    </p>
  {:else}
    <ul class="repo-issues-list">
      {#each filteredIssues as issue (issue.id)}
        {@const status = statuses.get(issue.id.toLowerCase())}
        {@const labels = issueLabels(issue)}
        <li class="repo-issue-row">
          <a class="repo-issue-link" href={`#${feedThreadPath(issue)}`} use:link>
            <span class="repo-issue-status">
              {#if status}
                <IssueStatusBadge {status} />
              {/if}
            </span>
            <span class="repo-issue-main">
              <span class="repo-issue-subject">{issueSubject(issue) || 'Untitled issue'}</span>
              {#if labels.length}
                <span class="repo-issue-labels">
                  {#each labels as label}
                    <span class="chip chip-quiet">#{label}</span>
                  {/each}
                </span>
              {/if}
              <span class="muted repo-issue-meta">
                <UserBadge pubkey={issue.pubkey} />
                · {formatRelativeTime(issue.created_at)}
              </span>
            </span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .repo-issues-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.65rem 1rem;
    margin-bottom: 0.65rem;
  }
  .repo-issues-toolbar .section-title {
    margin: 0;
  }
  .repo-issues-toolbar-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.65rem;
  }
  .repo-issues-status-filter {
    display: inline-flex;
    align-items: center;
  }
  .repo-issues-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.45rem;
  }
  .repo-issue-link {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.65rem;
    align-items: start;
    padding: 0.55rem 0.65rem;
    border: 1px solid color-mix(in srgb, var(--rule) 65%, transparent);
    border-radius: 0.4rem;
    text-decoration: none;
    color: inherit;
    background: color-mix(in srgb, var(--paper) 40%, var(--paper-light));
  }
  .repo-issue-link:hover {
    border-color: color-mix(in srgb, var(--accent) 40%, var(--rule));
  }
  .repo-issue-main {
    display: grid;
    gap: 0.25rem;
    min-width: 0;
  }
  .repo-issue-subject {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .repo-issue-labels {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .repo-issue-meta {
    font-size: 0.82rem;
  }
</style>
