<script lang="ts">
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import { KIND } from '$lib/constants';
  import { renderWithFallback, markHighlights } from '$lib/markup';
  import { splitNostrRefs } from '$lib/nostr-refs';
  import { fetchByAddress, fetchById } from '$lib/nostr/fetch';

  interface Props {
    event?: Event;
    content?: string;
    kind?: number;
    embedDepth?: number;
    quotes?: string[];
  }

  let { event, content = '', kind, embedDepth = 0, quotes = [] }: Props = $props();

  const source = $derived(event?.content ?? content);
  const sourceKind = $derived(kind ?? event?.kind ?? KIND.LONG_FORM);
  const sourceTags = $derived(event?.tags ?? []);
  const segments = $derived(splitNostrRefs(source));
  const loadingLabel = $derived(
    sourceKind === KIND.SECTION || sourceKind === KIND.PUBLICATION
      ? 'Publication is loading...'
      : 'Page is loading...'
  );

  let htmlByIndex = $state<string[]>([]);
  let resolved = $state<Record<number, Event | null>>({});
  const bodyPending = $derived(
    segments.some((seg, i) => seg.type === 'text' && !!seg.text.trim() && htmlByIndex[i] == null)
  );

  $effect(() => {
    const segs = segments;
    const k = sourceKind;
    const tags = sourceTags;
    let cancelled = false;
    htmlByIndex = [];
    resolved = {};
    void (async () => {
      const html: string[] = [];
      const found: Record<number, Event | null> = {};
      await Promise.all(
        segs.map(async (seg, i) => {
          if (seg.type === 'text') {
            const rendered = await renderWithFallback(k, seg.text, tags);
            html[i] = markHighlights(rendered, quotes);
            return;
          }
          html[i] = '';
          if (embedDepth > 1) return;
          if (seg.kind === 'naddr' && seg.naddr) {
            found[i] = await fetchByAddress(
              `${seg.naddr.kind}:${seg.naddr.pubkey}:${seg.naddr.identifier}`
            );
          } else if ((seg.kind === 'nevent' || seg.kind === 'note') && seg.id) {
            found[i] = await fetchById(seg.id);
          }
        })
      );
      if (!cancelled) {
        htmlByIndex = html;
        resolved = found;
      }
    })();
    return () => {
      cancelled = true;
    };
  });
</script>

{#snippet embedCard(hit: Event)}
  {#await import('./EventCard.svelte') then mod}
    <mod.default event={hit} embedDepth={embedDepth + 1} />
  {/await}
{/snippet}

<div class="event-body">
  {#if bodyPending}
    <p class="loading-hint">{loadingLabel}</p>
  {/if}
  {#each segments as seg, i (i)}
    {#if seg.type === 'text'}
      {@html htmlByIndex[i] ?? ''}
    {:else if seg.kind === 'npub' || seg.kind === 'nprofile'}
      {#if seg.pubkey}
        <UserBadge pubkey={seg.pubkey} compact />
      {/if}
    {:else if embedDepth > 1}
      <span class="muted">Embedded event</span>
    {:else if resolved[i]}
      {@render embedCard(resolved[i]!)}
    {:else if resolved[i] === null}
      <p class="muted">This item could not be found.</p>
    {:else}
      <p class="muted">Opening…</p>
    {/if}
  {/each}
</div>
