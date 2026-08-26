<script lang="ts">
  import { link } from 'svelte-spa-router';
  import { nip19, type Event } from 'nostr-tools';
  import { mercuryFilter } from '$lib/nostr/mercury';
  import { relayPool } from '$lib/nostr/pool';
  import { socialStack } from '$lib/nostr/selector';
  import { firstTag } from '$lib/nostr/verify';
  import { toNostrBuildThumbUrl } from '$lib/nostr-build';
  import { muteState, isMutedAuthor } from '$lib/mute';

  interface Props {
    pubkey: string;
    compact?: boolean;
  }

  let { pubkey, compact = false }: Props = $props();

  let name = $state('');
  let picture = $state('');
  let npub = $state('');
  let pictureFailed = $state(false);
  const muted = $derived(isMutedAuthor(pubkey, $muteState));

  function kind0Value(event: Event, tagName: string, jsonKeys: string[]): string {
    const tagged = firstTag(event, tagName)?.trim();
    if (tagged) return tagged;
    try {
      const data = JSON.parse(event.content) as Record<string, unknown>;
      for (const key of jsonKeys) {
        const value = data[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
    } catch {
      /* content is not JSON */
    }
    return '';
  }

  $effect(() => {
    const pk = pubkey?.trim().toLowerCase() ?? '';
    name = '';
    picture = '';
    pictureFailed = false;
    npub = '';
    if (!/^[0-9a-f]{64}$/.test(pk)) return;
    try {
      npub = nip19.npubEncode(pk);
    } catch {
      npub = pk.slice(0, 8) + '…';
    }
    let cancelled = false;
    void (async () => {
      const mercury = await mercuryFilter({ kinds: [0], authors: [pk], limit: 1 });
      let meta = mercury[0] ?? null;
      if (!meta) {
        const fetched = await relayPool.query(socialStack(), [{ kinds: [0], authors: [pk], limit: 1 }]);
        meta = fetched[0] ?? null;
      }
      if (cancelled || !meta) {
        if (!cancelled && !name) name = (npub || pk).slice(0, 12) + '…';
        return;
      }
      name =
        kind0Value(meta, 'display_name', ['display_name']) ||
        kind0Value(meta, 'name', ['name', 'display_name']) ||
        (npub || pk).slice(0, 12) + '…';
      picture = toNostrBuildThumbUrl(kind0Value(meta, 'picture', ['picture']));
    })();
    return () => {
      cancelled = true;
    };
  });
</script>

{#if pubkey && !muted}
  <a class="userbadge" href={`#/p/${npub || pubkey}`} use:link>
    {#if !compact}
      {#if picture && !pictureFailed}
        <img
          class="userbadge-avatar"
          src={picture}
          alt=""
          onerror={() => {
            pictureFailed = true;
          }}
        />
      {:else}
        <svg class="userbadge-avatar userbadge-anon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="12" fill="currentColor" opacity="0.18" />
          <circle cx="12" cy="9" r="3.4" fill="currentColor" />
          <path d="M5.2 19.2c1.4-3.1 3.8-4.6 6.8-4.6s5.4 1.5 6.8 4.6" fill="currentColor" />
        </svg>
      {/if}
    {/if}
    <span>{name || '…'}</span>
  </a>
{/if}
