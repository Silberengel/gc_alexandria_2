<script lang="ts">
  import { link } from 'svelte-spa-router';
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import Stars from './Stars.svelte';
  import { displayRefTitle, hrefForRef } from '$lib/landing';
  import { ratingStarsFromEvent } from '$lib/ratings';

  interface Props {
    event: Event;
    referenced: Event[];
  }

  let { event, referenced }: Props = $props();

  const href = $derived(hrefForRef(event, referenced));
  const title = $derived(displayRefTitle(event, referenced));
  const stars = $derived(ratingStarsFromEvent(event));
  const excerpt = $derived(event.content.replace(/\s+/g, ' ').trim().slice(0, 160));
</script>

<li class="landing-ref">
  <div class="landing-ref-work">
    {#if href}
      <a class="landing-ref-title" href={`#${href}`} use:link>{title}</a>
    {:else}
      <span class="landing-ref-title">{title}</span>
    {/if}
  </div>
  <div class="landing-ref-note">
    <UserBadge pubkey={event.pubkey} />
    {#if stars > 0}
      <Stars value={stars} size={14} label={`${stars} out of 5 stars`} />
    {/if}
    {#if excerpt}
      <span class="muted landing-ref-excerpt">{excerpt}</span>
    {/if}
  </div>
</li>
