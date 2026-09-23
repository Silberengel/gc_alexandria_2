<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Event } from 'nostr-tools';
  import { copyPointerForEvent } from '$lib/publication-load';
  import { placeMenuPanel, type MenuPlacement } from '$lib/menu-placement';

  interface Props {
    event: Event;
    /** Extra class on the wrap (e.g. absolute positioning). */
    class?: string;
    /** Prefer opening toward the start (left) — e.g. left-side toolbars. */
    preferStart?: boolean;
    /** Replace the default ⋯ control (e.g. a bible verse number). */
    trigger?: Snippet;
    before?: Snippet;
    after?: Snippet;
  }

  let {
    event,
    class: className = '',
    preferStart = false,
    trigger,
    before,
    after
  }: Props = $props();

  let open = $state(false);
  let copied = $state(false);
  let timer = 0;
  let root: HTMLDivElement | undefined = $state();
  // Initial side is updated when opening; preferStart is applied in toggle().
  let place: MenuPlacement = $state({ side: 'end', up: false });

  const ptr = $derived(copyPointerForEvent(event));
  const njumpUrl = $derived(`https://njump.me/${ptr.text}`);
  const jumbleUrl = $derived(`https://jumble.imwald.eu/notes/${ptr.text}`);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(ptr.text);
      copied = true;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        copied = false;
        close();
      }, 900);
    } catch {
      close();
    }
  }

  function toggle(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (!open && root) {
      place = placeMenuPanel(root);
      if (preferStart) {
        const r = root.getBoundingClientRect();
        if (window.innerWidth - r.left - 8 >= 200) place = { ...place, side: 'start' };
      }
    }
    open = !open;
    if (!open) {
      copied = false;
      clearTimeout(timer);
    }
  }

  function close(): void {
    open = false;
  }

  function onPanelClick(e: MouseEvent): void {
    const item = (e.target as HTMLElement | null)?.closest?.('.menu-item');
    if (!item) return;
    if (item instanceof HTMLAnchorElement) return;
    if (item.hasAttribute('data-copy-action')) return;
    queueMicrotask(close);
  }

  $effect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onResize = () => {
      if (root) place = placeMenuPanel(root);
    };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  });
</script>

<div
  class={`menu-wrap event-more-menu ${className}`.trim()}
  class:event-more-menu-open={open}
  bind:this={root}
>
  <button
    class="btn btn-icon copy-pointer-btn"
    class:copy-pointer-btn-custom={!!trigger}
    type="button"
    title="More"
    aria-label="More actions"
    aria-expanded={open}
    aria-haspopup="menu"
    onclick={toggle}
  >
    {#if trigger}
      {@render trigger()}
    {:else}
      <span class="more-ellipsis" aria-hidden="true">⋯</span>
    {/if}
  </button>
  {#if open}
    <ul
      class="menu-panel"
      class:menu-panel-end={place.side === 'end'}
      class:menu-panel-start={place.side === 'start'}
      class:menu-panel-up={place.up}
      role="menu"
      onclick={onPanelClick}
      onkeydown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      }}
    >
      {#if before}
        {@render before()}
      {/if}
      <li role="none">
        <button
          class="menu-item"
          type="button"
          role="menuitem"
          data-copy-action
          onclick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void copy();
          }}
        >
          {copied ? 'Copied' : ptr.label}
        </button>
      </li>
      <li role="none">
        <a
          class="menu-item"
          role="menuitem"
          href={njumpUrl}
          target="_blank"
          rel="noopener noreferrer"
          onclick={(e) => {
            e.stopPropagation();
            close();
          }}
        >
          njump.me
        </a>
      </li>
      <li role="none">
        <a
          class="menu-item"
          role="menuitem"
          href={jumbleUrl}
          target="_blank"
          rel="noopener noreferrer"
          onclick={(e) => {
            e.stopPropagation();
            close();
          }}
        >
          jumble.imwald.eu
        </a>
      </li>
      {#if after}
        {@render after()}
      {/if}
    </ul>
  {/if}
</div>
