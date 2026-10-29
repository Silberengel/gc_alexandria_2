<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import UserBadge from './UserBadge.svelte';
  import {
    wikiHubDTag,
    wikiHubKindLabel,
    wikiHubResultHref,
    wikiHubResultLabel
  } from '$lib/wiki-hub';
  import { formatAbsoluteTime, formatRelativeTime } from '$lib/relative-time';
  import { warmNavEvent } from '$lib/nav-warm';
  import { cardMeta } from '$lib/metadata';
  import { wikiSpecHeroThumbUrl } from '$lib/cover';
  import { coverPlaceholderUrl } from '$lib/cover-fallback';

  interface Props {
    event: Event;
  }

  let { event }: Props = $props();

  const href = $derived(wikiHubResultHref(event));
  const title = $derived(wikiHubResultLabel(event));
  const kind = $derived(wikiHubKindLabel(event));
  const d = $derived(wikiHubDTag(event));
  const summary = $derived(cardMeta(event).summary);
  const relative = $derived(formatRelativeTime(event.created_at));
  const absolute = $derived(formatAbsoluteTime(event.created_at));
  const remoteThumb = $derived(wikiSpecHeroThumbUrl(event));
  const placeholder = $derived(coverPlaceholderUrl(event));
  let remoteBroken = $state(false);

  $effect(() => {
    void event.id;
    void remoteThumb;
    remoteBroken = false;
  });

  const thumb = $derived(
    remoteThumb && !remoteBroken ? remoteThumb : placeholder
  );
  const isGenerated = $derived(!remoteThumb || remoteBroken);
</script>

<li class="wiki-list-row wiki-list-row-has-thumb">
  <a
    class="wiki-list-thumb"
    class:wiki-list-thumb-generated={isGenerated}
    href={href}
    use:link
    onclick={() => warmNavEvent(event)}
    tabindex="-1"
    aria-hidden="true"
  >
    <img
      src={thumb}
      alt=""
      loading="lazy"
      decoding="async"
      onerror={() => {
        if (remoteThumb && !remoteBroken) remoteBroken = true;
      }}
    />
  </a>
  <div class="wiki-list-body">
    <a
      class="wiki-list-title"
      href={href}
      use:link
      onclick={() => warmNavEvent(event)}
    >{title}</a>
    {#if summary}
      <p class="wiki-list-blurb muted">{summary}</p>
    {/if}
    <div class="wiki-list-meta muted">
      <span class="wiki-list-kind">{kind}</span>
      {#if d}
        <span class="wiki-list-d">{d}</span>
      {/if}
      <UserBadge pubkey={event.pubkey} />
      <time datetime={new Date(event.created_at * 1000).toISOString()} title={absolute}
        >{relative}</time
      >
    </div>
  </div>
</li>
