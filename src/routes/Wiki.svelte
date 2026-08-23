<script lang="ts">
  import { replace } from 'svelte-spa-router';
  import TopBar from '$lib/components/TopBar.svelte';
  import ErrorPage from '$lib/components/ErrorPage.svelte';
  import UserBadge from '$lib/components/UserBadge.svelte';
  import { KIND } from '$lib/constants';
  import { displayTitle, wikiPath } from '$lib/metadata';
  import { addressPath, parseAddress } from '$lib/library-scope';
  import { getWikiDeferTarget, isDeferralPlaceholderContent, isWikiDeference } from '$lib/wiki-defer';
  import { mercuryFilter } from '$lib/nostr/mercury';
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
  let deferredBy = $state('');
  let forwarding = $state(false);

  function hashQuery(): URLSearchParams {
    const hash = window.location.hash;
    const i = hash.indexOf('?');
    return new URLSearchParams(i >= 0 ? hash.slice(i + 1) : '');
  }

  async function eventFromId(id: string): Promise<Event | null> {
    const mercury = await mercuryFilter({ ids: [id], limit: 1 });
    if (mercury[0]) return mercury[0];
    const ws = await relayPool.query(wikiStack(), [{ ids: [id], limit: 1 }]);
    return ws[0] ?? null;
  }

  async function forwardDeference(from: Event): Promise<boolean> {
    if (hashQuery().get('deferredBy')) return false;
    const target = getWikiDeferTarget(from);
    if (!target) return false;
    let path: string | null = null;
    if (target.coordinate) {
      const parsed = parseAddress(target.coordinate);
      if (parsed && parsed.pubkey === from.pubkey) {
        const d = from.tags.find((t) => t[0] === 'd')?.[1] ?? '';
        if (parsed.d === d) return false;
      }
      path = addressPath(target.coordinate);
    }
    if (!path && target.eventId) {
      const dest = await eventFromId(target.eventId);
      if (dest) path = wikiPath(dest);
    }
    if (!path) return false;
    forwarding = true;
    replace(`${path}?deferredBy=${from.pubkey}`);
    return true;
  }

  $effect(() => {
    const dTag = params.d;
    const npubParam = params.npub;
    const naddr = params.naddr;
    let cancelled = false;
    event = null;
    comments = [];
    highlights = [];
    error = false;
    forwarding = false;
    deferredBy = hashQuery().get('deferredBy') ?? '';

    void (async () => {
      try {
        let pubkey = npubParam ?? '';
        try {
          const decodedNpub = nip19.decode(npubParam ?? '');
          if (decodedNpub.type === 'npub') pubkey = decodedNpub.data;
        } catch { /* hex */ }

        let fetched: Event | null = null;
        if (naddr) {
          const decoded = nip19.decode(naddr);
          if (decoded.type === 'naddr') {
            const { kind, pubkey: pk, identifier } = decoded.data;
            fetched = (await relayPool.query(wikiStack(), [{
              kinds: [kind],
              authors: [pk],
              '#d': [identifier],
              limit: 1
            }]))[0] ?? null;
          }
        } else if (dTag && pubkey) {
          fetched = (await relayPool.query(wikiStack(), [{
            kinds: [KIND.WIKI, KIND.SPEC],
            authors: [pubkey],
            '#d': [dTag],
            limit: 1
          }]))[0] ?? null;
        }
        if (cancelled) return;
        if (!fetched) { error = true; return; }
        if (await forwardDeference(fetched)) return;
        if (cancelled) return;
        event = fetched;
        const addr = `${fetched.kind}:${fetched.pubkey}:${fetched.tags.find((t) => t[0] === 'd')?.[1] ?? ''}`;
        const [c, h] = await Promise.all([
          relayPool.query(socialStack(), [{ kinds: [KIND.COMMENT], '#A': [addr], limit: 50 }]),
          relayPool.query(socialStack(), [{ kinds: [KIND.HIGHLIGHT], '#a': [addr], limit: 50 }])
        ]);
        if (cancelled) return;
        comments = c;
        highlights = h;
      } catch {
        if (!cancelled) error = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  });

  const hideBody = $derived(
    !!event && (isWikiDeference(event) || isDeferralPlaceholderContent(event.content))
  );
</script>

<TopBar />
<main class="shell">
  {#if error}
    <ErrorPage title="Wiki page not found" />
  {:else if forwarding}
    <p class="muted">Opening the preferred version…</p>
  {:else if event}
    {#if deferredBy}
      <p class="wiki-defer-banner">Deferred to by: <UserBadge pubkey={deferredBy} /></p>
    {/if}
    <article class="card reading-body">
      <h1>{displayTitle(event)}</h1>
      <p>Published by <UserBadge pubkey={event.pubkey} /></p>
      {#if !hideBody}
        <div>{@html event.content}</div>
      {/if}
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
