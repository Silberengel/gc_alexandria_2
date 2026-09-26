<script lang="ts">
  import { pagerItems } from '$lib/pager';

  interface Props {
    page: number;
    pageSize?: number;
    total: number;
    onPage: (page: number) => void;
  }

  let { page, pageSize = 48, total, onPage }: Props = $props();
  const pages = $derived(Math.max(1, Math.ceil(total / pageSize)));
  const items = $derived(pagerItems(page, pages));

  function go(next: number): void {
    const clamped = Math.min(pages, Math.max(1, next));
    if (clamped !== page) onPage(clamped);
  }
</script>

{#if total > pageSize}
  <nav class="pager" aria-label="Pagination">
    <button
      class="pager-nav"
      type="button"
      aria-label="First page"
      disabled={page <= 1}
      onclick={() => go(1)}
    >&lt;&lt;</button>
    <button
      class="pager-nav"
      type="button"
      aria-label="Previous page"
      disabled={page <= 1}
      onclick={() => go(page - 1)}
    >&lt;</button>
    <div class="pager-pages" role="list">
      {#each items as item, i (typeof item === 'number' ? item : `e-${i}`)}
        {#if item === 'ellipsis'}
          <span class="pager-ellipsis muted" role="listitem" aria-hidden="true">…</span>
        {:else}
          <span role="listitem">
            <button
              class="pager-page"
              class:pager-page-current={item === page}
              type="button"
              aria-current={item === page ? 'page' : undefined}
              aria-label={`Page ${item}`}
              disabled={item === page}
              onclick={() => go(item)}
            >
              {item}
            </button>
          </span>
        {/if}
      {/each}
    </div>
    <button
      class="pager-nav"
      type="button"
      aria-label="Next page"
      disabled={page >= pages}
      onclick={() => go(page + 1)}
    >&gt;</button>
    <button
      class="pager-nav"
      type="button"
      aria-label="Last page"
      disabled={page >= pages}
      onclick={() => go(pages)}
    >&gt;&gt;</button>
  </nav>
{/if}
