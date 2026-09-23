<script lang="ts">
  import { link } from 'svelte-spa-router';
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import { KIND } from '$lib/constants';
  import {
    displayRefTitle,
    focusHrefForRef,
    pathForRef,
    topLevelPublicationAddress
  } from '$lib/landing';
  import { referencedLibraryAddress, referencedSectionAddress } from '$lib/library-scope';
  import { eventAddress } from '$lib/nostr/verify';
  import { rememberEvents } from '$lib/nostr/event-memory';

  interface Props {
    event: Event;
    referenced: Event[];
  }

  let { event, referenced }: Props = $props();

  const pageHref = $derived(pathForRef(event, referenced));
  const itemHref = $derived(focusHrefForRef(event, referenced));
  const title = $derived(displayRefTitle(event, referenced));
  const excerpt = $derived(event.content.replace(/\s+/g, ' ').trim().slice(0, 160));
  const viewLabel = $derived(
    event.kind === KIND.HIGHLIGHT
      ? 'View highlight'
      : event.kind === KIND.COMMENT || event.kind === KIND.TEXT_NOTE
        ? 'View comment'
        : 'View'
  );

  /** Seed event-memory before SPA nav so Wiki/Publication can paint without a relay round-trip. */
  function warmWork(): void {
    const work = referencedLibraryAddress(event);
    const section = referencedSectionAddress(event);
    const top = topLevelPublicationAddress(section ?? work, referenced);
    const coords = [top, work, section].filter((c): c is string => !!c);
    const hits = referenced.filter((e) => coords.includes(eventAddress(e)));
    if (hits.length) rememberEvents(hits);
  }
</script>

<li class="landing-ref landing-feed-card">
  <div class="landing-ref-work">
    {#if pageHref}
      <a
        class="landing-ref-title"
        href={`#${pageHref}`}
        use:link
        title="Open publication"
        onpointerdown={warmWork}
      >{title}</a>
    {:else}
      <span class="landing-ref-title">{title}</span>
    {/if}
  </div>
  <div class="landing-ref-note">
    <UserBadge pubkey={event.pubkey} />
    {#if excerpt}
      <span class="muted landing-ref-excerpt">{excerpt}</span>
    {/if}
    {#if itemHref}
      <a
        class="landing-item-jump"
        href={`#${itemHref}`}
        use:link
        title={`${viewLabel} on the edition page`}
        onpointerdown={warmWork}
      >
        {viewLabel}
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            fill="currentColor"
            d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zM5 5h6v2H7v10h10v-4h2v6H5V5z"
          />
        </svg>
      </a>
    {/if}
  </div>
</li>
