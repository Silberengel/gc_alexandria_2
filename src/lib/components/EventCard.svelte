<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { push } from 'svelte-spa-router';
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
  import WikiMergeCard from './WikiMergeCard.svelte';
  import WikiRedirectCard from './WikiRedirectCard.svelte';
  import AppHandlerChip from './AppHandlerChip.svelte';
  import ProfileMetadataCard from './ProfileMetadataCard.svelte';
  import DirectoryExplorer from './DirectoryExplorer.svelte';
  import { KIND } from '$lib/constants';
  import { eventPreview } from '$lib/event-preview';
  import { eventHref } from '$lib/listing-table';
  import { feedThreadPath } from '$lib/feed';
  import { warmNavEvent } from '$lib/nav-warm';
  import { formatAbsoluteTime, formatChatTime, formatRelativeTime } from '$lib/relative-time';
  import type { LivePresencePerson } from '$lib/live-chat';

  interface Props {
    event: Event;
    embedDepth?: number;
    /** Citation inside a post: listing card, not the compact note. */
    asCard?: boolean;
    /**
     * Search (and similar) grids: whole card opens the feed thread.
     * No ⋯ menu; cover enlarge is off so the hit reaches the card.
     */
    openAsThread?: boolean;
    /** Kind 10312 listeners for live event cards. */
    presence?: LivePresencePerson[];
  }

  let {
    event,
    embedDepth = 0,
    asCard = false,
    openAsThread = false,
    presence = []
  }: Props = $props();

  /** Nested citation — whole card opens the event; no ⋯ menu. */
  const embedded = $derived(embedDepth > 0);
  /** Search listing cards also omit the ⋯ menu (whole card opens the thread). */
  const showMenu = $derived(!embedded && !openAsThread);
  /** Thread path when listing; library/event href for embeds. */
  const href = $derived(
    openAsThread && event.id
      ? `#${feedThreadPath(event)}`
      : (eventHref(event) ?? (event.id ? `#${feedThreadPath(event)}` : ''))
  );
  /**
   * Search listings: whole card opens the thread (directories are header-only indicators).
   * Embedded / feed cards that need an interactive explorer keep cardOpens off.
   */
  const cardOpens = $derived((embedded || openAsThread) && Boolean(href));

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

  function openCard(e: MouseEvent | KeyboardEvent): void {
    if (!href || !cardOpens) return;
    const target = e.target as Element | null;
    const directoryIndicator = Boolean(target?.closest?.('.directory-explorer-header-only'));
    // Keep media controls and the ⋯ menu usable; directory indicators open wholly.
    if (
      !directoryIndicator &&
      target?.closest?.(
        'video, audio, .live-stream-player, .event-imeta-btn, .event-more-menu, button, a'
      )
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    warmNavEvent(event);
    push(href.startsWith('#') ? href.slice(1) : href);
  }

  function onCardKey(e: KeyboardEvent): void {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    openCard(e);
  }
</script>

{#snippet cardBody()}
  {#if isPubLike}
    <PublicationCard
      {event}
      {showMenu}
      enlargeOnClick={!openAsThread && !embedded}
    />
  {:else if event.kind === KIND.PICTURE}
    <div class="result-card-wrap">
      {#if showMenu}
        <CopyPointerButton {event} class="generic-card-copy" />
      {/if}
      <div class="card-clip">
        <PictureCard {event} />
      </div>
    </div>
  {:else if event.kind === KIND.VIDEO || event.kind === KIND.SHORT_VIDEO}
    <div class="result-card-wrap">
      {#if showMenu}
        <CopyPointerButton {event} class="generic-card-copy" />
      {/if}
      <div class="card-clip">
        <VideoCard {event} />
      </div>
    </div>
  {:else if event.kind === KIND.LIVE_EVENT}
    <LiveStreamCard {event} {presence} {showMenu} />
  {:else if event.kind === KIND.MEETING_SPACE}
    <MeetingSpaceCard {event} {showMenu} />
  {:else if event.kind === KIND.MEETING_ROOM}
    <MeetingRoomCard {event} {showMenu} />
  {:else if event.kind === KIND.ROOM_PRESENCE}
    <RoomPresenceCard {event} {showMenu} />
  {:else if event.kind === KIND.LIVE_CHAT}
    <div class="live-chat-line">
      <div class="live-chat-meta">
        <UserBadge pubkey={event.pubkey} />
        <time
          class="live-chat-time muted"
          datetime={new Date(event.created_at * 1000).toISOString()}
          title={absolute}>{formatChatTime(event.created_at)}</time
        >
      </div>
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
      {#if showMenu}
        <div class="thread-actions">
          <CopyPointerButton {event} class="thread-more" />
        </div>
      {/if}
    </div>
  {:else if event.kind === KIND.HIGHLIGHT}
    <article class="card note-card">
      {#if showMenu}
        <CopyPointerButton {event} class="generic-card-copy" />
      {/if}
      <div class="card-clip">
        <p class="generic-card-kind muted">{preview.kindLine}</p>
        <p class="note-card-by muted">
          by <UserBadge pubkey={event.pubkey} />
        </p>
        <div class="generic-card-body">
          <EventBody {event} embedDepth={embedDepth} showEmbeds={false} />
        </div>
      </div>
    </article>
  {:else if event.kind === KIND.APP_HANDLER}
    <AppHandlerChip {event} {showMenu} />
  {:else if event.kind === KIND.METADATA}
    <article class="card profile-meta-frame">
      <ProfileMetadataCard {event} {showMenu} />
    </article>
  {:else if event.kind === KIND.WIKI_MERGE_REQUEST || event.kind === KIND.WIKI_MERGE_ACCEPTANCE}
    <article class="card note-card">
      {#if showMenu}
        <CopyPointerButton {event} class="generic-card-copy" />
      {/if}
      <div class="card-clip">
        <p class="note-card-by muted">
          by <UserBadge pubkey={event.pubkey} />
        </p>
        <WikiMergeCard {event} />
      </div>
    </article>
  {:else if event.kind === KIND.WIKI_REDIRECT}
    <article class="card note-card">
      {#if showMenu}
        <CopyPointerButton {event} class="generic-card-copy" />
      {/if}
      <div class="card-clip">
        <p class="note-card-by muted">
          by <UserBadge pubkey={event.pubkey} />
        </p>
        <WikiRedirectCard {event} />
      </div>
    </article>
  {:else if event.kind === KIND.DIRECTORY}
    <DirectoryExplorer {event} showMenu={showMenu} headerOnly={openAsThread || embedded} />
  {:else}
    <GenericCard {event} {embedDepth} {showMenu} />
  {/if}
{/snippet}

{#if cardOpens}
  <div
    class="event-embed-card"
    role="link"
    tabindex="0"
    onclick={openCard}
    onkeydown={onCardKey}
  >
    {@render cardBody()}
  </div>
{:else}
  {@render cardBody()}
{/if}
