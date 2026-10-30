<script lang="ts">
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import CopyPointerButton from './CopyPointerButton.svelte';
  import IssueStatusBadge from './IssueStatusBadge.svelte';
  import { issueBody, issueLabels, issueSubject, type ResolvedIssueStatus } from '$lib/nip34';
  import { resolveIssueRepoAndStatus } from '$lib/nip34-fetch';

  interface Props {
    event: Event;
    showMenu?: boolean;
    /** Compact listing row (feed list). */
    compact?: boolean;
  }

  let { event, showMenu = true, compact = false }: Props = $props();

  let status = $state<ResolvedIssueStatus | null>(null);
  let fetchGen = 0;
  const subject = $derived(issueSubject(event));
  const body = $derived(issueBody(event));
  const labels = $derived(issueLabels(event));

  $effect(() => {
    const current = event;
    const gen = ++fetchGen;
    status = null;
    void (async () => {
      const hit = await resolveIssueRepoAndStatus(current);
      if (gen === fetchGen) status = hit.status;
    })();
  });
</script>

<article class="card note-card git-issue-card" class:compact>
  {#if showMenu}
    <CopyPointerButton {event} class="generic-card-copy" />
  {/if}
  <div class="card-clip">
    <div class="git-issue-head">
      <p class="generic-card-kind muted">Git issue</p>
      {#if status}
        <IssueStatusBadge {status} />
      {/if}
    </div>
    <h3 class="git-issue-title">{subject || 'Untitled issue'}</h3>
    <p class="note-card-by muted">
      by <UserBadge pubkey={event.pubkey} />
    </p>
    {#if labels.length}
      <div class="chip-row">
        {#each labels as label}
          <span class="chip chip-quiet">#{label}</span>
        {/each}
      </div>
    {/if}
    {#if !compact && body}
      <p class="git-issue-body">{body.slice(0, 280)}{body.length > 280 ? '…' : ''}</p>
    {/if}
  </div>
</article>

<style>
  .git-issue-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.35rem 0.65rem;
  }
  .git-issue-title {
    margin: 0.2rem 0 0.25rem;
    font-size: 1.05rem;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  .git-issue-body {
    margin: 0.4rem 0 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 0.92rem;
  }
  .compact .git-issue-title {
    font-size: 0.98rem;
  }
</style>
