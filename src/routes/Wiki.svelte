<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import ErrorPage from '$lib/components/ErrorPage.svelte';
  import UserBadge from '$lib/components/UserBadge.svelte';
  import { KIND } from '$lib/constants';
  import { displayTitle } from '$lib/metadata';
  import { relayPool } from '$lib/nostr/pool';
  import { wikiStack, socialStack } from '$lib/nostr/selector';
  import { nip19 } from 'nostr-tools';
  import type { Event } from 'nostr-tools';

  interface Props {
    params?: { d?: string; npub?: string; naddr?: string };
  }

  let { params = {} }: Props = $props();

  let event = $state<Event | null>(null);
  let comments = $state<Event[]>([]);
  let highlights = $state<Event[]>([]);
  let error = $state(false);

  onMount(async () => {
    try {
      let pubkey = params.npub ?? '';
      try {
        const d = nip19.decode(params.npub ?? '');
        if (d.type === 'npub') pubkey = d.data;
      } catch { /* hex */ }

      if (params.naddr) {
        const decoded = nip19.decode(params.naddr);
        if (decoded.type === 'naddr') {
          const { kind, pubkey: pk, identifier } = decoded.data;
          const fetched = await relayPool.query(wikiStack(), [{
            kinds: [kind],
            authors: [pk],
            '#d': [identifier],
            limit: 1
          }]);
          event = fetched[0] ?? null;
        }
      } else if (params.d && pubkey) {
        const fetched = await relayPool.query(wikiStack(), [{
          kinds: [KIND.WIKI, KIND.SPEC],
          authors: [pubkey],
          '#d': [params.d],
          limit: 1
        }]);
        event = fetched[0] ?? null;
      }
      if (!event) { error = true; return; }
      const addr = `${event.kind}:${event.pubkey}:${event.tags.find((t) => t[0] === 'd')?.[1] ?? ''}`;
      [comments, highlights] = await Promise.all([
        relayPool.query(socialStack(), [{ kinds: [KIND.COMMENT], '#a': [addr], limit: 50 }]),
        relayPool.query(socialStack(), [{ kinds: [KIND.HIGHLIGHT], '#a': [addr], limit: 50 }])
      ]);
    } catch {
      error = true;
    }
  });
</script>

<TopBar />
<main class="shell">
  {#if error}
    <ErrorPage title="Wiki page not found" />
  {:else if event}
    <article class="card reading-body">
      <h1>{displayTitle(event)}</h1>
      <p>Published by <UserBadge pubkey={event.pubkey} /></p>
      <div>{@html event.content}</div>
    </article>
    {#if highlights.length}
      <section class="card" style="margin-top:1rem"><h2>Highlights</h2>
        {#each highlights as h}<p>{h.content}</p>{/each}
      </section>
    {/if}
    {#if comments.length}
      <section class="card" style="margin-top:1rem"><h2>Comments</h2>
        {#each comments as c}<p>{c.content}</p>{/each}
      </section>
    {/if}
  {:else}
    <p class="muted">Loading…</p>
  {/if}
</main>
