<script lang="ts">
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import CopyPointerButton from './CopyPointerButton.svelte';
  import { nip53KindLabel, parseRoomPresence } from '$lib/nip53';

  interface Props {
    event: Event;
  }

  let { event }: Props = $props();

  const info = $derived(parseRoomPresence(event));
  const kindLabel = $derived(nip53KindLabel(event.kind));
</script>

<article class="card room-presence-card" data-hand-raised={info.handRaised ? '1' : '0'}>
  <CopyPointerButton {event} class="generic-card-copy" />
  <div class="room-presence-clip">
    <p class="room-presence-kind muted">{kindLabel}</p>
    <p class="room-presence-who">
      <UserBadge pubkey={event.pubkey} />
      {#if info.handRaised}
        <span class="hand-raised">Hand raised</span>
      {:else}
        <span class="muted">Present</span>
      {/if}
    </p>
    {#if info.spaceAddress}
      <p class="room-presence-space muted">
        In <code>{info.spaceAddress}</code>
      </p>
    {/if}
  </div>
</article>

<style>
  .room-presence-card {
    position: relative;
    padding-right: 2.5rem;
    padding-bottom: 0.9rem;
  }
  .room-presence-clip {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .room-presence-kind {
    margin: 0;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .room-presence-who {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.45rem;
    font-size: 0.95rem;
  }
  .hand-raised {
    font-size: 0.8rem;
    font-weight: 650;
    color: color-mix(in srgb, var(--accent) 80%, var(--ink));
  }
  .room-presence-space {
    margin: 0;
    font-size: 0.8rem;
    overflow-wrap: anywhere;
  }
</style>
