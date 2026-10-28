<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount, tick } from 'svelte';
  import { shelfWheel } from '$lib/shelf-wheel';

  interface Props {
    /** Extra classes on the scrollport (e.g. `shelf-track-reading`). */
    class?: string;
    children: Snippet;
  }

  let { class: className = '', children }: Props = $props();

  let track = $state<HTMLElement | null>(null);
  let canLeft = $state(false);
  let canRight = $state(false);

  function update(): void {
    const node = track;
    if (!node) {
      canLeft = false;
      canRight = false;
      return;
    }
    const max = Math.max(0, node.scrollWidth - node.clientWidth);
    if (max <= 1) {
      canLeft = false;
      canRight = false;
      return;
    }
    canLeft = node.scrollLeft > 1;
    canRight = node.scrollLeft < max - 1;
  }

  function scrollByPage(dir: -1 | 1): void {
    const node = track;
    if (!node) return;
    const step = Math.max(160, Math.round(node.clientWidth * 0.78));
    node.scrollBy({ left: dir * step, behavior: 'smooth' });
  }

  onMount(() => {
    const node = track;
    if (!node) return;
    const onScroll = () => update();
    node.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => update());
    ro.observe(node);
    const mo = new MutationObserver(() => {
      void tick().then(update);
    });
    mo.observe(node, { childList: true, subtree: true, attributes: true });
    void tick().then(update);
    // Covers/images often change scrollWidth after decode.
    const t1 = window.setTimeout(update, 120);
    const t2 = window.setTimeout(update, 600);
    return () => {
      node.removeEventListener('scroll', onScroll);
      ro.disconnect();
      mo.disconnect();
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  });
</script>

<div class="shelf-scroller" class:shelf-scroller-scrollable={canLeft || canRight}>
  {#if canLeft || canRight}
    <button
      type="button"
      class="shelf-arrow shelf-arrow-prev"
      title="Scroll left"
      aria-label="Scroll shelf left"
      disabled={!canLeft}
      onclick={() => scrollByPage(-1)}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
        <path
          d="M14.5 5.5 8 12l6.5 6.5"
          stroke="currentColor"
          stroke-width="1.85"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
    <button
      type="button"
      class="shelf-arrow shelf-arrow-next"
      title="Scroll right"
      aria-label="Scroll shelf right"
      disabled={!canRight}
      onclick={() => scrollByPage(1)}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
        <path
          d="M9.5 5.5 16 12l-6.5 6.5"
          stroke="currentColor"
          stroke-width="1.85"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  {/if}
  <div class={['shelf-track', className].filter(Boolean).join(' ')} bind:this={track} use:shelfWheel>
    {@render children()}
  </div>
</div>
