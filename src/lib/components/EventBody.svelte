<script lang="ts">
  import { untrack } from 'svelte';
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import LoadingHint from './LoadingHint.svelte';
  import { KIND } from '$lib/constants';
  import {
    renderWithFallback,
    renderHighlightEventHtml,
    markHighlights,
    resolveMarkup,
    isAllowedMediaUrl,
    type HighlightQuote
  } from '$lib/markup';
  import { attachHighlightBadges } from '$lib/text-highlights';
  import { attachYoutubeEmbeds } from '$lib/attach-youtube';
  import { eventHeroImageUrls, stripEarlyDuplicateHeroImage } from '$lib/cover';
  import { omitMediaUrls, stripRenderedMedia, uniqueMedia } from '$lib/media';
  import {
    coalesceInlineMentions,
    expandNostrRefPlaceholders,
    inlineNostrRefHtml,
    isInlineLabeledRef,
    protectNostrRefsForMarkup,
    splitNostrRefs,
    type RenderSegment,
    type ContentSegment,
    type RefSegment
  } from '$lib/nostr-refs';
  import { fetchByAddress, fetchById } from '$lib/nostr/fetch';
  import {
    expandCustomEmojiPlaceholders,
    prepareContentWithEmojis,
    resolveReactionEmoji
  } from '$lib/emoji-content';
  import { embedPointersFromTags, resolveEmbedPointer } from '$lib/event-embeds';
  import { eventAddress } from '$lib/nostr/verify';
  import NostrRichText from './NostrRichText.svelte';
  import LiveStreamCard from './LiveStreamCard.svelte';
  import MeetingSpaceCard from './MeetingSpaceCard.svelte';
  import MeetingRoomCard from './MeetingRoomCard.svelte';
  import RoomPresenceCard from './RoomPresenceCard.svelte';
  import { isNip53Kind, NIP53_KIND } from '$lib/nip53';
  import { openMediaViewer } from '$lib/stores/media-viewer';
  import { webBookmarkHrefFromD, webBookmarkUrl } from '$lib/web-bookmark';
  import WebBookmarkEmbed from './WebBookmarkEmbed.svelte';
  import WikiMergeCard from './WikiMergeCard.svelte';
  import WikiRedirectCard from './WikiRedirectCard.svelte';
  import AppHandlerChip from './AppHandlerChip.svelte';
  import HighlightSourceBlurb from './HighlightSourceBlurb.svelte';
  import EventReferenceBlurb from './EventReferenceBlurb.svelte';
  import { noteReferenceSpec } from '$lib/note-reference';
  import { eventTranslations } from '$lib/event-translation';
  import {
    isShortNoteEdited,
    mergeEditedShortNote,
    onShortNoteEdits,
    shortNoteEditState,
    type ShortNoteEditState
  } from '$lib/short-note-edits';
  import { formatAbsoluteTime, formatRelativeTime } from '$lib/relative-time';

  interface Props {
    event?: Event;
    content?: string;
    kind?: number;
    embedDepth?: number;
    /** When false, skip fetching/painting embedded naddr/nevent/note lines. */
    showEmbeds?: boolean;
    /** Quotes show each embedded event as a one-line link. */
    lineEmbeds?: boolean;
    quotes?: Array<string | HighlightQuote>;
    /**
     * When false, skip the event’s own cover URLs for early-body dedupe
     * (still applies {@link dedupeHeroUrls} when provided).
     */
    dedupeHeroImage?: boolean;
    /**
     * Extra cover URLs to strip from early body HTML — e.g. the publication
     * hero when rendering a nested section that repeats the same plate.
     */
    dedupeHeroUrls?: string[];
    /** Live-chat Shield: skip painting images/video/audio. */
    hideMedia?: boolean;
    /**
     * When false, skip the LibreTranslate overlay (caller already applied it —
     * e.g. bible sections that split Challoner notes first).
     */
    applyTranslation?: boolean;
  }

  let {
    event,
    content = '',
    kind,
    embedDepth = 0,
    showEmbeds = true,
    lineEmbeds = false,
    quotes = [],
    dedupeHeroImage = true,
    dedupeHeroUrls = [],
    hideMedia = false,
    applyTranslation = true
  }: Props = $props();

  /** NIP-41 kind-1010 author revision for kind-1 notes. */
  let noteEditState = $state<ShortNoteEditState | null>(null);
  let noteEditTick = $state(0);

  $effect(() => {
    const ev = event;
    if (!ev || ev.kind !== KIND.TEXT_NOTE) {
      noteEditState = null;
      return;
    }
    const unsub = onShortNoteEdits(ev.id, () => {
      noteEditTick += 1;
    });
    return unsub;
  });

  $effect(() => {
    const ev = event;
    void noteEditTick;
    if (!ev || ev.kind !== KIND.TEXT_NOTE) {
      noteEditState = null;
      return;
    }
    let cancelled = false;
    void shortNoteEditState(ev).then((state) => {
      if (!cancelled) noteEditState = state;
    });
    return () => {
      cancelled = true;
    };
  });

  const displayEvent = $derived(
    event?.kind === KIND.TEXT_NOTE
      ? mergeEditedShortNote(event, noteEditState?.latestAuthorEdit)
      : event
  );
  const noteEdited = $derived(
    !!event &&
      event.kind === KIND.TEXT_NOTE &&
      isShortNoteEdited(event, noteEditState?.latestAuthorEdit)
  );
  const noteEditRelative = $derived(
    noteEditState?.latestAuthorEdit
      ? formatRelativeTime(noteEditState.latestAuthorEdit.created_at)
      : ''
  );
  const noteEditAbsolute = $derived(
    noteEditState?.latestAuthorEdit
      ? formatAbsoluteTime(noteEditState.latestAuthorEdit.created_at)
      : ''
  );

  /** NIP-92 imeta tags plus bare image/video/audio URLs in the content. */
  const media = $derived(
    hideMedia || !displayEvent
      ? []
      : uniqueMedia(displayEvent).filter((item) => isAllowedMediaUrl(item.url))
  );
  const images = $derived(media.filter((item) => item.type === 'image'));
  const imageUrls = $derived(images.map((item) => item.url));
  const imageAlts = $derived(images.map((item) => item.alt?.trim() || ''));
  /** NIP-B0 URL from tags when content is empty / does not already include it. */
  const bookmarkUrl = $derived.by(() => {
    if (!displayEvent) return null;
    const url = webBookmarkUrl(displayEvent);
    if (!url) return null;
    const body = (displayEvent.content ?? content ?? '').toLowerCase();
    if (body.includes(url.toLowerCase())) return null;
    return url;
  });

  function openImageGallery(url: string): void {
    openMediaViewer({ url, urls: imageUrls, alts: imageAlts });
  }
  /** Active LibreTranslate overlay (⋯ → Translate this event) — does not mutate the Nostr event. */
  const translationEntry = $derived.by(() => {
    if (!applyTranslation) return undefined;
    const id = displayEvent?.id?.trim().toLowerCase() ?? event?.id?.trim().toLowerCase() ?? '';
    return id ? $eventTranslations[id] : undefined;
  });
  /** Drop played file URLs from the prose so a note is not a link and a player. */
  const source = $derived(
    translationEntry?.content
      ? translationEntry.content
      : omitMediaUrls(displayEvent?.content ?? content, media)
  );
  const sourceKind = $derived(kind ?? displayEvent?.kind ?? KIND.LONG_FORM);
  const sourceTags = $derived(displayEvent?.tags ?? []);
  const markupFormat = $derived(resolveMarkup(sourceKind, source, sourceTags));
  /** Kind 9802 paints context + marked quote via HTML, not the plaintext rich path. */
  const isHighlightEvent = $derived(sourceKind === KIND.HIGHLIGHT);
  const usePlaintextRich = $derived(markupFormat === 'plaintext' && !isHighlightEvent);
  const showReferenceBlurb = $derived(
    !!displayEvent && !isHighlightEvent && !!noteReferenceSpec(displayEvent)
  );
  let highlightHtml = $state('');
  /** Kind 7/17 custom emoji reactions — paint the tagged face, not clipped alt text. */
  const reactionFace = $derived(event ? resolveReactionEmoji(event) : null);
  const heroUrls = $derived.by(() => {
    const urls: string[] = [...dedupeHeroUrls];
    if (dedupeHeroImage && displayEvent) urls.push(...eventHeroImageUrls(displayEvent));
    return [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
  });
  /**
   * One render pass so a nostr:npub stays inside its sentence.
   * Splitting before AsciiDoc also breaks listings and tables.
   */
  const wholeDocument = $derived(
    sourceKind === KIND.SECTION ||
      sourceKind === KIND.WIKI ||
      sourceKind === KIND.SPEC ||
      sourceKind === KIND.LONG_FORM ||
      sourceKind === KIND.DJOT ||
      sourceKind === KIND.TEXT_NOTE ||
      sourceKind === KIND.COMMENT
  );
  let segments = $state<Array<ContentSegment | RenderSegment>>([]);
  let resolved = $state<Record<number, Event | null>>({});
  let extraEmbeds = $state<Event[]>([]);
  let bodyPending = $state(true);
  let bodyEl = $state<HTMLElement | null>(null);

  const blocks = $derived(
    coalesceInlineMentions(
      segments.flatMap((seg) =>
        seg.type === 'text' ? [{ type: 'html' as const, html: seg.text }] : [seg]
      )
    )
  );
  const loadingLabel = $derived(
    sourceKind === KIND.SECTION || sourceKind === KIND.PUBLICATION
      ? 'Publication is loading...'
      : 'Page is loading...'
  );

  const quotesSig = $derived(
    quotes
      .map((q) => (typeof q === 'string' ? q : `${q.pubkey ?? ''}\t${q.quote}`))
      .join('\n')
  );

  async function fetchRef(seg: ContentSegment | RenderSegment): Promise<Event | null> {
    if (seg.type !== 'ref') return null;
    if (seg.kind === 'naddr' && seg.naddr) {
      return fetchByAddress(`${seg.naddr.kind}:${seg.naddr.pubkey}:${seg.naddr.identifier}`, {
        hintRelays: seg.naddr.relays
      });
    }
    if ((seg.kind === 'nevent' || seg.kind === 'note') && seg.id) {
      return fetchById(seg.id, {
        hintRelays: seg.relays,
        authorPubkey: seg.pubkey
      });
    }
    return null;
  }

  async function loadTagEmbeds(ev: Event | undefined, already: Event[]): Promise<Event[]> {
    if (!ev) return [];
    const haveId = new Set(already.map((e) => e.id.toLowerCase()));
    const haveAddr = new Set(already.map((e) => eventAddress(e)));
    const extra: Event[] = [];
    for (const pointer of embedPointersFromTags(ev)) {
      const hit = await resolveEmbedPointer(pointer);
      if (!hit) continue;
      if (haveId.has(hit.id.toLowerCase())) continue;
      const addr = eventAddress(hit);
      if (haveAddr.has(addr)) continue;
      haveId.add(hit.id.toLowerCase());
      haveAddr.add(addr);
      extra.push(hit);
    }
    return extra;
  }

  $effect(() => {
    const src = source;
    const k = sourceKind;
    const tags = sourceTags;
    const whole = wholeDocument;
    const plaintext = usePlaintextRich;
    const highlight = isHighlightEvent;
    const qSnap = quotesSig;
    const q = untrack(() => quotes);
    const heroes = heroUrls;
    const embeds = showEmbeds && embedDepth <= 1;
    const ev = displayEvent;
    void qSnap;
    let cancelled = false;
    if (plaintext) {
      bodyPending = false;
      segments = [];
      resolved = {};
      extraEmbeds = [];
      highlightHtml = '';
      return;
    }
    bodyPending = true;
    segments = [];
    resolved = {};
    extraEmbeds = [];
    highlightHtml = '';
    void (async () => {
      const found: Record<number, Event | null> = {};
      let next: Array<ContentSegment | RenderSegment> = [];

      const shownMedia = media.flatMap((item) => [item.url, item.poster]);
      const maybeDedupe = (html: string, early = true) => {
        let out = shownMedia.length ? stripRenderedMedia(html, shownMedia) : html;
        if (early && heroes.length) out = stripEarlyDuplicateHeroImage(out, heroes);
        return out;
      };

      if (highlight && ev) {
        const html = maybeDedupe(
          await renderHighlightEventHtml({
            content: ev.content ?? src,
            tags: ev.tags,
            pubkey: ev.pubkey
          })
        );
        if (!cancelled) {
          highlightHtml = html;
          bodyPending = false;
        }
        return;
      }

      const { text: emojiReady, slots: emojiSlots } = await prepareContentWithEmojis(src, ev);
      const withEmojis = (html: string) => expandCustomEmojiPlaceholders(html, emojiSlots);

      if (whole) {
        const { text, refs } = protectNostrRefsForMarkup(emojiReady);
        const rendered = withEmojis(
          maybeDedupe(markHighlights(await renderWithFallback(k, text, tags), q))
        );
        next = expandNostrRefPlaceholders(rendered, refs);
        if (!cancelled) {
          segments = next;
          bodyPending = false;
        }
        if (!embeds) return;
        await Promise.all(
          next.map(async (seg, i) => {
            if (seg.type !== 'ref' || isInlineLabeledRef(seg)) return;
            found[i] = await fetchRef(seg);
          })
        );
        const extras = await loadTagEmbeds(
          ev,
          Object.values(found).filter((e): e is Event => !!e)
        );
        if (!cancelled) {
          resolved = { ...found };
          extraEmbeds = extras;
        }
        return;
      }

      const segs = splitNostrRefs(emojiReady);
      next = [];
      await Promise.all(
        segs.map(async (seg, i) => {
          if (seg.type === 'text') {
            let rendered = await renderWithFallback(k, seg.text, tags);
            rendered = maybeDedupe(rendered, i === 0);
            next[i] = { type: 'html', html: withEmojis(markHighlights(rendered, q)) };
            return;
          }
          next[i] = seg;
          if (!embeds || isInlineLabeledRef(seg)) return;
          found[i] = await fetchRef(seg);
        })
      );
      const extras = embeds
        ? await loadTagEmbeds(
            ev,
            Object.values(found).filter((e): e is Event => !!e)
          )
        : [];
      if (!cancelled) {
        segments = next;
        resolved = found;
        extraEmbeds = extras;
        bodyPending = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    const el = bodyEl;
    const ready = !bodyPending;
    const q = quotes;
    const selfMarked = highlightHtml.includes('text-highlight');
    if (!el || !ready) return;
    const stopYoutube = attachYoutubeEmbeds(el);
    const stopBadges =
      q.length || selfMarked ? attachHighlightBadges(el) : undefined;
    return () => {
      stopBadges?.();
      stopYoutube();
    };
  });

  /**
   * Hash-router apps cannot use plain `#section` hrefs — the browser replaces
   * `#/wiki/...` with `#_publications` and the route breaks. Scroll in place instead.
   */
  function handleInPageAnchorClick(e: MouseEvent): void {
    const hit = (e.target as Element | null)?.closest?.('a[href]');
    if (!hit || !(hit instanceof HTMLAnchorElement)) return;
    const href = (hit.getAttribute('href') ?? '').trim();
    if (!href.startsWith('#') || href.startsWith('#/')) return;
    // Always stop bare fragments — under hash routing they would replace the SPA route.
    e.preventDefault();
    e.stopPropagation();
    let id = href.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      /* keep raw */
    }
    if (!id) return;
    const root = bodyEl ?? document;
    const target =
      root.querySelector(`#${CSS.escape(id)}`) ??
      document.getElementById(id) ??
      (id.startsWith('_') ? null : root.querySelector(`#${CSS.escape(`_${id}`)}`));
    if (!target) return;
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  $effect(() => {
    const el = bodyEl;
    if (!el) return;
    el.addEventListener('click', handleInPageAnchorClick);
    return () => el.removeEventListener('click', handleInPageAnchorClick);
  });
</script>

{#snippet embedCard(hit: Event)}
  {#if lineEmbeds}
    {#await import('./EmbedEventLine.svelte') then mod}
      <mod.default event={hit} />
    {/await}
  {:else}
    {#await import('./EventCard.svelte') then mod}
      <mod.default event={hit} embedDepth={embedDepth + 1} asCard />
    {/await}
  {/if}
{/snippet}

<div class="event-body" bind:this={bodyEl}>
  {#if noteEdited && noteEditState?.latestAuthorEdit}
    <p class="short-note-edited muted">
      <span class="short-note-edited-badge">Edited</span>
      {#if noteEditRelative}
        <time
          datetime={new Date(noteEditState.latestAuthorEdit.created_at * 1000).toISOString()}
          title={noteEditAbsolute}>{noteEditRelative}</time
        >
      {/if}
    </p>
  {/if}
  {#if reactionFace}
    <p class="reaction-face">
      {#if reactionFace.url && isAllowedMediaUrl(reactionFace.url)}
        <img
          class="reaction-emoji content-emoji"
          src={reactionFace.url}
          alt={reactionFace.unicode ?? ''}
          title={reactionFace.shortcode ? `:${reactionFace.shortcode}:` : reactionFace.raw}
          loading="lazy"
          decoding="async"
        />
      {:else if reactionFace.unicode}
        <span>{reactionFace.unicode}</span>
      {:else if reactionFace.shortcode}
        <span class="reaction-face-fallback">:{reactionFace.shortcode}:</span>
      {:else}
        <span>{reactionFace.raw}</span>
      {/if}
    </p>
  {:else if event && sourceKind === NIP53_KIND.LIVE_EVENT}
    <LiveStreamCard {event} />
  {:else if event && sourceKind === NIP53_KIND.MEETING_SPACE}
    <MeetingSpaceCard {event} />
  {:else if event && sourceKind === NIP53_KIND.MEETING_ROOM}
    <MeetingRoomCard {event} />
  {:else if event && sourceKind === NIP53_KIND.ROOM_PRESENCE}
    <RoomPresenceCard {event} />
  {:else if event && (sourceKind === KIND.WIKI_MERGE_REQUEST || sourceKind === KIND.WIKI_MERGE_ACCEPTANCE)}
    <WikiMergeCard {event} />
  {:else if event && sourceKind === KIND.WIKI_REDIRECT}
    <WikiRedirectCard {event} />
  {:else if event && sourceKind === KIND.APP_HANDLER}
    <AppHandlerChip {event} showMenu={false} />
  {:else if isHighlightEvent}
    {#if displayEvent}
      <HighlightSourceBlurb event={displayEvent} />
    {/if}
    {#if bodyPending}
      <LoadingHint message={loadingLabel} />
    {:else if highlightHtml}
      {@html highlightHtml}
    {:else}
      <NostrRichText
        content={source}
        event={displayEvent}
        kind={sourceKind}
        showEmbeds={false}
      />
    {/if}
  {:else if usePlaintextRich}
    {#if showReferenceBlurb && displayEvent}
      <EventReferenceBlurb event={displayEvent} />
    {/if}
    <NostrRichText
      content={source}
      event={displayEvent}
      kind={sourceKind}
      showEmbeds={showEmbeds && embedDepth <= 1}
    />
  {:else}
    {#if showReferenceBlurb && displayEvent}
      <EventReferenceBlurb event={displayEvent} />
    {/if}
    {#if bodyPending}
      <LoadingHint message={loadingLabel} />
    {/if}
    {#each blocks as block, i (i)}
      {#if block.type === 'html'}
        {@html block.html}
      {:else if block.type === 'flow'}
        <p class="event-inline">
          {#each block.parts as part, pi (pi)}
            {#if part.type === 'html'}
              {@html part.html}
            {:else}
              <UserBadge pubkey={part.pubkey} compact />
            {/if}
          {/each}
        </p>
      {:else if isInlineLabeledRef(segments[block.index]!)}
        {@html inlineNostrRefHtml(segments[block.index] as RefSegment)}
      {:else if !showEmbeds}
        <!-- Caller asked to omit embedded event cards. -->
      {:else if embedDepth > 1}
        <span class="muted">Embedded event</span>
      {:else if resolved[block.index]}
        {@render embedCard(resolved[block.index]!)}
      {:else if resolved[block.index] === null}
        {@const miss = segments[block.index]}
        {@const bookmarkFallback =
          miss?.type === 'ref' &&
          miss.kind === 'naddr' &&
          miss.naddr?.kind === KIND.WEB_BOOKMARK
            ? webBookmarkHrefFromD(miss.naddr.identifier)
            : null}
        {#if bookmarkFallback}
          <WebBookmarkEmbed url={bookmarkFallback} />
        {:else}
          <p class="muted">This item could not be found.</p>
        {/if}
      {:else}
        <p class="muted">Opening…</p>
      {/if}
    {/each}
    {#each extraEmbeds as hit (hit.id)}
      {@render embedCard(hit)}
    {/each}
  {/if}
  {#if bookmarkUrl}
    <WebBookmarkEmbed url={bookmarkUrl} />
  {/if}
  {#if !isNip53Kind(sourceKind) || sourceKind === NIP53_KIND.LIVE_CHAT}
    {#each media as item (item.url)}
      {#if item.type === 'video'}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          class="event-imeta"
          src={item.url}
          poster={item.poster}
          controls
          playsinline
          preload="metadata"
        ></video>
      {:else if item.type === 'audio'}
        <!-- svelte-ignore a11y_media_has_caption -->
        <audio class="event-imeta" src={item.url} controls></audio>
      {:else}
        <button
          class="event-imeta-btn"
          type="button"
          title={item.alt?.trim() || (imageUrls.length > 1 ? 'View gallery' : 'View image')}
          aria-label={item.alt?.trim() || (imageUrls.length > 1 ? 'View gallery' : 'View image')}
          onclick={() => openImageGallery(item.url)}
        >
          <img
            class="event-imeta"
            src={item.url}
            alt={item.alt?.trim() || ''}
            loading="lazy"
            width={item.width}
            height={item.height}
          />
        </button>
      {/if}
    {/each}
  {/if}
</div>

<style>
  .short-note-edited {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0 0 0.5rem;
    font-size: 0.8rem;
  }
  .short-note-edited-badge {
    display: inline-block;
    padding: 0.1rem 0.4rem;
    border-radius: 0.25rem;
    background: color-mix(in srgb, var(--text-muted) 18%, transparent);
    color: var(--text-muted);
    font-weight: 600;
    letter-spacing: 0.02em;
  }
</style>
