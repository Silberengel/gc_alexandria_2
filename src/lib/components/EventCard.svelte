<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { KIND } from '$lib/constants';
  import PublicationCard from './PublicationCard.svelte';
  import GenericCard from './GenericCard.svelte';
  import PictureCard from './PictureCard.svelte';
  import VideoCard from './VideoCard.svelte';
  import UserBadge from './UserBadge.svelte';
  import EventBody from './EventBody.svelte';

  interface Props {
    event: Event;
    embedDepth?: number;
  }

  let { event, embedDepth = 0 }: Props = $props();
</script>

{#if event.kind === KIND.PUBLICATION || event.kind === KIND.WIKI || event.kind === KIND.SPEC}
  <PublicationCard {event} />
{:else if event.kind === KIND.PICTURE}
  <PictureCard {event} />
{:else if event.kind === KIND.VIDEO}
  <VideoCard {event} />
{:else if event.kind === KIND.HIGHLIGHT || event.kind === KIND.COMMENT}
  <article class="card">
    <p class="muted">
      {event.kind === KIND.HIGHLIGHT ? 'Highlight' : 'Comment'} by
      <UserBadge pubkey={event.pubkey} />
    </p>
    <EventBody {event} />
  </article>
{:else}
  <GenericCard {event} {embedDepth} />
{/if}
