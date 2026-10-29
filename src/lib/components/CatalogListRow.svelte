<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import UserBadge from './UserBadge.svelte';
  import {
    catalogHubDTag,
    catalogHubKindLabel,
    catalogHubResultHref,
    catalogHubResultLabel
  } from '$lib/catalog-hub';
  import { KIND } from '$lib/constants';
  import { formatAbsoluteTime, formatRelativeTime } from '$lib/relative-time';
  import { warmNavEvent } from '$lib/nav-warm';
  import { cardMeta } from '$lib/metadata';
  import { contentHeroThumbUrl, coverImageUrl } from '$lib/cover';
  import { coverPlaceholderUrl } from '$lib/cover-fallback';

  interface Props {
    event: Event;
  }

  let { event }: Props = $props();

  const href = $derived(catalogHubResultHref(event));
  const title = $derived(catalogHubResultLabel(event));
  const kind = $derived(catalogHubKindLabel(event));
  const d = $derived(catalogHubDTag(event));
  const summary = $derived(cardMeta(event).summary);
  const relative = $derived(formatRelativeTime(event.created_at));
  const absolute = $derived(formatAbsoluteTime(event.created_at));
  /** Books: portrait plate. Articles: landscape hero. */
  const isBook = $derived(event.kind === KIND.PUBLICATION);
  const remoteThumb = $derived(contentHeroThumbUrl(event) ?? coverImageUrl(event));
  const placeholder = $derived(coverPlaceholderUrl(event));
  let remoteBroken = $state(false);

  $effect(() => {
    void event.id;
    void remoteThumb;
    remoteBroken = false;
  });

  const thumb = $derived(remoteThumb && !remoteBroken ? remoteThumb : placeholder);
  const isGenerated = $derived(!remoteThumb || remoteBroken);
</script>

<li
  class="wiki-list-row wiki-list-row-has-thumb"
  class:wiki-list-row-book={isBook}
>
  <a
    class="wiki-list-thumb"
    class:wiki-list-thumb-book={isBook}
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
