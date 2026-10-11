<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { eventAddress } from '$lib/nostr/verify';
  import { eventSources } from '$lib/nostr/event-sources';
  import {
    exportPublicationDownload,
    type PublicationDownloadFormat
  } from '$lib/publication-export';
  import { cropRenderedUrlsInText } from '$lib/crop-url';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { opComposeId, registerOpReplyToolbar, toggleOpCompose } from '$lib/stores/op-reply';
  import CopyPointerButton from './CopyPointerButton.svelte';
  import LoadingHint from './LoadingHint.svelte';
  import HeartButton from './HeartButton.svelte';

  interface Props {
    event: Event;
    /** Extra sources known at the call site (merged with tracked provenance). */
    found?: string | string[];
    /** When set, offer EPUB / PDF / Asciidoc download in the ⋯ menu. */
    getSeedEvents?: () => Event[];
    canExport?: boolean;
  }

  let { event, found, getSeedEvents, canExport = false }: Props = $props();
  const replyOpen = $derived($opComposeId === event.id.toLowerCase());
  const canReply = $derived(!!$session.pubkey);

  $effect(() => registerOpReplyToolbar(event.id));

  function onReplyClick(): void {
    if (!canReply) {
      openLoginDialog();
      return;
    }
    toggleOpCompose(event.id);
  }
  const coord = $derived(eventAddress(event));
  const sources = $derived.by(() => {
    const tracked = eventSources(event.id);
    const extra = !found ? [] : Array.isArray(found) ? found : found.split(/[\n,]+/).map((s) => s.trim());
    const set = new Set([...tracked, ...extra].filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b));
  });

  const formats: { format: PublicationDownloadFormat; label: string }[] = [
    { format: 'epub', label: 'EPUB' },
    { format: 'pdf', label: 'PDF' },
    { format: 'adoc', label: 'Asciidoc' }
  ];

  let busy = $state<PublicationDownloadFormat | null>(null);
  let error = $state<string | null>(null);
  const formatLabel = $derived(
    busy === 'epub' ? 'EPUB' : busy === 'pdf' ? 'PDF' : busy === 'adoc' ? 'Asciidoc' : null
  );

  async function onExport(format: PublicationDownloadFormat): Promise<void> {
    if (!canExport || busy) return;
    busy = format;
    error = null;
    try {
      await exportPublicationDownload(event, format, getSeedEvents?.() ?? []);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = null;
    }
  }
</script>

<div class="details-panel-wrap">
  <div class="details-toolbar">
    <HeartButton {event} />
    <button
      class="btn btn-icon icon-action-btn thread-reply"
      type="button"
      aria-label={canReply ? 'Reply' : 'Sign in to reply'}
      title={canReply ? 'Reply' : 'Sign in to reply'}
      aria-expanded={replyOpen}
      onclick={onReplyClick}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          fill="currentColor"
          d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"
        />
      </svg>
    </button>
    <CopyPointerButton {event} class="details-more-menu">
      {#snippet after()}
        {#if canExport}
          <li class="menu-sep" role="separator"></li>
          <li class="menu-heading" role="presentation">Download</li>
          {#each formats as opt (opt.format)}
            <li role="none">
              <button
                class="menu-item"
                type="button"
                role="menuitem"
                disabled={!!busy}
                onclick={() => void onExport(opt.format)}
              >
                {busy === opt.format ? `Exporting ${opt.label}…` : opt.label}
              </button>
            </li>
          {/each}
        {/if}
      {/snippet}
    </CopyPointerButton>
  </div>
  <details class="accordion details-panel">
    <summary>Details</summary>
    <dl class="details-list">
      <dt>Event id</dt>
      <dd><code>{event.id}</code></dd>
      <dt>Coordinate</dt>
      <dd><code>{coord}</code></dd>
      <dt>Where it was found</dt>
      <dd>
        {#if sources.length}
          <ul class="found-list">
            {#each sources as source}
              <li><code title={source}>{cropRenderedUrlsInText(source)}</code></li>
            {/each}
          </ul>
        {:else}
          <span class="muted">Not yet observed on a relay</span>
        {/if}
      </dd>
    </dl>
  </details>
  {#if busy && formatLabel}
    <LoadingHint message="Exporting {formatLabel}… This can take a minute." compact />
  {:else if error}
    <p class="details-export-error" role="alert">{error}</p>
  {/if}
</div>
