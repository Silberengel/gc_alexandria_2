<script lang="ts">
  import { untrack } from 'svelte';
  import { link } from 'svelte-spa-router';
  import { nip19, type Event } from 'nostr-tools';
  import { KIND } from '$lib/constants';
  import { relayPool } from '$lib/nostr/pool';
  import { profileStack } from '$lib/nostr/selector';
  import { firstTag } from '$lib/nostr/verify';
  import { toNostrBuildThumbUrl } from '$lib/nostr-build';
  import { muteState, isMutedAuthor } from '$lib/mute';
  import { session } from '$lib/stores/session';

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

  function applyKind0(meta: Event, fallback: string): void {
    const nextName =
      kind0Value(meta, 'display_name', ['display_name']) ||
      kind0Value(meta, 'name', ['name', 'display_name']) ||
      fallback;
    const nextPicture = toNostrBuildThumbUrl(kind0Value(meta, 'picture', ['picture']));
    untrack(() => {
      if (name !== nextName) name = nextName;
      if (picture !== nextPicture) {
        picture = nextPicture;
        pictureFailed = false;
      }
    });
  }

  $effect(() => {
    const pk = pubkey?.trim().toLowerCase() ?? '';
    let cancelled = false;

    // Writes must be untracked — clearing then re-applying kind-0 would otherwise
    // re-trigger this effect forever (effect_update_depth_exceeded).
    untrack(() => {
      name = '';
      picture = '';
      pictureFailed = false;
      npub = '';
    });

    if (!/^[0-9a-f]{64}$/.test(pk)) return;

    let nextNpub = '';
    try {
      nextNpub = nip19.npubEncode(pk);
    } catch {
      nextNpub = pk.slice(0, 8) + '…';
    }
    const fallback = (nextNpub || pk).slice(0, 12) + '…';
    untrack(() => {
      npub = nextNpub;
    });

    const applyLocal = (events: Event[]) => {
      if (cancelled) return;
      const local = events.find((e) => e.kind === KIND.METADATA && e.pubkey.toLowerCase() === pk);
      if (local) applyKind0(local, fallback);
    };
    // Prefer signed-in metadata so the viewer's own badge paints immediately.
    applyLocal(session.getMetadata());

    const unsubMeta = session.metadata.subscribe((events) => {
      applyLocal(events);
    });

    void (async () => {
      const fetched = await relayPool.query(
        profileStack(),
        [{ kinds: [0], authors: [pk], limit: 1 }],
        4000
      );
      if (cancelled) return;
      const meta = fetched[0] ?? null;
      if (meta) {
        applyKind0(meta, fallback);
        return;
      }
      untrack(() => {
        if (!name) name = fallback;
      });
    })();

    return () => {
      cancelled = true;
      unsubMeta();
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
