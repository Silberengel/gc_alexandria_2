<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import Cover from './Cover.svelte';
  import UserBadge from './UserBadge.svelte';
  import { KIND } from '$lib/constants';
  import { cardMeta, displayTitle } from '$lib/metadata';
  import { eventPreview } from '$lib/event-preview';
  import { kindDescription } from '$lib/kind-label';
  import { eventHref, cropText } from '$lib/listing-table';
  import { feedThreadPath } from '$lib/feed';
  import { warmNavEvent } from '$lib/nav-warm';

  interface Props {
    event: Event;
  }

  let { event }: Props = $props();

  const isPubLike = $derived(
    event.kind === KIND.PUBLICATION ||
      event.kind === KIND.SECTION ||
      event.kind === KIND.WIKI ||
      event.kind === KIND.SPEC ||
      event.kind === KIND.LONG_FORM
  );
  const href = $derived(eventHref(event) ?? (event.id ? `#${feedThreadPath(event)}` : ''));
  const meta = $derived(cardMeta(event));
  const kindLabel = $derived(
    event.kind === KIND.SPEC
      ? 'Spec'
      : event.kind === KIND.WIKI
        ? 'Wiki'
        : event.kind === KIND.LONG_FORM
          ? 'Article'
          : event.kind === KIND.SECTION
            ? 'Section'
            : event.kind === KIND.PUBLICATION
              ? 'Library Card'
              : event.kind === KIND.TEXT_NOTE
                ? 'Note'
                : event.kind === KIND.COMMENT
                  ? 'Comment'
                  : event.kind === KIND.HIGHLIGHT
                    ? 'Highlight'
                    : event.kind === KIND.LIVE_EVENT
                      ? 'Live'
                      : eventPreview(event).kindLine.replace(/^KIND:\s*\d+\s*·\s*/u, '') || 'Event'
  );
  const title = $derived.by(() => {
    if (isPubLike) return displayTitle(event);
    const preview = eventPreview(event);
    const generic =
      !preview.headline ||
      /^KIND:/u.test(preview.headline) ||
      preview.headline === kindLabel ||
      preview.headline === kindDescription(event.kind);
    if (!generic) return cropText(preview.headline, 72);
    const body = preview.body || preview.summary || '';
    return cropText(body, 72) || kindLabel;
  });
  const authorByline = $derived(
    meta.authors
      .map((a) => a.trim())
      .filter(Boolean)
      .join(' · ')
  );

  function warm(): void {
    warmNavEvent(event);
  }
</script>

{#snippet lineBody()}
  {#if isPubLike}
    <span class="embed-event-thumb" aria-hidden="true">
      <Cover {event} />
    </span>
  {/if}
  <span class="embed-event-kind muted">{kindLabel}</span>
  <span class="embed-event-title">{title}</span>
  {#if authorByline}
    <span class="embed-event-sep muted" aria-hidden="true">·</span>
    <span class="embed-event-by muted">{authorByline}</span>
  {:else if !isPubLike}
    <span class="embed-event-sep muted" aria-hidden="true">·</span>
    <span class="embed-event-by muted"><UserBadge pubkey={event.pubkey} compact /></span>
  {/if}
{/snippet}

{#if href}
  <a
    class="embed-event-line"
    {href}
    use:link
    onpointerdown={warm}
    onclick={(e) => e.stopPropagation()}
  >
    {@render lineBody()}
  </a>
{:else}
  <div class="embed-event-line embed-event-line-static">
    {@render lineBody()}
  </div>
{/if}
