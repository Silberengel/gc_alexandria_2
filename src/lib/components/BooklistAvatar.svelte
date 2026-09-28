<script lang="ts">
  import { untrack } from 'svelte';
  import { link } from 'svelte-spa-router';
  import { nip19, type Event } from 'nostr-tools';
  import { KIND } from '$lib/constants';
  import { relayPool } from '$lib/nostr/pool';
  import { profileStack } from '$lib/nostr/selector';
  import { cachePutEvent } from '$lib/nostr/cache';
  import { cachedImageSrc, peekCachedImageSrc } from '$lib/image-cache';
  import { peekProfileThumb, rememberProfileFromKind0 } from '$lib/profile-cache';
  import { memoryFindMetadata, rememberEvents } from '$lib/nostr/event-memory';
  import { pickLatestReplaceable } from '$lib/nostr/replaceable';
  import { muteState, isMutedAuthor } from '$lib/mute';
  import { session } from '$lib/stores/session';

  interface Props {
    pubkey: string;
  }

  let { pubkey }: Props = $props();

  let picture = $state('');
  let displayPicture = $state('');
  let pictureFailed = $state(false);
  let npub = $state('');
  let handle = $state('');
  const muted = $derived(isMutedAuthor(pubkey, $muteState));
  const tip = $derived(handle || npub || 'Open profile');

  function applyThumb(nextName: string, nextPicture: string): void {
    untrack(() => {
      if (nextName && handle !== nextName) handle = nextName;
      if (picture === nextPicture) return;
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
    });
  }

  $effect(() => {
    const pk = pubkey?.trim().toLowerCase() ?? '';
    let cancelled = false;

    if (!/^[0-9a-f]{64}$/.test(pk)) {
      untrack(() => {
        picture = '';
        displayPicture = '';
        pictureFailed = false;
        npub = '';
        handle = '';
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
    untrack(() => {
      npub = nextNpub;
      if (!handle) handle = fallback;
    });

    const cached = peekProfileThumb(pk);
    if (cached) applyThumb(cached.name || fallback, cached.picture);

    const applyLocal = (events: Event[]) => {
      if (cancelled) return;
      const local = pickLatestReplaceable(events, KIND.METADATA, pk);
      if (!local) return;
      rememberEvents([local]);
      const thumb = rememberProfileFromKind0(local);
      applyThumb(thumb.name || fallback, thumb.picture);
    };
    applyLocal(session.getMetadata());
    const unsubMeta = session.metadata.subscribe(applyLocal);

    if (memoryFindMetadata(pk) || cached?.picture) {
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
      const meta = pickLatestReplaceable(fetched, KIND.METADATA, pk) ?? fetched[0] ?? null;
      if (meta) {
        void cachePutEvent(meta);
        rememberEvents([meta]);
        const thumb = rememberProfileFromKind0(meta);
        applyThumb(thumb.name || fallback, thumb.picture);
      }
    })();

    return () => {
      cancelled = true;
      unsubMeta();
    };
  });
</script>

{#if pubkey && !muted}
  <a
    class="booklist-avatar"
    href={`#/p/${npub || pubkey}`}
    use:link
    title={tip}
    aria-label={tip}
    onclick={(e) => e.stopPropagation()}
  >
    {#if displayPicture && !pictureFailed}
      <img
        src={displayPicture}
        alt=""
        onerror={() => {
          pictureFailed = true;
        }}
      />
    {:else}
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="12" fill="currentColor" opacity="0.18" />
        <circle cx="12" cy="9" r="3.4" fill="currentColor" />
        <path d="M5.2 19.2c1.4-3.1 3.8-4.6 6.8-4.6s5.4 1.5 6.8 4.6" fill="currentColor" />
      </svg>
    {/if}
  </a>
{/if}
