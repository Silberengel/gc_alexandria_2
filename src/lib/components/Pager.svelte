<script lang="ts">
  interface Props {
    page: number;
    pageSize?: number;
    total: number;
    onPage: (page: number) => void;
  }

  let { page, pageSize = 25, total, onPage }: Props = $props();
  const pages = $derived(Math.max(1, Math.ceil(total / pageSize)));
</script>

{#if total > pageSize}
  <div class="pager">
    <button class="btn" type="button" disabled={page <= 1} onclick={() => onPage(page - 1)}>Previous</button>
    <span class="muted">Page {page} of {pages}</span>
    <button class="btn" type="button" disabled={page >= pages} onclick={() => onPage(page + 1)}>Next</button>
  </div>
{/if}
