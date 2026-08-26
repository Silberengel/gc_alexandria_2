<script lang="ts">
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import { session } from '$lib/stores/session';
  import { signAndPublish } from '$lib/sign';
  import { ratingDraft } from '$lib/drafts';
  import { aggregateRating, ratingValue } from '$lib/ratings';

  interface Props {
    ratings: Event[];
    publication: Event;
  }

  let { ratings, publication }: Props = $props();
  let list = $state<Event[]>([]);

  $effect(() => {
    list = ratings;
  });

  const agg = $derived(aggregateRating(list));
  let mine = $state(0);

  $effect(() => {
    const pk = $session.pubkey;
    const existing = list.find((r) => r.pubkey === pk);
    mine = existing ? ratingValue(existing) : 0;
  });

  async function submit(): Promise<void> {
    if (!$session.pubkey) {
      await session.signIn();
      return;
    }
    const signed = await signAndPublish(ratingDraft(publication, mine));
    if (signed) {
      list = [signed, ...list.filter((r) => r.pubkey !== signed.pubkey)];
    }
  }
</script>

<section class="card" style="margin-bottom:1rem">
  <h2>Ratings</h2>
  {#if agg.count}
    <p>{agg.average.toFixed(2)} / 1 from {agg.count}</p>
    <ul class="rater-list">
      {#each list as rating (rating.id)}
        <li>
          <UserBadge pubkey={rating.pubkey} />
          <span class="muted">{ratingValue(rating).toFixed(2)}</span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">No ratings yet.</p>
  {/if}
  {#if $session.pubkey}
    <label class="muted">Your rating (0–1)
      <input type="range" min="0" max="1" step="0.1" bind:value={mine} />
    </label>
    <button class="btn btn-primary" type="button" onclick={() => void submit()}>Save rating</button>
  {:else}
    <button class="btn" type="button" onclick={() => session.signIn()}>Sign in to rate</button>
  {/if}
</section>
