<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { uniqueResponsePubkeys } from '$lib/comments';
  import UserBadge from './UserBadge.svelte';

  interface Props {
    bookmarks?: Event[];
    pins?: Event[];
    bookmarkSets?: Event[];
    curations?: Event[];
    labels?: Event[];
  }

  let {
    bookmarks = [],
    pins = [],
    bookmarkSets = [],
    curations = [],
    labels = []
  }: Props = $props();

  const bookmarkedBy = $derived(uniqueResponsePubkeys(bookmarks));
  const pinnedBy = $derived(uniqueResponsePubkeys(pins));
  const inBookmarkSetsBy = $derived(uniqueResponsePubkeys(bookmarkSets));
  const inCurationsBy = $derived(uniqueResponsePubkeys(curations));
  const labeledBy = $derived(uniqueResponsePubkeys(labels));
  const hasAny = $derived(
    bookmarkedBy.length > 0 ||
      pinnedBy.length > 0 ||
      inBookmarkSetsBy.length > 0 ||
      inCurationsBy.length > 0 ||
      labeledBy.length > 0
  );
</script>

{#if hasAny}
  <div class="work-attribution">
    {#if bookmarkedBy.length}
      <div class="work-attribution-row">
        <span class="work-attribution-label">Bookmarked by:</span>
        <div class="work-attribution-badges">
          {#each bookmarkedBy.slice(0, 16) as pk (pk)}
            <UserBadge pubkey={pk} />
          {/each}
          {#if bookmarkedBy.length > 16}
            <span class="work-attribution-more muted">+{bookmarkedBy.length - 16}</span>
          {/if}
        </div>
      </div>
    {/if}
    {#if pinnedBy.length}
      <div class="work-attribution-row">
        <span class="work-attribution-label">Pinned by:</span>
        <div class="work-attribution-badges">
          {#each pinnedBy.slice(0, 16) as pk (pk)}
            <UserBadge pubkey={pk} />
          {/each}
          {#if pinnedBy.length > 16}
            <span class="work-attribution-more muted">+{pinnedBy.length - 16}</span>
          {/if}
        </div>
      </div>
    {/if}
    {#if inBookmarkSetsBy.length}
      <div class="work-attribution-row">
        <span class="work-attribution-label">In bookmark sets by:</span>
        <div class="work-attribution-badges">
          {#each inBookmarkSetsBy.slice(0, 16) as pk (pk)}
            <UserBadge pubkey={pk} />
          {/each}
          {#if inBookmarkSetsBy.length > 16}
            <span class="work-attribution-more muted">+{inBookmarkSetsBy.length - 16}</span>
          {/if}
        </div>
      </div>
    {/if}
    {#if inCurationsBy.length}
      <div class="work-attribution-row">
        <span class="work-attribution-label">In curations by:</span>
        <div class="work-attribution-badges">
          {#each inCurationsBy.slice(0, 16) as pk (pk)}
            <UserBadge pubkey={pk} />
          {/each}
          {#if inCurationsBy.length > 16}
            <span class="work-attribution-more muted">+{inCurationsBy.length - 16}</span>
          {/if}
        </div>
      </div>
    {/if}
    {#if labeledBy.length}
      <div class="work-attribution-row">
        <span class="work-attribution-label">Labeled by:</span>
        <div class="work-attribution-badges">
          {#each labeledBy.slice(0, 16) as pk (pk)}
            <UserBadge pubkey={pk} />
          {/each}
          {#if labeledBy.length > 16}
            <span class="work-attribution-more muted">+{labeledBy.length - 16}</span>
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .work-attribution {
    display: grid;
    gap: 0.55rem;
    margin: 0.75rem 0 0;
    padding: 0.65rem 0 0;
    border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  }
  .work-attribution-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.55rem;
  }
  .work-attribution-label {
    flex: 0 0 auto;
    font-size: 0.82rem;
    font-weight: 650;
    letter-spacing: 0.01em;
    opacity: 0.78;
  }
  .work-attribution-badges {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.55rem;
    min-width: 0;
  }
  .work-attribution-badges :global(.userbadge) {
    font-size: 0.85rem;
    gap: 0.35rem;
  }
  .work-attribution-badges :global(.userbadge-avatar) {
    width: 1.35rem;
    height: 1.35rem;
  }
  .work-attribution-more {
    font-size: 0.8rem;
  }
</style>
