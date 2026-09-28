<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { placeMenuPanel, type MenuPlacement } from '$lib/menu-placement';
  import {
    exportPublicationDownload,
    type PublicationDownloadFormat
  } from '$lib/publication-export';

  interface Props {
    publication: Event;
    /** Already-loaded nested events (optional seed before Mercury / walk). */
    getSeedEvents?: () => Event[];
    /** Hide when the edition is catalog-only / unreadable. */
    disabled?: boolean;
  }

  let { publication, getSeedEvents, disabled = false }: Props = $props();

  let open = $state(false);
  let busy = $state<PublicationDownloadFormat | null>(null);
  let error = $state<string | null>(null);
  let place = $state<MenuPlacement>({ side: 'end', up: false, top: 0, left: 0 });
  let wrap: HTMLDivElement | undefined = $state();

  const formats: { format: PublicationDownloadFormat; label: string }[] = [
    { format: 'epub', label: 'EPUB' },
    { format: 'pdf', label: 'PDF' },
    { format: 'adoc', label: 'Asciidoc' }
  ];

  function close(): void {
    open = false;
  }

  function toggle(): void {
    if (disabled || busy) return;
    error = null;
    if (!open && wrap) place = placeMenuPanel(wrap, { width: 180, height: 160 });
    open = !open;
  }

  async function onExport(format: PublicationDownloadFormat): Promise<void> {
    if (disabled || busy) return;
    busy = format;
    error = null;
    open = false;
    try {
      await exportPublicationDownload(publication, format, getSeedEvents?.() ?? []);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = null;
    }
  }
  const formatLabel = $derived(
    busy === 'epub' ? 'EPUB' : busy === 'pdf' ? 'PDF' : busy === 'adoc' ? 'Asciidoc' : null
  );
</script>

<div class="menu-wrap edition-export-wrap" bind:this={wrap}>
  <button
    class="btn btn-icon export-btn"
    class:export-busy-btn={!!busy}
    type="button"
    disabled={disabled || !!busy}
    aria-expanded={open}
    aria-haspopup="menu"
    aria-busy={!!busy}
    aria-label={busy && formatLabel ? `Exporting ${formatLabel}…` : 'Export publication'}
    title={busy && formatLabel ? `Exporting ${formatLabel}…` : 'Export'}
    onclick={toggle}
  >
    {#if busy}
      <span class="export-spinner" aria-hidden="true"></span>
    {:else}
      <svg class="export-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 3a1 1 0 0 1 1 1v9.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42L11 13.59V4a1 1 0 0 1 1-1Zm-7 14a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z"
        />
      </svg>
    {/if}
  </button>
  {#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="export-backdrop" onclick={close} onkeydown={(e) => e.key === 'Escape' && close()}></div>
    <ul
      class="menu-panel menu-panel-fixed"
      class:menu-panel-end={place.side === 'end'}
      class:menu-panel-start={place.side === 'start'}
      class:menu-panel-up={place.up}
      style={`top:${place.top}px;left:${place.left}px;min-width:10rem`}
      role="menu"
      aria-label="Export"
    >
      <li class="menu-heading" role="presentation">Export</li>
      {#each formats as opt (opt.format)}
        <li>
          <button
            class="menu-item"
            type="button"
            role="menuitem"
            disabled={!!busy}
            onclick={() => void onExport(opt.format)}
          >
            {opt.label}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if busy && formatLabel}
    <p class="export-status" role="status" aria-live="polite">
      Exporting {formatLabel}… This can take a minute.
    </p>
  {:else if error}
    <p class="export-error" role="alert">{error}</p>
  {/if}
</div>
