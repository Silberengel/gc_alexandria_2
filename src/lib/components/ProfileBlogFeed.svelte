<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import Cover from './Cover.svelte';
  import { editionMetadata } from '$lib/publication-metadata';
  import { libraryDocumentPath } from '$lib/metadata';
  import { formatAbsoluteTime } from '$lib/relative-time';
  import {
    eventChronologySec,
    formatBlogDate
  } from '$lib/profile-route';
  import { warmNavEvent } from '$lib/nav-warm';

  interface Props {
    events: Event[];
  }

  let { events }: Props = $props();

  const sorted = $derived(
    [...events].sort((a, b) => eventChronologySec(b) - eventChronologySec(a))
  );
</script>

<ol class="profile-blog-list">
  {#each sorted as event (event.id)}
    {@const meta = editionMetadata(event)}
    {@const when = eventChronologySec(event)}
    {@const href = libraryDocumentPath(event)}
    {@const title = meta.titles[0] || 'Untitled'}
    <li class="profile-blog-item">
      <article class="profile-blog-card">
        <a
          class="profile-blog-cover-link"
          href={`#${href}`}
          use:link
          tabindex="-1"
          aria-hidden="true"
          onclick={() => warmNavEvent(event)}
        >
          <div class="profile-blog-cover">
            <Cover {event} loading="lazy" />
          </div>
        </a>
        <div class="profile-blog-body">
          {#if when > 0}
            <time class="profile-blog-date" datetime={new Date(when * 1000).toISOString()} title={formatAbsoluteTime(when)}>
              {formatBlogDate(when)}
            </time>
          {/if}
          <h3 class="profile-blog-title">
            <a href={`#${href}`} use:link onclick={() => warmNavEvent(event)}>{title}</a>
          </h3>
          {#if meta.summary}
            <p class="profile-blog-excerpt">{meta.summary}</p>
          {/if}
          <a class="profile-blog-read" href={`#${href}`} use:link onclick={() => warmNavEvent(event)}>
            Read
            <span aria-hidden="true">→</span>
          </a>
        </div>
      </article>
    </li>
  {/each}
</ol>
