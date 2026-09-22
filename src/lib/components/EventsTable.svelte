<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import Pager from './Pager.svelte';
  import {
    LISTING_PAGE_SIZE_TABLE,
    listingTableRow,
    sortListingRows,
    type ListingTableColumn
  } from '$lib/listing-table';

  interface Props {
    events: Event[];
  }

  let { events }: Props = $props();

  let sortColumn = $state<ListingTableColumn>('title');
  let sortDir = $state<'asc' | 'desc'>('asc');
  let page = $state(1);
  const pageSize = LISTING_PAGE_SIZE_TABLE;

  const rows = $derived(events.map(listingTableRow));
  const sorted = $derived(sortListingRows(rows, sortColumn, sortDir));
  const paged = $derived(sorted.slice((page - 1) * pageSize, page * pageSize));
  const eventIdsKey = $derived(
    events
      .map((e) => e.id)
      .sort()
      .join(',')
  );

  $effect(() => {
    eventIdsKey;
    page = 1;
  });

  $effect(() => {
    sortColumn;
    sortDir;
    page = 1;
  });

  function toggleSort(column: ListingTableColumn): void {
    if (sortColumn === column) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortColumn = column;
      sortDir = 'asc';
    }
  }

  function ariaSort(column: ListingTableColumn): 'ascending' | 'descending' | 'none' {
    if (sortColumn !== column) return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
  }
</script>

{#if events.length === 0}
  <p class="muted">Nothing to show.</p>
{:else}
  <div class="listing-table-wrap">
    <table class="listing-table">
      <thead>
        <tr>
          <th scope="col" aria-sort={ariaSort('title')}>
            <button type="button" class="listing-table-sort" onclick={() => toggleSort('title')}>
              Title{#if sortColumn === 'title'}{sortDir === 'asc' ? ' ↑' : ' ↓'}{/if}
            </button>
          </th>
          <th scope="col" aria-sort={ariaSort('author')}>
            <button type="button" class="listing-table-sort" onclick={() => toggleSort('author')}>
              Author{#if sortColumn === 'author'}{sortDir === 'asc' ? ' ↑' : ' ↓'}{/if}
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        {#each paged as row (row.id)}
          <tr>
            <td title={row.titleFull !== row.title ? row.titleFull : undefined}>
              {#if row.href}
                <a href={row.href} use:link>{row.title}</a>
              {:else}
                {row.title}
              {/if}
            </td>
            <td title={row.authorFull !== row.author ? row.authorFull : undefined}>
              {row.author || '—'}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <Pager {page} total={sorted.length} {pageSize} onPage={(p) => (page = p)} />
{/if}
