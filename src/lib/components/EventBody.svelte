<script lang="ts">
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import { KIND } from '$lib/constants';
  import { renderWithFallback, markHighlights, type HighlightQuote } from '$lib/markup';
  import { attachHighlightBadges } from '$lib/text-highlights';
  import {
    expandNostrRefPlaceholders,
    protectNostrRefsForMarkup,
    splitNostrRefs,
    type RenderSegment,
    type ContentSegment
  } from '$lib/nostr-refs';
  import { fetchByAddress, fetchById } from '$lib/nostr/fetch';

  interface Props {
    event?: Event;
    content?: string;
    kind?: number;
    embedDepth?: number;
    quotes?: Array<string | HighlightQuote>;
  }

  let { event, content = '', kind, embedDepth = 0, quotes = [] }: Props = $props();

  const source = $derived(event?.content ?? content);
  const sourceKind = $derived(kind ?? event?.kind ?? KIND.LONG_FORM);
  const sourceTags = $derived(event?.tags ?? []);
  /** Full-document render for markup kinds — splitting first breaks AsciiDoc listings/tables. */
  const wholeDocument = $derived(
    sourceKind === KIND.SECTION ||
      sourceKind === KIND.WIKI ||
      sourceKind === KIND.SPEC ||
      sourceKind === KIND.LONG_FORM ||
      sourceKind === KIND.DJOT
  );
  const loadingLabel = $derived(
    sourceKind === KIND.SECTION || sourceKind === KIND.PUBLICATION
      ? 'Publication is loading...'
      : 'Page is loading...'
  );

  let segments = $state<Array<ContentSegment | RenderSegment>>([]);
  let resolved = $state<Record<number, Event | null>>({});
  let bodyPending = $state(true);
  let bodyEl = $state<HTMLElement | null>(null);

  $effect(() => {
    const src = source;
    const k = sourceKind;
    const tags = sourceTags;
    const whole = wholeDocument;
    const q = quotes;
    let cancelled = false;
    bodyPending = true;
    segments = [];
    resolved = {};
    void (async () => {
      const found: Record<number, Event | null> = {};
      let next: Array<ContentSegment | RenderSegment> = [];

      if (whole) {
        const { text, refs } = protectNostrRefsForMarkup(src);
        const rendered = markHighlights(await renderWithFallback(k, text, tags), q);
        next = expandNostrRefPlaceholders(rendered, refs);
        // Paint the article immediately — embedded naddr/note fetches used to hold
        // "Page is loading…" until every ref resolved (and fought the relay pool).
        if (!cancelled) {
          segments = next;
          bodyPending = false;
        }
        await Promise.all(
          next.map(async (seg, i) => {
            if (seg.type !== 'ref' || embedDepth > 1) return;
            if (seg.kind === 'naddr' && seg.naddr) {
              found[i] = await fetchByAddress(
                `${seg.naddr.kind}:${seg.naddr.pubkey}:${seg.naddr.identifier}`
              );
            } else if ((seg.kind === 'nevent' || seg.kind === 'note') && seg.id) {
              found[i] = await fetchById(seg.id);
            }
          })
        );
        if (!cancelled) resolved = { ...found };
        return;
      }

      const segs = splitNostrRefs(src);
      next = [];
      await Promise.all(
        segs.map(async (seg, i) => {
          if (seg.type === 'text') {
            const rendered = await renderWithFallback(k, seg.text, tags);
            next[i] = { type: 'html', html: markHighlights(rendered, q) };
            return;
          }
          next[i] = seg;
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
        segments = next;
        resolved = found;
        bodyPending = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    const el = bodyEl;
    const ready = !bodyPending;
    const q = quotes;
    if (!el || !ready || !q.length) return;
    return attachHighlightBadges(el);
  });
</script>

{#snippet embedCard(hit: Event)}
  {#await import('./EventCard.svelte') then mod}
    <mod.default event={hit} embedDepth={embedDepth + 1} />
  {/await}
{/snippet}

<div class="event-body" bind:this={bodyEl}>
  {#if bodyPending}
    <p class="loading-hint">{loadingLabel}</p>
  {/if}
  {#each segments as seg, i (i)}
    {#if seg.type === 'html'}
      {@html seg.html}
    {:else if seg.type === 'text'}
      {@html seg.text}
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
