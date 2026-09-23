<script lang="ts">
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import Stars from './Stars.svelte';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { signAndPublish } from '$lib/sign';
  import { ratingDraft } from '$lib/drafts';
  import {
    aggregateRating,
    ratingHasScore,
    ratingStarsFromEvent
  } from '$lib/ratings';
  import EventSocialBar from './EventSocialBar.svelte';

  interface Props {
    ratings: Event[];
    publication: Event;
    /** When set, scroll to and highlight this rating id (from ?rating=). */
    focusId?: string;
  }

  let { ratings, publication, focusId = '' }: Props = $props();
  let list = $state<Event[]>([]);
  let expanded = $state<Record<string, boolean>>({});
  let overflow = $state<Record<string, boolean>>({});
  let busy = $state(false);
  let focusApplied = $state('');
  /** When the viewer already has a published rating, the form stays closed until Edit. */
  let editing = $state(false);

  $effect(() => {
    list = ratings;
  });

  $effect(() => {
    const id = focusId.trim().toLowerCase();
    if (!id) {
      focusApplied = '';
      return;
    }
    if (id === focusApplied) return;
    let attempts = 40;
    let timer = 0;
    const tryScroll = () => {
      const el = document.getElementById(`rating-${id}`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        focusApplied = id;
        return;
      }
      if (attempts-- <= 0) return;
      timer = window.setTimeout(tryScroll, 100);
    };
    const tick = requestAnimationFrame(tryScroll);
    return () => {
      cancelAnimationFrame(tick);
      clearTimeout(timer);
    };
  });

  const scored = $derived(list.filter(ratingHasScore));
  const agg = $derived(aggregateRating(scored));
  const avgStars = $derived(agg.average * 5);
  let mineStars = $state(0);
  let review = $state('');

  const minePublished = $derived(
    $session.pubkey
      ? (scored.find((r) => r.pubkey.toLowerCase() === $session.pubkey!.toLowerCase()) ?? null)
      : null
  );
  const showForm = $derived(!!$session.pubkey && (!minePublished || editing));
  const canClear = $derived(mineStars > 0 || review.trim().length > 0);

  $effect(() => {
    const pk = $session.pubkey;
    const existing = list.find((r) => r.pubkey === pk);
    mineStars = existing ? ratingStarsFromEvent(existing) : 0;
    review = existing?.content?.trim() ?? '';
    if (!pk || !existing || !ratingHasScore(existing)) {
      // First-time form stays available; drop edit mode if the published rating vanished.
      if (!existing) editing = false;
    }
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

  function openEdit(): void {
    if (!minePublished) return;
    mineStars = ratingStarsFromEvent(minePublished);
    review = minePublished.content?.trim() ?? '';
    editing = true;
  }

  function cancelForm(): void {
    if (busy) return;
    if (minePublished) {
      mineStars = ratingStarsFromEvent(minePublished);
      review = minePublished.content?.trim() ?? '';
      editing = false;
      return;
    }
    mineStars = 0;
    review = '';
  }

  async function submit(): Promise<void> {
    if (busy) return;
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    if (mineStars < 1) return;
    busy = true;
    try {
      const signed = await signAndPublish(ratingDraft(publication, mineStars, review));
      if (signed) {
        list = [signed, ...list.filter((r) => r.pubkey !== signed.pubkey)];
        editing = false;
      }
    } finally {
      busy = false;
    }
  }

  /** Reset the picker and review box only — never delete a published rating. */
  function clearForm(): void {
    if (busy) return;
    mineStars = 0;
    review = '';
  }
</script>

<section class="card rating-panel" style="margin-bottom:1rem">
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
        {@const isMine =
          !!$session.pubkey && rating.pubkey.toLowerCase() === $session.pubkey.toLowerCase()}
        <li
          class="rater-row"
          class:rater-row-focus={focusId.trim().toLowerCase() === rating.id.toLowerCase()}
          id={`rating-${rating.id.toLowerCase()}`}
        >
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
          <EventSocialBar event={rating} allowReply>
            {#snippet actions()}
              {#if isMine}
                <button
                  class="btn btn-icon rating-edit"
                  type="button"
                  aria-label={editing ? 'Editing rating' : 'Edit your rating'}
                  title={editing ? 'Editing…' : 'Edit rating'}
                  aria-pressed={editing}
                  disabled={editing}
                  onclick={openEdit}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.75"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"
                    />
                  </svg>
                </button>
              {/if}
            {/snippet}
          </EventSocialBar>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">No ratings yet.</p>
  {/if}
  {#if showForm}
    <div class="rating-form">
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
            <svg viewBox="0 0 24 24" width="1.375rem" height="1.375rem" aria-hidden="true">
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
      <div class="rating-actions">
        <button class="btn btn-primary" type="button" disabled={mineStars < 1 || busy} onclick={() => void submit()}
          >{busy ? 'Saving…' : 'Save rating'}</button
        >
        {#if minePublished}
          <button class="btn" type="button" disabled={busy} onclick={cancelForm}>Cancel</button>
        {:else}
          <button class="btn" type="button" disabled={!canClear || busy} onclick={clearForm}>Clear</button>
        {/if}
      </div>
    </div>
  {:else if !$session.pubkey}
    <button class="btn" type="button" onclick={() => openLoginDialog()}>Sign in to rate</button>
  {/if}
</section>
