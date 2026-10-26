<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import { highlightSourceLabelFallback, highlightSourceRef } from '$lib/highlight-source';
  import { fetchByAddress, fetchById } from '$lib/nostr/fetch';
  import { memoryGetEvent } from '$lib/nostr/event-memory';
  import { addressPath } from '$lib/library-scope';
  import { eventHref, cropText } from '$lib/listing-table';
  import { displayTitle } from '$lib/metadata';
  import { feedThreadPath, feedThreadPointerFromId } from '$lib/feed';
  import { warmNavEvent } from '$lib/nav-warm';
  import UserBadge from './UserBadge.svelte';

  interface Props {
    event: Event;
  }

  let { event }: Props = $props();

  const source = $derived(highlightSourceRef(event));
  const fallback = $derived(highlightSourceLabelFallback(event));

  let resolved = $state<Event | null>(null);
  let loading = $state(false);

  $effect(() => {
    const ref = source;
    resolved = null;
    if (!ref || ref.type === 'http') {
      loading = false;
      return;
    }
    let cancelled = false;
    loading = true;
    void (async () => {
      try {
        const hit =
          ref.type === 'event'
            ? memoryGetEvent(ref.eventId) ??
              (await fetchById(ref.eventId, { hintRelays: ref.relayHints }))
            : await fetchByAddress(ref.coordinate, { hintRelays: ref.relayHints });
        if (!cancelled) resolved = hit;
      } catch {
        if (!cancelled) resolved = null;
      } finally {
        if (!cancelled) loading = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  const httpHref = $derived(source?.type === 'http' ? source.url : null);

  const eventHrefResolved = $derived.by(() => {
    if (!source) return null;
    if (source.type === 'http') return null;
    if (resolved) {
      return eventHref(resolved) ?? `#${feedThreadPath(resolved)}`;
    }
    if (source.type === 'event') {
      return `#/feed?thread=${feedThreadPointerFromId(source.eventId)}`;
    }
    const path = addressPath(source.coordinate);
    return path ? `#${path}` : null;
  });

  const labelText = $derived.by(() => {
    if (!source) return '';
    if (source.type === 'http') return source.url;
    if (resolved) {
      const title = displayTitle(resolved);
      if (title && title !== 'Untitled') return title;
      const body = cropText(resolved.content, 72);
      if (body) return body;
    }
    if (source.type === 'replaceable') {
      const d = source.coordinate.split(':').slice(2).join(':');
      return d ? d.replace(/-/g, ' ') : source.coordinate;
    }
    return loading ? '…' : 'Source event';
  });

  function warm(): void {
    if (resolved) warmNavEvent(resolved);
  }

  function stop(e: MouseEvent): void {
    e.stopPropagation();
  }
</script>

{#if source}
  {#if httpHref}
    <a
      class="highlight-source-blurb"
      href={httpHref}
      target="_blank"
      rel="noopener noreferrer"
      onclick={stop}
      title={httpHref}
    >
      <span class="highlight-source-label muted">Highlight of:</span>
      <span class="highlight-source-target">{httpHref}</span>
    </a>
  {:else if eventHrefResolved}
    <a
      class="highlight-source-blurb"
      href={eventHrefResolved}
      use:link
      onpointerdown={warm}
      onclick={stop}
      title={labelText}
    >
      <span class="highlight-source-label muted">Highlight of:</span>
      {#if resolved}
        <span class="highlight-source-avatar" aria-hidden="true">
          <UserBadge pubkey={resolved.pubkey} compact avatarOnly />
        </span>
      {/if}
      <span class="highlight-source-target">{labelText}</span>
    </a>
  {:else}
    <div class="highlight-source-blurb highlight-source-blurb-static">
      <span class="highlight-source-label muted">Highlight of:</span>
      <span class="highlight-source-target">{labelText}</span>
    </div>
  {/if}
{:else if fallback}
  <p class="highlight-source-fallback muted">{fallback}</p>
{/if}
