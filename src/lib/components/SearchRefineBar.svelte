<script lang="ts">
  import type { Event } from 'nostr-tools';
  import {
    kindOptionLabel,
    pubkeyOptionLabel,
    uniqueKinds,
    uniquePubkeys,
    type SearchSortMode
  } from '$lib/search-refine';

  interface Props {
    events: Event[];
    kind: number | null;
    pubkey: string;
    sinceDate: string;
    untilDate: string;
    sort: SearchSortMode;
    onKind: (v: number | null) => void;
    onPubkey: (v: string) => void;
    onSinceDate: (v: string) => void;
    onUntilDate: (v: string) => void;
    onSort: (v: SearchSortMode) => void;
    onClear: () => void;
  }

  let {
    events,
    kind,
    pubkey,
    sinceDate,
    untilDate,
    sort,
    onKind,
    onPubkey,
    onSinceDate,
    onUntilDate,
    onSort,
    onClear
  }: Props = $props();

  const kinds = $derived(uniqueKinds(events));
  const pubkeys = $derived(uniquePubkeys(events));
  const hasRefine = $derived(
    kind != null || !!pubkey || !!sinceDate || !!untilDate || sort !== 'best'
  );
</script>

{#if events.length > 0}
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
        Clear refine
      </button>
    {/if}
  </div>
{/if}
