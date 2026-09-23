<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { KIND } from '$lib/constants';
  import PublicationCard from './PublicationCard.svelte';
  import GenericCard from './GenericCard.svelte';
  import PictureCard from './PictureCard.svelte';
  import VideoCard from './VideoCard.svelte';
  import UserBadge from './UserBadge.svelte';
  import CopyPointerButton from './CopyPointerButton.svelte';
  import { eventPreview } from '$lib/event-preview';
  import type { ListingDensity } from '$lib/stores/listing-density';

  interface Props {
    event: Event;
    embedDepth?: number;
    density?: ListingDensity;
  }

  let { event, embedDepth = 0, density = 'full' }: Props = $props();

  const isPubLike = $derived(
    event.kind === KIND.PUBLICATION || event.kind === KIND.WIKI || event.kind === KIND.SPEC
  );
  const isNoteLike = $derived(
    event.kind === KIND.HIGHLIGHT ||
      event.kind === KIND.COMMENT ||
      event.kind === KIND.TEXT_NOTE
  );
  const preview = $derived(eventPreview(event));
</script>

{#if density === 'list'}
  {#if isPubLike}
    <PublicationCard {event} variant="row" />
  {:else if isNoteLike}
    <article class="card generic-card generic-card-list note-card-list">
      <CopyPointerButton {event} class="generic-card-copy" />
      <p class="generic-card-kind muted">{preview.kindLine}</p>
      <h3 class="generic-card-title">{preview.headline}</h3>
      <p class="generic-card-by muted">
        by <UserBadge pubkey={event.pubkey} />
      </p>
      {#if preview.body}
        <p class="generic-card-body muted">{preview.body}</p>
      {/if}
    </article>
  {:else}
    <GenericCard {event} {embedDepth} density="list" />
  {/if}
{:else if isPubLike}
  <PublicationCard {event} />
{:else if event.kind === KIND.PICTURE}
  <div class="result-card-wrap">
    <CopyPointerButton {event} class="generic-card-copy" />
    <PictureCard {event} />
  </div>
{:else if event.kind === KIND.VIDEO}
  <div class="result-card-wrap">
    <CopyPointerButton {event} class="generic-card-copy" />
    <VideoCard {event} />
  </div>
{:else if isNoteLike}
  <article class="card note-card">
    <CopyPointerButton {event} class="generic-card-copy" />
    <p class="generic-card-kind muted">{preview.kindLine}</p>
    <h3 class="generic-card-title">{preview.headline}</h3>
    <p class="note-card-by muted">
      by <UserBadge pubkey={event.pubkey} />
    </p>
    {#if preview.body}
      <p class="generic-card-body muted">{preview.body}</p>
    {/if}
  </article>
{:else}
  <GenericCard {event} {embedDepth} />
{/if}
