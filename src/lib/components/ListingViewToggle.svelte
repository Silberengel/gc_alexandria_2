<script lang="ts">
  import { listingDensity, type ListingDensity } from '$lib/stores/listing-density';

  interface Props {
    /** Optional label prefix for aria (e.g. "Search results"). */
    label?: string;
  }

  let { label = 'Listings' }: Props = $props();

  function setMode(next: ListingDensity): void {
    listingDensity.set(next);
  }
</script>

<div class="listing-view-toggle" role="group" aria-label="{label} layout">
  <button
    type="button"
    class="listing-view-btn"
    class:active={$listingDensity === 'full'}
    aria-pressed={$listingDensity === 'full'}
    aria-label="Full view"
    title="Full view"
    onclick={() => setMode('full')}
  >
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  </button>
  <button
    type="button"
    class="listing-view-btn"
    class:active={$listingDensity === 'list'}
    aria-pressed={$listingDensity === 'list'}
    aria-label="Compact grid"
    title="Compact grid"
    onclick={() => setMode('list')}
  >
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  </button>
  <button
    type="button"
    class="listing-view-btn"
    class:active={$listingDensity === 'table'}
    aria-pressed={$listingDensity === 'table'}
    aria-label="Table view"
    title="Table view"
    onclick={() => setMode('table')}
  >
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  </button>
</div>
