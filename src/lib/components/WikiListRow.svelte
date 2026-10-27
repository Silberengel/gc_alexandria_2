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
</script>

<li class="wiki-list-row">
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
</li>
