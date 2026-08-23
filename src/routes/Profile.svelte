<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import UserBadge from '$lib/components/UserBadge.svelte';
  import PublicationCard from '$lib/components/PublicationCard.svelte';
  import { KIND } from '$lib/constants';
  import { relayPool } from '$lib/nostr/pool';
  import { documentStack, socialStack } from '$lib/nostr/selector';
  import { firstTag } from '$lib/nostr/verify';
  import { toNostrBuildThumbUrl } from '$lib/nostr-build';
  import { hexPubkey } from '$lib/search';
  import { nip19 } from 'nostr-tools';
  import type { Event } from 'nostr-tools';

  interface Props {
    params?: { id?: string };
  }

  let { params = {} }: Props = $props();

  let pubkey = $state('');
  let profile = $state<Event | null>(null);
  let produced = $state<Event[]>([]);
  let pageFilter = $state('');

  onMount(async () => {
    const raw = params.id ?? '';
    try {
      const decoded = nip19.decode(raw);
      if (decoded.type === 'npub') pubkey = decoded.data;
      else if (decoded.type === 'nprofile') pubkey = decoded.data.pubkey;
    } catch {
      pubkey = hexPubkey(raw) ?? raw;
    }
    const [p, pubs] = await Promise.all([
      relayPool.query(socialStack(), [{ kinds: [0], authors: [pubkey], limit: 1 }]),
      relayPool.query(documentStack(), [{ kinds: [KIND.PUBLICATION, KIND.WIKI, KIND.SPEC], authors: [pubkey], limit: 50 }])
    ]);
    profile = p[0] ?? null;
    produced = pubs;
  });

  const visible = $derived(produced.filter((e) =>
    !pageFilter || JSON.stringify(e).toLowerCase().includes(pageFilter.toLowerCase())
  ));
</script>

<TopBar />
<main class="shell">
  <h1>Profile</h1>
  <input type="search" placeholder="Filter this page…" bind:value={pageFilter} style="max-width:20rem;margin-bottom:1rem" />
  {#if profile}
    <div class="card" style="margin-bottom:1rem">
      {#if firstTag(profile, 'picture')}
        <img src={toNostrBuildThumbUrl(firstTag(profile, 'picture') ?? '')} alt="" style="width:4rem;height:4rem;border-radius:999px" />
      {/if}
      <h2>{firstTag(profile, 'display_name') ?? firstTag(profile, 'name') ?? 'Unknown'}</h2>
      <p class="muted">{firstTag(profile, 'about')}</p>
    </div>
  {:else}
    <p><UserBadge pubkey={pubkey} /></p>
  {/if}
  <h2 class="section-title">Produced</h2>
  <div class="card-grid card-grid-results">
    {#each visible.slice(0, 25) as event}
      <PublicationCard {event} />
    {/each}
  </div>
</main>
