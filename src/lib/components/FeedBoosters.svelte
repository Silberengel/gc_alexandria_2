<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { uniqueReposterPubkeys } from '$lib/repost';
  import UserBadge from './UserBadge.svelte';

  interface Props {
    /** Kind 6 / 16 events that point at the note being shown. */
    boosts: Event[];
  }

  let { boosts }: Props = $props();

  const boosters = $derived(uniqueReposterPubkeys(boosts));
</script>

{#if boosters.length}
  <div class="feed-boosters" title="Reposted">
    <span class="feed-boost-label">Reposted</span>
    <div class="feed-booster-avatars">
      {#each boosters.slice(0, 8) as pk (pk)}
        <UserBadge pubkey={pk} avatarOnly />
      {/each}
      {#if boosters.length > 8}
        <span class="feed-booster-more muted">+{boosters.length - 8}</span>
      {/if}
    </div>
  </div>
{/if}

<style>
  .feed-boosters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.55rem;
    margin: 0 0 0.4rem;
  }
  .feed-boost-label {
    flex: 0 0 auto;
    font-size: 0.78rem;
    font-weight: 650;
    letter-spacing: 0.02em;
    color: color-mix(in srgb, var(--accent) 70%, var(--ink));
  }
  .feed-booster-avatars {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.15rem;
  }
  .feed-booster-avatars :global(.userbadge-avatar-only) {
    margin: 0;
  }
  .feed-booster-avatars :global(.userbadge-avatar) {
    width: 1.45rem;
    height: 1.45rem;
  }
  .feed-booster-more {
    font-size: 0.78rem;
    margin-left: 0.15rem;
  }
</style>
