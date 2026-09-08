<script lang="ts">
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import Stars from './Stars.svelte';
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
  let expanded = $state<Record<string, boolean>>({});
  let overflow = $state<Record<string, boolean>>({});

  $effect(() => {
    list = ratings;
  });

  const scored = $derived(list.filter(ratingHasScore));
  const agg = $derived(aggregateRating(scored));
  const avgStars = $derived(agg.average * 5);
  let mineStars = $state(0);
  let review = $state('');

  $effect(() => {
    const pk = $session.pubkey;
    const existing = list.find((r) => r.pubkey === pk);
    mineStars = existing ? ratingStarsFromEvent(existing) : 0;
    review = existing?.content?.trim() ?? '';
  });

  function bindReview(node: HTMLElement, id: string) {
    const measure = () => {
      const expandedNow = node.classList.contains('review-expanded');
      if (!expandedNow) node.classList.add('review-expanded');
      const tall = node.scrollHeight > 250;
      if (!expandedNow) node.classList.remove('review-expanded');
      if (overflow[id] !== tall) overflow = { ...overflow, [id]: tall };
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return {
      update(nextId: string) {
        id = nextId;
        measure();
      },
      destroy() {
        ro.disconnect();
      }
    };
  }

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
    <p class="rating-summary">
      <Stars value={avgStars} size={18} label={`${avgStars.toFixed(1)} out of 5 from ${agg.count} ratings`} />
      <span class="muted">{avgStars.toFixed(1)} · {agg.count} {agg.count === 1 ? 'rating' : 'ratings'}</span>
    </p>
    <ul class="rater-list">
      {#each scored as rating (rating.id)}
        {@const stars = ratingStarsFromEvent(rating)}
        {@const text = rating.content?.trim() ?? ''}
        <li class="rater-row">
          <div class="rater-meta">
            <UserBadge pubkey={rating.pubkey} />
            <Stars value={stars} size={14} label={`${stars} out of 5 stars`} />
          </div>
          {#if text}
            <div class="review-block">
              <p
                class="muted review-body"
                class:review-expanded={expanded[rating.id]}
                use:bindReview={rating.id}
              >
                {text}
              </p>
              {#if overflow[rating.id] || expanded[rating.id]}
                <button
                  class="btn-link"
                  type="button"
                  onclick={() => (expanded[rating.id] = !expanded[rating.id])}
                >
                  {expanded[rating.id] ? 'Show less' : 'Show more'}
                </button>
              {/if}
            </div>
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
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              d="M12 2.5l2.9 5.88 6.49.94-4.7 4.58 1.11 6.47L12 17.77l-5.8 3.05 1.11-6.47-4.7-4.58 6.49-.94L12 2.5z"
              fill={mineStars >= n ? 'currentColor' : 'none'}
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linejoin="round"
            />
          </svg>
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
