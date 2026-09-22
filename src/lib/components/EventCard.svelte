<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { KIND } from '$lib/constants';
  import { displayTitle } from '$lib/metadata';
  import PublicationCard from './PublicationCard.svelte';
  import GenericCard from './GenericCard.svelte';
  import PictureCard from './PictureCard.svelte';
  import VideoCard from './VideoCard.svelte';
  import UserBadge from './UserBadge.svelte';
  import EventBody from './EventBody.svelte';
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
  const listKindLabel = $derived(
    event.kind === KIND.HIGHLIGHT
      ? 'Highlight'
      : event.kind === KIND.COMMENT
        ? 'Comment'
        : event.kind === KIND.TEXT_NOTE
          ? 'Note'
          : event.kind === KIND.PICTURE
            ? 'Picture'
            : event.kind === KIND.VIDEO
              ? 'Video'
              : 'Event'
  );
  const listTitle = $derived(displayTitle(event));
</script>

{#if density === 'list'}
  {#if isPubLike}
    <PublicationCard {event} variant="row" />
  {:else}
    <article class="listing-row listing-row-plain">
      <div class="listing-row-body">
        <p class="listing-row-title">
          {#if listTitle !== 'Untitled'}
            {listTitle}
          {:else}
            {listKindLabel}
          {/if}
        </p>
        <p class="listing-row-meta muted">
          {listKindLabel} by <UserBadge pubkey={event.pubkey} />
        </p>
        {#if event.kind === KIND.HIGHLIGHT || event.kind === KIND.COMMENT || event.kind === KIND.TEXT_NOTE}
          <div class="listing-row-blurb">
            <EventBody {event} />
          </div>
        {/if}
      </div>
    </article>
  {/if}
{:else if isPubLike}
  <PublicationCard {event} />
{:else if event.kind === KIND.PICTURE}
  <PictureCard {event} />
{:else if event.kind === KIND.VIDEO}
  <VideoCard {event} />
{:else if event.kind === KIND.HIGHLIGHT || event.kind === KIND.COMMENT || event.kind === KIND.TEXT_NOTE}
  <article class="card">
    <p class="muted">
      {event.kind === KIND.HIGHLIGHT ? 'Highlight' : event.kind === KIND.COMMENT ? 'Comment' : 'Note'} by
      <UserBadge pubkey={event.pubkey} />
    </p>
    <EventBody {event} />
  </article>
{:else}
  <GenericCard {event} {embedDepth} />
{/if}
