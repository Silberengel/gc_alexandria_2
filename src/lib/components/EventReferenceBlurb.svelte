<script lang="ts">
  import { untrack } from 'svelte';
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import { noteReferencePreviewText, noteReferenceSpec } from '$lib/note-reference';
  import { fetchByAddress, fetchById } from '$lib/nostr/fetch';
  import { memoryGetEvent } from '$lib/nostr/event-memory';
  import { addressPath } from '$lib/library-scope';
  import { eventHref, cropText } from '$lib/listing-table';
  import { displayTitle } from '$lib/metadata';
  import { feedThreadPointerFromId } from '$lib/feed';
  import { warmNavEvent } from '$lib/nav-warm';
  import UserBadge from './UserBadge.svelte';

  interface Props {
    event: Event;
  }

  let { event }: Props = $props();

  /** Stable string key so $effect does not re-fire on fresh object identity. */
  const specKey = $derived.by(() => {
    const s = noteReferenceSpec(event);
    if (!s) return '';
    if (s.type === 'http') return `http:${s.kind}:${s.url}`;
    if (s.type === 'id') return `id:${s.kind}:${s.id}`;
    return `addr:${s.kind}:${s.coordinate}`;
  });

  const spec = $derived(noteReferenceSpec(event));

  let resolved = $state<Event | null>(null);
  let loading = $state(false);
  /** Non-reactive — reading $state in the effect would re-schedule it. */
  let fetchedKey = '';

  $effect(() => {
    const key = specKey;
    const ref = untrack(() => noteReferenceSpec(event));
    if (!key || !ref || ref.type === 'http') {
      fetchedKey = key;
      untrack(() => {
        resolved = null;
        loading = false;
      });
      return;
    }
    if (fetchedKey === key) return;
    fetchedKey = key;

    const cached = ref.type === 'id' ? memoryGetEvent(ref.id) : null;
    if (cached) {
      untrack(() => {
        resolved = cached;
        loading = false;
      });
      return;
    }

    let cancelled = false;
    untrack(() => {
      resolved = null;
      loading = true;
    });
    void (async () => {
      try {
        const hit =
          ref.type === 'id'
            ? await fetchById(ref.id, {
                hintRelays: ref.relayHints,
                authorPubkey: ref.pubkeyHint ?? undefined
              })
            : await fetchByAddress(ref.coordinate, { hintRelays: ref.relayHints });
        if (cancelled) return;
        untrack(() => {
          resolved = hit;
          loading = false;
        });
      } catch {
        if (cancelled) return;
        untrack(() => {
          resolved = null;
          loading = false;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  const label = $derived(spec?.kind === 'quote' ? 'Quote of:' : 'Reply to:');

  const httpHref = $derived(spec?.type === 'http' ? spec.url : null);

  /** Href from the tag (stable) — never rewrite to the thread root after resolve. */
  const eventHrefResolved = $derived.by(() => {
    if (!spec || spec.type === 'http') return null;
    if (spec.type === 'id') {
      return `#/feed?thread=${feedThreadPointerFromId(spec.id)}`;
    }
    if (resolved) {
      const path = eventHref(resolved);
      if (path) return path.startsWith('#') ? path : path.startsWith('/') ? `#${path}` : `#/${path}`;
    }
    const path = addressPath(spec.coordinate);
    if (!path) return null;
    return path.startsWith('/') ? `#${path}` : `#/${path}`;
  });

  const labelText = $derived.by(() => {
    if (!spec) return '';
    if (spec.type === 'http') return spec.url;
    if (resolved) {
      const title = displayTitle(resolved);
      if (title && title !== 'Untitled') return cropText(title, 72);
      return cropText(noteReferencePreviewText(resolved), 72);
    }
    if (spec.type === 'addr') {
      const d = spec.coordinate.split(':').slice(2).join(':');
      return d ? d.replace(/-/g, ' ') : spec.coordinate;
    }
    return loading ? '…' : 'Unavailable';
  });

  const avatarPubkey = $derived(
    resolved?.pubkey ?? (spec && 'pubkeyHint' in spec ? spec.pubkeyHint : null)
  );

  function warm(): void {
    if (resolved) warmNavEvent(resolved);
  }

  function stop(e: MouseEvent): void {
    e.stopPropagation();
  }
</script>

{#if spec}
  {#if httpHref}
    <a
      class="highlight-source-blurb"
      href={httpHref}
      target="_blank"
      rel="noopener noreferrer"
      onclick={stop}
      title={httpHref}
    >
      <span class="highlight-source-label muted">{label}</span>
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
      <span class="highlight-source-label muted">{label}</span>
      {#if avatarPubkey}
        <span class="highlight-source-avatar" aria-hidden="true">
          <UserBadge pubkey={avatarPubkey} compact avatarOnly />
        </span>
      {/if}
      <span class="highlight-source-target">{labelText}</span>
    </a>
  {:else}
    <div class="highlight-source-blurb highlight-source-blurb-static">
      <span class="highlight-source-label muted">{label}</span>
      <span class="highlight-source-target">{labelText}</span>
    </div>
  {/if}
{/if}
