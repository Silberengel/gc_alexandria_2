<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import UserBadge from './UserBadge.svelte';
  import IssueStatusBadge from './IssueStatusBadge.svelte';
  import { feedThreadPath } from '$lib/feed';
  import { resolveIssueRepoAndStatus } from '$lib/nip34-fetch';
  import { issueSubject, parseGitRepository, type ResolvedIssueStatus } from '$lib/nip34';

  interface Props {
    event: Event;
  }

  let { event }: Props = $props();

  let repo = $state<Event | null>(null);
  let status = $state<ResolvedIssueStatus | null>(null);
  let loading = $state(true);
  let fetchGen = 0;

  const subject = $derived(issueSubject(event));
  const repoInfo = $derived(repo ? parseGitRepository(repo) : null);
  const repoHref = $derived(repo ? `#${feedThreadPath(repo)}` : '');

  $effect(() => {
    const current = event;
    const gen = ++fetchGen;
    loading = true;
    repo = null;
    status = null;
    void (async () => {
      try {
        const hit = await resolveIssueRepoAndStatus(current);
        if (gen !== fetchGen) return;
        repo = hit.repo;
        status = hit.status;
      } finally {
        if (gen === fetchGen) loading = false;
      }
    })();
  });
</script>

<header class="issue-repo-header">
  <div class="issue-repo-header-top">
    {#if status}
      <IssueStatusBadge {status} />
    {:else if loading}
      <span class="muted">…</span>
    {/if}
    <h2 class="issue-repo-header-title">{subject || 'Issue'}</h2>
  </div>
  <p class="muted issue-repo-header-by">
    by <UserBadge pubkey={event.pubkey} />
  </p>
  {#if repo && repoInfo}
    <p class="issue-repo-header-repo">
      In
      <a class="issue-repo-link" href={repoHref} use:link>{repoInfo.name}</a>
      <span class="muted">(<code>{repoInfo.identifier}</code>)</span>
      ·
      <a class="issue-repo-jump" href={repoHref} use:link>Open repository thread</a>
    </p>
  {:else if !loading}
    <p class="muted">Repository announcement not found on your relays.</p>
  {/if}
</header>

<style>
  .issue-repo-header {
    display: grid;
    gap: 0.35rem;
    margin: 0 0 0.75rem;
    padding: 0.65rem 0.75rem;
    border: 1px solid color-mix(in srgb, var(--rule) 68%, transparent);
    border-radius: 0.45rem;
    background: color-mix(in srgb, var(--paper) 55%, var(--paper-light));
  }
  .issue-repo-header-top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem 0.65rem;
  }
  .issue-repo-header-title {
    margin: 0;
    font-size: 1.1rem;
    line-height: 1.3;
  }
  .issue-repo-header-by,
  .issue-repo-header-repo {
    margin: 0;
    font-size: 0.88rem;
  }
  .issue-repo-jump {
    font-weight: 600;
  }
</style>
