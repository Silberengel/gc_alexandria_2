<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import UserBadge from './UserBadge.svelte';
  import CopyPointerButton from './CopyPointerButton.svelte';
  import { isAllowedMediaUrl } from '$lib/markup';
  import { parseCalendarEvent } from '$lib/nip52';

  interface Props {
    event: Event;
    showMenu?: boolean;
  }

  let { event, showMenu = true }: Props = $props();
  const info = $derived(parseCalendarEvent(event));
  const imageOk = $derived(!!info?.image && isAllowedMediaUrl(info.image));
</script>

{#if info}
  <article class="card calendar-event-card">
    {#if showMenu}
      <CopyPointerButton {event} class="generic-card-copy" />
    {/if}
    <div class="card-clip">
      <div class="calendar-event-head">
        <span class="calendar-event-kind">
          {info.isAllDay ? 'All-day event' : 'Calendar event'}
        </span>
      </div>
      <h3 class="calendar-event-title">{info.title}</h3>
      <p class="note-card-by muted">
        by <UserBadge pubkey={event.pubkey} />
      </p>
      {#if info.whenLabel}
        <p class="calendar-event-when">{info.whenLabel}</p>
      {/if}
      {#if imageOk && info.image}
        <img class="calendar-event-image" src={info.image} alt="" />
      {/if}
      {#if info.summary}
        <p class="calendar-event-summary">{info.summary}</p>
      {/if}
      {#if info.locations.length}
        <ul class="calendar-event-locations">
          {#each info.locations as location}
            <li>{location}</li>
          {/each}
        </ul>
      {/if}
      {#if info.participants.length}
        <div class="calendar-event-people">
          {#each info.participants as person}
            <span class="calendar-event-person">
              <UserBadge pubkey={person.pubkey} />
              {#if person.role}
                <span class="muted">({person.role})</span>
              {/if}
            </span>
          {/each}
        </div>
      {/if}
      {#if info.topics.length}
        <div class="chip-row">
          {#each info.topics as topic}
            <a class="chip chip-quiet" href={`#/search?subject=${encodeURIComponent(topic)}`} use:link
              >#{topic}</a
            >
          {/each}
        </div>
      {/if}
    </div>
  </article>
{/if}

<style>
  .calendar-event-head {
    margin-bottom: 0.2rem;
  }
  .calendar-event-kind {
    display: inline-flex;
    padding: 0.12rem 0.5rem;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 650;
    letter-spacing: 0.02em;
    background: color-mix(in srgb, var(--accent) 16%, var(--paper-light));
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--rule));
  }
  .calendar-event-title {
    margin: 0.2rem 0 0.25rem;
    font-size: 1.12rem;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .calendar-event-when {
    margin: 0.35rem 0 0;
    font-weight: 600;
    color: var(--accent, var(--link));
  }
  .calendar-event-summary {
    margin: 0.45rem 0 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .calendar-event-image {
    display: block;
    width: 100%;
    max-height: 12rem;
    margin: 0.55rem 0 0;
    object-fit: cover;
    border-radius: 0.4rem;
  }
  .calendar-event-locations {
    list-style: none;
    margin: 0.45rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.2rem;
    font-size: 0.88rem;
    color: color-mix(in srgb, var(--ink) 78%, transparent);
  }
  .calendar-event-people {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.75rem;
    margin-top: 0.45rem;
  }
  .calendar-event-person {
    display: inline-flex;
    align-items: baseline;
    gap: 0.25rem;
    font-size: 0.86rem;
  }
</style>
