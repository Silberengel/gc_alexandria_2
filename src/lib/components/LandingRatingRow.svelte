<script lang="ts">
  import { link } from 'svelte-spa-router';
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import Stars from './Stars.svelte';
  import { displayRefTitle, focusHrefForRef, pathForRef } from '$lib/landing';
  import { ratingStarsFromEvent } from '$lib/ratings';

  interface Props {
    event: Event;
    referenced: Event[];
  }

  let { event, referenced }: Props = $props();

  const pageHref = $derived(pathForRef(event, referenced));
  const itemHref = $derived(focusHrefForRef(event, referenced));
  const title = $derived(displayRefTitle(event, referenced));
  const stars = $derived(ratingStarsFromEvent(event));
  const excerpt = $derived(event.content.replace(/\s+/g, ' ').trim().slice(0, 220));
</script>

<li class="landing-review-card">
  <div class="landing-review-card-inner">
    {#if pageHref}
      <a class="landing-review-title" href={`#${pageHref}`} use:link title="Open publication">{title}</a>
    {:else}
      <span class="landing-review-title">{title}</span>
    {/if}
    <div class="landing-review-meta">
      <UserBadge pubkey={event.pubkey} />
      {#if stars > 0}
        <Stars value={stars} size={15} label={`${stars} out of 5 stars`} />
      {/if}
    </div>
    {#if excerpt}
      <p class="landing-review-excerpt">{excerpt}</p>
    {/if}
    {#if itemHref}
      <a
        class="landing-item-jump"
        href={`#${itemHref}`}
        use:link
        title="Jump to this review on the edition page"
      >
        View review
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
