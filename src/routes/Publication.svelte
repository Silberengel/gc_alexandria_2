<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import PublicationCard from '$lib/components/PublicationCard.svelte';
  import ErrorPage from '$lib/components/ErrorPage.svelte';
  import UserBadge from '$lib/components/UserBadge.svelte';
  import { KIND } from '$lib/constants';
  import { displayTitle } from '$lib/metadata';
  import { mercuryPublicationMeta } from '$lib/nostr/mercury';
  import { relayPool } from '$lib/nostr/pool';
  import { documentStack, socialStack } from '$lib/nostr/selector';
  import { firstTag } from '$lib/nostr/verify';
  import { nip19 } from 'nostr-tools';
  import type { Event } from 'nostr-tools';

  interface Props {
    params?: { d?: string; npub?: string; naddr?: string };
  }

  let { params = {} }: Props = $props();

  let event = $state<Event | null>(null);
  let ratings = $state<Event[]>([]);
  let comments = $state<Event[]>([]);
  let highlights = $state<Event[]>([]);
  let reading = $state(false);
  let sections = $state<Event[]>([]);
  let error = $state(false);

  onMount(async () => {
    try {
      if (params.naddr) {
        const decoded = nip19.decode(params.naddr);
        if (decoded.type === 'naddr') {
          const { kind, pubkey, identifier } = decoded.data;
          const fetched = await relayPool.query(documentStack(), [{
            kinds: [kind],
            authors: [pubkey],
            '#d': [identifier],
            limit: 1
          }]);
          event = fetched[0] ?? null;
        }
      } else if (params.d && params.npub) {
        let pubkey = params.npub;
        try {
          const d = nip19.decode(params.npub);
          if (d.type === 'npub') pubkey = d.data;
        } catch { /* hex */ }
        const fetched = await relayPool.query(documentStack(), [{
          kinds: [KIND.PUBLICATION],
          authors: [pubkey],
          '#d': [params.d],
          limit: 1
        }]);
        event = fetched[0] ?? null;
      }
      if (!event || event.kind !== KIND.PUBLICATION) {
        error = true;
        return;
      }
      const addr = `${KIND.PUBLICATION}:${event.pubkey}:${firstTag(event, 'd')}`;
      const [r, c, h] = await Promise.all([
        relayPool.query(socialStack(), [{ kinds: [KIND.RATING], '#a': [addr], limit: 50 }]),
        relayPool.query(socialStack(), [{ kinds: [KIND.COMMENT], '#a': [addr], limit: 50 }]),
        relayPool.query(socialStack(), [{ kinds: [KIND.HIGHLIGHT], '#a': [addr], limit: 50 }])
      ]);
      ratings = r;
      comments = c;
      highlights = h;
    } catch {
      error = true;
    }
  });

  async function startReading() {
    if (!event) return;
    reading = true;
    try {
      const naddr = nip19.naddrEncode({
        kind: event.kind,
        pubkey: event.pubkey,
        identifier: firstTag(event, 'd') ?? ''
      });
      sections = await import('$lib/nostr/mercury').then((m) => m.mercuryPublicationStream(naddr));
    } catch {
      sections = [];
    }
  }
</script>

<TopBar />
<main class="shell">
  {#if error}
    <ErrorPage title="Edition not found" />
  {:else if event}
    <header class="card" style="margin-bottom:1.5rem">
      <h1>{displayTitle(event)}</h1>
      <p>Published by <UserBadge pubkey={event.pubkey} /></p>
      {#if !reading}
        <button class="btn btn-primary" type="button" onclick={startReading}>Read the publication</button>
      {/if}
    </header>

    {#if !reading}
      {#if ratings.length}
        <section class="card" style="margin-bottom:1rem"><h2>Ratings</h2><p>{ratings.length} ratings</p></section>
      {/if}
      {#if comments.length}
        <section class="card" style="margin-bottom:1rem"><h2>Comments</h2>
          {#each comments as c}<p>{c.content}</p>{/each}
        </section>
      {/if}
      {#if highlights.length}
        <section class="card" style="margin-bottom:1rem"><h2>Highlights</h2>
          {#each highlights as h}<p>{h.content}</p>{/each}
        </section>
      {/if}
    {:else}
      <div class="reading-body">
        {#each sections as section}
          <article style="margin-bottom:2rem">
            <div>{@html section.content}</div>
            <details class="accordion">
              <summary>Comments for this section</summary>
              <p class="muted">Section comments appear here when loaded.</p>
            </details>
          </article>
        {/each}
      </div>
    {/if}
  {:else}
    <p class="muted">Loading…</p>
  {/if}
</main>
