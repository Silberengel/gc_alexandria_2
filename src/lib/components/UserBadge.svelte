<script lang="ts">
  import { untrack } from 'svelte';
  import { link } from 'svelte-spa-router';
  import { nip19, type Event } from 'nostr-tools';
  import { KIND } from '$lib/constants';
  import { relayPool } from '$lib/nostr/pool';
  import { profileStack } from '$lib/nostr/selector';
  import { cachePutEvent } from '$lib/nostr/cache';
  import { cachedImageSrc, peekCachedImageSrc } from '$lib/image-cache';
  import {
    peekProfileThumb,
    rememberProfileFromKind0
  } from '$lib/profile-cache';
  import { memoryFindMetadata, rememberEvents } from '$lib/nostr/event-memory';
  import { muteState, isMutedAuthor } from '$lib/mute';
  import { session } from '$lib/stores/session';

  interface Props {
    pubkey: string;
    compact?: boolean;
  }

  let { pubkey, compact = false }: Props = $props();

  let name = $state('');
  let picture = $state('');
  let displayPicture = $state('');
  let npub = $state('');
  let pictureFailed = $state(false);
  const muted = $derived(isMutedAuthor(pubkey, $muteState));

  function applyThumb(nextName: string, nextPicture: string): void {
    untrack(() => {
      if (nextName && name !== nextName) name = nextName;
      if (picture !== nextPicture) {
        picture = nextPicture;
        pictureFailed = false;
        const peek = nextPicture ? peekCachedImageSrc(nextPicture) : null;
        displayPicture = peek ?? nextPicture;
        if (nextPicture) {
          void cachedImageSrc(nextPicture).then((src) => {
            if (picture === nextPicture) displayPicture = src;
          });
        } else {
          displayPicture = '';
        }
      }
    });
  }

  function applyKind0(meta: Event, fallback: string): void {
    rememberEvents([meta]);
    const thumb = rememberProfileFromKind0(meta);
    applyThumb(thumb.name || fallback, thumb.picture);
  }

  $effect(() => {
    const pk = pubkey?.trim().toLowerCase() ?? '';
    let cancelled = false;

    if (!/^[0-9a-f]{64}$/.test(pk)) {
      untrack(() => {
        name = '';
        picture = '';
        displayPicture = '';
        pictureFailed = false;
        npub = '';
      });
      return;
    }

    let nextNpub = '';
    try {
      nextNpub = nip19.npubEncode(pk);
    } catch {
      nextNpub = pk.slice(0, 8) + '…';
    }
    const fallback = (nextNpub || pk).slice(0, 12) + '…';

    // Prefer remembered thumb so refresh does not flash the anon silhouette.
    const remembered = peekProfileThumb(pk);
    const memMeta = memoryFindMetadata(pk);
    untrack(() => {
      npub = nextNpub;
      if (memMeta) {
        applyKind0(memMeta, fallback);
      } else if (remembered) {
        name = remembered.name || fallback;
        picture = remembered.picture;
        pictureFailed = false;
        displayPicture = remembered.picture
          ? (peekCachedImageSrc(remembered.picture) ?? remembered.picture)
          : '';
        if (remembered.picture) {
          void cachedImageSrc(remembered.picture).then((src) => {
            if (!cancelled && picture === remembered.picture) displayPicture = src;
          });
        }
      } else if (!name) {
        name = fallback;
      }
    });

    const applyLocal = (events: Event[]) => {
      if (cancelled) return;
      const local = events.find((e) => e.kind === KIND.METADATA && e.pubkey.toLowerCase() === pk);
      if (local) applyKind0(local, fallback);
    };
    applyLocal(session.getMetadata());

    const unsubMeta = session.metadata.subscribe((events) => {
      applyLocal(events);
    });

    // Already have a real picture from cache — skip a redundant profile REQ.
    const hasPicture = Boolean(peekProfileThumb(pk)?.picture || memoryFindMetadata(pk));
    if (hasPicture) {
      return () => {
        cancelled = true;
        unsubMeta();
      };
    }

    void (async () => {
      const fetched = await relayPool.query(
        profileStack(),
        [{ kinds: [0], authors: [pk], limit: 1 }],
        4000
      );
      if (cancelled) return;
      const meta = fetched[0] ?? null;
      if (meta) {
        void cachePutEvent(meta);
        applyKind0(meta, fallback);
        return;
      }
      untrack(() => {
        if (!name) name = fallback;
        // Do not persist anon fallbacks — that poisons badges after a missed relay hit.
      });
    })();

    return () => {
      cancelled = true;
      unsubMeta();
    };
  });
</script>

{#if pubkey && !muted}
  <a
    class="userbadge"
    href={`#/p/${npub || pubkey}`}
    use:link
    onpointerdown={() => {
      const meta = memoryFindMetadata(pubkey);
      if (meta) rememberEvents([meta]);
    }}
  >
    {#if !compact}
      {#if displayPicture && !pictureFailed}
        <img
          class="userbadge-avatar"
          src={displayPicture}
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
