<script lang="ts">
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import { session } from '$lib/stores/session';
  import { signAndPublish } from '$lib/sign';
  import { ratingDraft } from '$lib/drafts';
  import {
    aggregateRating,
    ratingHasScore,
    ratingStarsFromEvent
  } from '$lib/ratings';

  interface Props {
    ratings: Event[];
    publication: Event;
  }

  let { ratings, publication }: Props = $props();
  let list = $state<Event[]>([]);

  $effect(() => {
    list = ratings;
  });

  const scored = $derived(list.filter(ratingHasScore));
  const agg = $derived(aggregateRating(scored));
  let mineStars = $state(0);
  let review = $state('');

  $effect(() => {
    const pk = $session.pubkey;
    const existing = list.find((r) => r.pubkey === pk);
    mineStars = existing ? ratingStarsFromEvent(existing) : 0;
    review = existing?.content?.trim() ?? '';
  });

  async function submit(): Promise<void> {
    if (!$session.pubkey) {
      await session.signIn();
      return;
    }
    if (mineStars < 1) return;
    const signed = await signAndPublish(ratingDraft(publication, mineStars, review));
    if (signed) {
      list = [signed, ...list.filter((r) => r.pubkey !== signed.pubkey)];
    }
  }
</script>

<section class="card" style="margin-bottom:1rem">
  <h2>Ratings</h2>
  {#if agg.count}
    <p>{(agg.average * 5).toFixed(1)} / 5 from {agg.count}</p>
    <ul class="rater-list">
      {#each scored as rating (rating.id)}
        <li>
          <UserBadge pubkey={rating.pubkey} />
          <span class="muted">{ratingStarsFromEvent(rating)}★</span>
          {#if rating.content?.trim()}
            <span class="muted review-snip">{rating.content.trim()}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">No ratings yet.</p>
  {/if}
  {#if $session.pubkey}
    <div class="star-picker" role="group" aria-label="Your rating">
      {#each [1, 2, 3, 4, 5] as n}
        <button
          class="star-btn"
          class:star-on={mineStars >= n}
          type="button"
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          aria-pressed={mineStars >= n}
          onclick={() => (mineStars = n)}
        >
          ★
        </button>
      {/each}
    </div>
    <label class="muted">
      Review (optional)
      <textarea bind:value={review} rows="3" placeholder="Write a short review"></textarea>
    </label>
    <button class="btn btn-primary" type="button" disabled={mineStars < 1} onclick={() => void submit()}
      >Save rating</button
    >
  {:else}
    <button class="btn" type="button" onclick={() => session.signIn()}>Sign in to rate</button>
  {/if}
</section>
