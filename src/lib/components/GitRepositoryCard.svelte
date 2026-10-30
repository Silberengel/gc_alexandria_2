<script lang="ts">
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import CopyPointerButton from './CopyPointerButton.svelte';
  import { parseGitRepository, shortCommit, displayRelayHost } from '$lib/nip34';

  interface Props {
    event: Event;
    showMenu?: boolean;
  }

  let { event, showMenu = true }: Props = $props();
  const info = $derived(parseGitRepository(event));
</script>

{#if info}
  <article class="card git-repo-card">
    {#if showMenu}
      <CopyPointerButton {event} class="generic-card-copy" />
    {/if}
    <div class="card-clip">
      <p class="generic-card-kind muted">Git repository</p>
      <h3 class="git-repo-name">{info.name}</h3>
      <p class="muted git-repo-id"><code>{info.identifier}</code></p>
      <p class="note-card-by muted">
        by <UserBadge pubkey={event.pubkey} />
        {#if info.isFork}
          <span class="git-repo-fork">fork</span>
        {/if}
      </p>
      {#if info.description}
        <p class="git-repo-desc">{info.description}</p>
      {/if}
      {#if info.earliestUniqueCommit}
        <p class="muted git-repo-euc">
          EUC <code>{shortCommit(info.earliestUniqueCommit)}</code>
        </p>
      {/if}
      {#if info.webUrls.length || info.cloneUrls.length}
        <ul class="git-repo-links">
          {#each info.webUrls as url}
            <li><a href={url} target="_blank" rel="noopener noreferrer">Browse</a></li>
          {/each}
          {#each info.cloneUrls as url}
            <li>
              <a href={url} target="_blank" rel="noopener noreferrer">Clone</a>
              <code class="muted">{url}</code>
            </li>
          {/each}
        </ul>
      {/if}
      {#if info.relays.length}
        <p class="muted git-repo-relays">
          Relays: {info.relays.map(displayRelayHost).join(', ')}
        </p>
      {/if}
      {#if info.topics.length}
        <div class="chip-row">
          {#each info.topics as topic}
            <span class="chip chip-quiet">#{topic}</span>
          {/each}
        </div>
      {/if}
    </div>
  </article>
{/if}

<style>
  .git-repo-name {
    margin: 0.15rem 0 0.2rem;
    font-size: 1.15rem;
    line-height: 1.3;
  }
  .git-repo-id {
    margin: 0 0 0.35rem;
    font-size: 0.82rem;
  }
  .git-repo-desc {
    margin: 0.35rem 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .git-repo-fork {
    margin-left: 0.35rem;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .git-repo-links {
    list-style: none;
    margin: 0.45rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.25rem;
  }
  .git-repo-links code {
    margin-left: 0.4rem;
    font-size: 0.78rem;
  }
  .git-repo-euc,
  .git-repo-relays {
    margin: 0.35rem 0 0;
    font-size: 0.82rem;
  }
</style>
