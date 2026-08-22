<script lang="ts">
  import { onMount } from 'svelte';
  import { link } from 'svelte-spa-router';
  import { nip19 } from 'nostr-tools';
  import { cacheGetEvent } from '$lib/nostr/cache';
  import { relayPool } from '$lib/nostr/pool';
  import { socialStack } from '$lib/nostr/selector';
  import { firstTag } from '$lib/nostr/verify';

  interface Props {
    pubkey: string;
    compact?: boolean;
  }

  let { pubkey, compact = false }: Props = $props();

  let name = $state('');
  let picture = $state('');
  let npub = $state('');

  onMount(async () => {
    try {
      npub = nip19.npubEncode(pubkey);
    } catch {
      npub = pubkey.slice(0, 8) + '…';
    }
    const cached = await cacheGetEvent(
      (await relayPool.query(socialStack(), [{ kinds: [0], authors: [pubkey], limit: 1 }]))[0]?.id ?? ''
    );
    let meta = cached;
    if (!meta) {
      const fetched = await relayPool.query(socialStack(), [{ kinds: [0], authors: [pubkey], limit: 1 }]);
      meta = fetched[0] ?? null;
    }
    if (meta) {
      name = firstTag(meta, 'name') ?? firstTag(meta, 'display_name') ?? '';
      picture = firstTag(meta, 'picture') ?? '';
    }
    if (!name) name = npub.slice(0, 12) + '…';
  });
</script>

<a class="userbadge" href={`#/p/${npub || pubkey}`} use:link>
  {#if picture && !compact}
    <img src={picture} alt="" />
  {/if}
  <span>{name}</span>
</a>
