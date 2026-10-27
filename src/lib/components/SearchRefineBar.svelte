<script lang="ts">
  import type { Event } from 'nostr-tools';
  import {
    kindOptionLabel,
    pubkeyOptionLabel,
    uniqueKinds,
    uniquePubkeys,
    type SearchSortMode
  } from '$lib/search-refine';

  export type ResultScope = 'all' | 'mine' | 'follows';

  interface Props {
    events: Event[];
    kind: number | null;
    pubkey: string;
    sinceDate: string;
    untilDate: string;
    sort: SearchSortMode;
    resultScope?: ResultScope;
    showMineScope?: boolean;
    showFollowsScope?: boolean;
    onKind: (v: number | null) => void;
    onPubkey: (v: string) => void;
    onSinceDate: (v: string) => void;
    onUntilDate: (v: string) => void;
    onSort: (v: SearchSortMode) => void;
    onResultScope?: (v: ResultScope) => void;
    onClear: () => void;
  }

  let {
    events,
    kind,
    pubkey,
    sinceDate,
    untilDate,
    sort,
    resultScope = 'all',
    showMineScope = false,
    showFollowsScope = false,
    onKind,
    onPubkey,
    onSinceDate,
    onUntilDate,
    onSort,
    onResultScope,
    onClear
  }: Props = $props();

  const kinds = $derived(uniqueKinds(events));
  const pubkeys = $derived(uniquePubkeys(events));
  const showScope = $derived(Boolean(onResultScope) && (showMineScope || showFollowsScope));
  const hasRefine = $derived(
    kind != null ||
      !!pubkey ||
      !!sinceDate ||
      !!untilDate ||
      sort !== 'best' ||
      (showScope && resultScope !== 'all')
  );

  let detailsOpen = $state(false);
  let openedForActive = false;

  $effect(() => {
    if (hasRefine && !openedForActive) {
      detailsOpen = true;
      openedForActive = true;
    }
    if (!hasRefine) openedForActive = false;
  });
</script>

{#if events.length > 0}
  <details class="accordion search-refine-panel" bind:open={detailsOpen}>
    <summary>
      Advanced filter
      {#if hasRefine}
        <span class="search-refine-summary-active muted">· active</span>
      {/if}
    </summary>
    {#if showScope && onResultScope}
      <div class="booklist-scope search-result-scope" role="group" aria-label="Result source">
        <button
          type="button"
          class="booklist-scope-btn"
          class:active={resultScope === 'all'}
          aria-pressed={resultScope === 'all'}
          onclick={() => onResultScope('all')}
        >All</button>
        {#if showMineScope}
          <button
            type="button"
            class="booklist-scope-btn"
            class:active={resultScope === 'mine'}
            aria-pressed={resultScope === 'mine'}
            title="Published by you"
            onclick={() => onResultScope('mine')}
          >From me</button>
        {/if}
        {#if showFollowsScope}
          <button
            type="button"
            class="booklist-scope-btn"
            class:active={resultScope === 'follows'}
            aria-pressed={resultScope === 'follows'}
            title="Published by accounts you follow"
            onclick={() => onResultScope('follows')}
          >From follows</button>
        {/if}
      </div>
    {/if}
    <div class="search-refine-bar" role="group" aria-label="Refine results">
      <label class="search-refine-field">
        <span class="muted">Kind</span>
        <select
          value={kind == null ? '' : String(kind)}
          onchange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value;
            onKind(v === '' ? null : Number(v));
          }}
        >
          <option value="">All kinds</option>
          {#each kinds as k (k)}
            <option value={k}>{kindOptionLabel(k)}</option>
          {/each}
        </select>
      </label>
      <label class="search-refine-field">
        <span class="muted">Publisher</span>
        <select value={pubkey} onchange={(e) => onPubkey((e.currentTarget as HTMLSelectElement).value)}>
          <option value="">Anyone</option>
          {#each pubkeys as pk (pk)}
            <option value={pk}>{pubkeyOptionLabel(pk)}</option>
          {/each}
        </select>
      </label>
      <label class="search-refine-field">
        <span class="muted">From</span>
        <input type="date" value={sinceDate} onchange={(e) => onSinceDate(e.currentTarget.value)} />
      </label>
      <label class="search-refine-field">
        <span class="muted">To</span>
        <input type="date" value={untilDate} onchange={(e) => onUntilDate(e.currentTarget.value)} />
      </label>
      <label class="search-refine-field">
        <span class="muted">Sort</span>
        <select
          value={sort}
          onchange={(e) => onSort((e.currentTarget as HTMLSelectElement).value as SearchSortMode)}
        >
          <option value="best">Best match</option>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="title-asc">Title A–Z</option>
          <option value="title-desc">Title Z–A</option>
        </select>
      </label>
      {#if hasRefine}
        <button type="button" class="btn btn-ghost search-refine-clear" onclick={() => onClear()}>
          Clear filter
        </button>
      {/if}
    </div>
  </details>
{/if}
