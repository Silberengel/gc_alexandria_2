<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { KIND } from '$lib/constants';
  import PublicationCard from './PublicationCard.svelte';
  import GenericCard from './GenericCard.svelte';
  import PictureCard from './PictureCard.svelte';
  import VideoCard from './VideoCard.svelte';
  import LiveStreamCard from './LiveStreamCard.svelte';
  import MeetingSpaceCard from './MeetingSpaceCard.svelte';
  import MeetingRoomCard from './MeetingRoomCard.svelte';
  import RoomPresenceCard from './RoomPresenceCard.svelte';
  import UserBadge from './UserBadge.svelte';
  import EventBody from './EventBody.svelte';
  import CopyPointerButton from './CopyPointerButton.svelte';
  import { eventPreview } from '$lib/event-preview';
  import { formatAbsoluteTime, formatRelativeTime } from '$lib/relative-time';
  import type { LivePresencePerson } from '$lib/live-chat';

  interface Props {
    event: Event;
    embedDepth?: number;
    /** Citation inside a post: listing card, not the compact note. */
    asCard?: boolean;
    /** Kind 10312 listeners for live event cards. */
    presence?: LivePresencePerson[];
  }

  let { event, embedDepth = 0, asCard = false, presence = [] }: Props = $props();

  const isPubLike = $derived(
    event.kind === KIND.PUBLICATION ||
      event.kind === KIND.SECTION ||
      event.kind === KIND.WIKI ||
      event.kind === KIND.SPEC ||
      event.kind === KIND.LONG_FORM
  );
  /** Compact note. Quotes use the one-line embed; other citations use a card. */
  const isThreadNote = $derived(
    !asCard && (event.kind === KIND.COMMENT || event.kind === KIND.TEXT_NOTE)
  );
  const preview = $derived(eventPreview(event));
  const relative = $derived(formatRelativeTime(event.created_at));
  const absolute = $derived(formatAbsoluteTime(event.created_at));
</script>

{#if isPubLike}
  <PublicationCard {event} />
{:else if event.kind === KIND.PICTURE}
  <div class="result-card-wrap">
    <CopyPointerButton {event} class="generic-card-copy" />
    <div class="card-clip">
      <PictureCard {event} />
    </div>
  </div>
{:else if event.kind === KIND.VIDEO || event.kind === KIND.SHORT_VIDEO}
  <div class="result-card-wrap">
    <CopyPointerButton {event} class="generic-card-copy" />
    <div class="card-clip">
      <VideoCard {event} />
    </div>
  </div>
{:else if event.kind === KIND.LIVE_EVENT}
  <LiveStreamCard {event} {presence} />
{:else if event.kind === KIND.MEETING_SPACE}
  <MeetingSpaceCard {event} />
{:else if event.kind === KIND.MEETING_ROOM}
  <MeetingRoomCard {event} />
{:else if event.kind === KIND.ROOM_PRESENCE}
  <RoomPresenceCard {event} />
{:else if event.kind === KIND.LIVE_CHAT}
  <div class="live-chat-line">
    <UserBadge pubkey={event.pubkey} />
    <span class="live-chat-colon" aria-hidden="true">:</span>
    <div class="live-chat-body">
      <EventBody {event} embedDepth={embedDepth} showEmbeds={false} />
    </div>
  </div>
{:else if isThreadNote}
  <div class="thread-node thread-embed-note">
    <div class="thread-head">
      <UserBadge pubkey={event.pubkey} />
      {#if relative}
        <time
          class="thread-time muted"
          datetime={new Date(event.created_at * 1000).toISOString()}
          title={absolute}>{relative}</time
        >
      {/if}
    </div>
    <div class="thread-body">
      <EventBody {event} embedDepth={embedDepth} />
    </div>
    <div class="thread-actions">
      <CopyPointerButton {event} class="thread-more" />
    </div>
  </div>
{:else if event.kind === KIND.HIGHLIGHT}
  <article class="card note-card">
    <CopyPointerButton {event} class="generic-card-copy" />
    <div class="card-clip">
    <p class="generic-card-kind muted">{preview.kindLine}</p>
    <h3 class="generic-card-title">{preview.headline}</h3>
    <p class="note-card-by muted">
      by <UserBadge pubkey={event.pubkey} />
    </p>
    {#if preview.body}
      <p class="generic-card-body muted">{preview.body}</p>
    {/if}
    </div>
  </article>
{:else}
  <GenericCard {event} {embedDepth} />
{/if}
