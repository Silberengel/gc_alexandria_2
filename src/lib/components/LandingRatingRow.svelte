<script lang="ts">
  import { link } from 'svelte-spa-router';
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import Stars from './Stars.svelte';
  import { displayRefTitle, focusHrefForRef, pathForRef, warmLandingRef } from '$lib/landing';
  import { cropText } from '$lib/listing-table';
  import { ratingStarsFromEvent } from '$lib/ratings';

  interface Props {
    event: Event;
    referenced: Event[];
  }

  let { event, referenced }: Props = $props();

  const pageHref = $derived(pathForRef(event, referenced));
  const itemHref = $derived(focusHrefForRef(event, referenced));
  const titleHref = $derived(itemHref || pageHref);
  const title = $derived(displayRefTitle(event, referenced));
  const stars = $derived(ratingStarsFromEvent(event));
  const excerpt = $derived(cropText(event.content, 220));

  function warmWork(): void {
    warmLandingRef(event, referenced);
  }
</script>

<li class="landing-review-card">
  <div class="landing-review-card-inner">
    {#if titleHref}
      <a
        class="landing-review-title"
        href={`#${titleHref}`}
        use:link
        title="Open this review"
        onpointerdown={warmWork}
      >{title}</a>
    {:else}
      <span class="landing-review-title">{title}</span>
    {/if}
    <div class="landing-review-meta">
      <UserBadge pubkey={event.pubkey} />
      {#if stars > 0}
        <span class="landing-review-meta-sep" aria-hidden="true">·</span>
        <Stars value={stars} size={15} label={`${stars} out of 5 stars`} />
      {/if}
    </div>
    {#if excerpt}
      <p class="landing-review-excerpt">{excerpt}</p>
    {/if}
  </div>
</li>
