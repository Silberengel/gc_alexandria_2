<script lang="ts">
  import { link } from 'svelte-spa-router';
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import { KIND } from '$lib/constants';
  import { displayRefTitle, focusHrefForRef, pathForRef, warmLandingRef } from '$lib/landing';
  import { cropText } from '$lib/listing-table';
  import { formatAbsoluteTime, formatRelativeTime } from '$lib/relative-time';

  interface Props {
    event: Event;
    referenced: Event[];
    /** Editorial quote vs live community thread. */
    variant?: 'highlight' | 'discussion';
  }

  let { event, referenced, variant }: Props = $props();

  const pageHref = $derived(pathForRef(event, referenced));
  const itemHref = $derived(focusHrefForRef(event, referenced));
  const titleHref = $derived(itemHref || pageHref);
  const title = $derived(displayRefTitle(event, referenced));
  const excerpt = $derived(cropText(event.content, 160));
  const quotedExcerpt = $derived(asPullQuote(excerpt));
  const mode = $derived(
    variant ??
      (event.kind === KIND.HIGHLIGHT
        ? 'highlight'
        : event.kind === KIND.COMMENT || event.kind === KIND.TEXT_NOTE
          ? 'discussion'
          : 'discussion')
  );
  const titleHint = $derived(mode === 'highlight' ? 'Open this highlight' : 'Open this comment');
  const when = $derived(formatRelativeTime(event.created_at));
  const whenAbs = $derived(formatAbsoluteTime(event.created_at));

  /** Wrap in “…” only when the text isn’t already quoted. */
  function asPullQuote(text: string): string {
    const t = text.trim();
    if (!t) return '';
    // Already opens with a quote (closing may be truncated by cropText).
    if (/^["“„«'‘]/.test(t)) return t;
    return `“${t}”`;
  }

  function warmWork(): void {
    warmLandingRef(event, referenced);
  }
</script>

<li class="landing-ref" class:landing-ref-highlight={mode === 'highlight'} class:landing-ref-discussion={mode === 'discussion'}>
  {#if titleHref}
    <a
      class="landing-ref-title"
      href={`#${titleHref}`}
      use:link
      title={titleHint}
      onpointerdown={warmWork}
    >{title}</a>
  {:else}
    <span class="landing-ref-title">{title}</span>
  {/if}

  {#if mode === 'highlight'}
    {#if quotedExcerpt}
      <p class="landing-ref-excerpt landing-ref-quote">{quotedExcerpt}</p>
    {/if}
  {:else}
    <div class="landing-ref-byline landing-ref-byline-live">
      <UserBadge pubkey={event.pubkey} />
      {#if when}
        <span class="landing-ref-meta-sep" aria-hidden="true">·</span>
        <time class="landing-ref-when" datetime={new Date(event.created_at * 1000).toISOString()} title={whenAbs}
          >{when}</time
        >
      {/if}
    </div>
    {#if excerpt}
      <p class="landing-ref-excerpt">{excerpt}</p>
    {/if}
  {/if}
</li>
