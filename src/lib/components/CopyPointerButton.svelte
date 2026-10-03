<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Event } from 'nostr-tools';
  import { copyPointerForEvent } from '$lib/publication-load';
  import { libraryDocumentPath } from '$lib/metadata';
  import { KIND } from '$lib/constants';
  import { placeMenuPanel, type MenuPlacement } from '$lib/menu-placement';

  interface Props {
    event: Event;
    /** Extra class on the wrap (e.g. absolute positioning). */
    class?: string;
    /** Prefer opening toward the start (left) — e.g. left-side toolbars. */
    preferStart?: boolean;
    /** Absolute URL to copy as “Copy hyperlink” (reader deep link). Falls back to the library page. */
    shareUrl?: string;
    /** Replace the default ⋯ control (e.g. a bible verse number). */
    trigger?: Snippet;
    before?: Snippet;
    after?: Snippet;
  }

  let {
    event,
    class: className = '',
    preferStart = false,
    shareUrl = '',
    trigger,
    before,
    after
  }: Props = $props();

  let open = $state(false);
  let copied = $state(false);
  let linkCopied = $state(false);
  let timer = 0;
  let root: HTMLDivElement | undefined = $state();
  let panel: HTMLUListElement | undefined = $state();
  // Initial side is updated when opening; preferStart is applied in toggle().
  let place: MenuPlacement = $state({
    side: 'end',
    up: false,
    top: 0,
    left: 0,
    maxHeight: 280
  });

  const ptr = $derived(copyPointerForEvent(event));
  const njumpUrl = $derived(`https://njump.me/${ptr.text}`);
  /** Prefer an explicit reader share URL; otherwise the Alexandria document (or njump). */
  const hyperlink = $derived.by(() => {
    const explicit = shareUrl.trim();
    if (explicit) return explicit;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    if (
      event.kind === KIND.PUBLICATION ||
      event.kind === KIND.SECTION ||
      event.kind === KIND.WIKI ||
      event.kind === KIND.SPEC ||
      event.kind === KIND.LONG_FORM
    ) {
      return `${origin}/#${libraryDocumentPath(event)}`;
    }
    return njumpUrl;
  });

  function refreshPlace(measured?: { width: number; height: number }): void {
    if (!root) return;
    let next = placeMenuPanel(root, measured);
    if (preferStart) {
      const r = root.getBoundingClientRect();
      const w = measured?.width ?? 200;
      if (window.innerWidth - r.left - 8 >= w) {
        next = {
          ...next,
          side: 'start',
          left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8))
        };
      }
    }
    place = next;
  }

  /** After paint, measure the real panel and flip/clamp so it stays on-screen. */
  function refinePlace(): void {
    if (!root || !panel) return;
    const rect = panel.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return;
    refreshPlace({ width: Math.ceil(rect.width), height: Math.ceil(rect.height) });
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(ptr.text);
      copied = true;
      linkCopied = false;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        copied = false;
        close();
      }, 900);
    } catch {
      close();
    }
  }

  async function copyShareLink(): Promise<void> {
    if (!hyperlink) return;
    try {
      await navigator.clipboard.writeText(hyperlink);
      linkCopied = true;
      copied = false;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        linkCopied = false;
        close();
      }, 900);
    } catch {
      close();
    }
  }

  function toggle(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (!open) refreshPlace();
    open = !open;
    if (!open) {
      copied = false;
      linkCopied = false;
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
    const onReposition = () => {
      refinePlace();
    };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReposition);
    // Capture: reading pane / ToC may scroll inside nested containers.
    window.addEventListener('scroll', onReposition, true);
    const tick = requestAnimationFrame(() => {
      refinePlace();
      // Second frame: fonts/layout may still settle after first paint.
      requestAnimationFrame(refinePlace);
    });
    return () => {
      cancelAnimationFrame(tick);
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
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
      class="menu-panel menu-panel-fixed"
      bind:this={panel}
      style={`top:${place.top}px;left:${place.left}px;max-height:${place.maxHeight}px;overflow-y:auto`}
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
            void copyShareLink();
          }}
        >
          {linkCopied ? 'Copied' : 'Copy hyperlink'}
        </button>
      </li>
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
          View on Njump
        </a>
      </li>
      {#if after}
        {@render after()}
      {/if}
    </ul>
  {/if}
</div>
