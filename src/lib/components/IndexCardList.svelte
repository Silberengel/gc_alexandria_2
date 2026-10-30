<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { nip19 } from 'nostr-tools';
  import LoadingHint from './LoadingHint.svelte';
  import PublicationCard from './PublicationCard.svelte';
  import { fetchByAddress, poolMap } from '$lib/nostr/fetch';
  import { rememberEvents } from '$lib/nostr/event-memory';

  interface Props {
    /** naddr of a kind-30040 (or other addressable) index whose `a` tags are the cards. */
    naddr: string;
  }

  let { naddr }: Props = $props();

  let items = $state<Event[]>([]);
  let loading = $state(true);
  let error = $state('');

  function childAddresses(event: Event): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const tag of event.tags) {
      if (tag[0] !== 'a' || !tag[1]?.trim()) continue;
      const key = tag[1].trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(tag[1].trim());
    }
    return out;
  }

  $effect(() => {
    const pointer = naddr.trim();
    let cancelled = false;
    loading = true;
    error = '';
    items = [];
    void (async () => {
      try {
        let hints: string[] = [];
        let coord = '';
        try {
          const decoded = nip19.decode(pointer);
          if (decoded.type !== 'naddr') {
            error = 'Invalid index pointer.';
            return;
          }
          const { kind, pubkey, identifier, relays } = decoded.data;
          coord = `${kind}:${pubkey}:${identifier}`;
          hints = relays ?? [];
        } catch {
          error = 'Invalid index pointer.';
          return;
        }
        const root = await fetchByAddress(coord, { hintRelays: hints });
        if (cancelled) return;
        if (!root) {
          error = 'Could not load this index.';
          return;
        }
        rememberEvents([root]);
        const addrs = childAddresses(root);
        if (!addrs.length) {
          items = [];
          return;
        }
        const fetched = await poolMap(addrs, 4, (addr) =>
          fetchByAddress(addr, { hintRelays: hints })
        );
        if (cancelled) return;
        const list = fetched.filter((e): e is Event => !!e);
        rememberEvents(list);
        items = list;
      } catch {
        if (!cancelled) error = 'Could not load this index.';
      } finally {
        if (!cancelled) loading = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  });
</script>

{#if loading}
  <LoadingHint message="Loading…" compact />
{:else if error}
  <p class="muted">{error}</p>
{:else if !items.length}
  <p class="muted">No entries yet.</p>
{:else}
  <ul class="index-card-list">
    {#each items as event (event.id)}
      <li class="index-card-list-item">
        <PublicationCard {event} />
      </li>
    {/each}
  </ul>
{/if}

<style>
  .index-card-list {
    list-style: none;
    margin: 0.75rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .index-card-list-item {
    margin: 0;
    padding: 0;
    min-width: 0;
  }
</style>
