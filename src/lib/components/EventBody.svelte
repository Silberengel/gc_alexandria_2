<script lang="ts">
  import { untrack } from 'svelte';
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import LoadingHint from './LoadingHint.svelte';
  import { KIND } from '$lib/constants';
  import {
    renderWithFallback,
    markHighlights,
    resolveMarkup,
    isAllowedMediaUrl,
    type HighlightQuote
  } from '$lib/markup';
  import { attachHighlightBadges } from '$lib/text-highlights';
  import { eventHeroImageUrls, stripEarlyDuplicateHeroImage } from '$lib/cover';
  import { omitMediaUrls, stripRenderedMedia, uniqueMedia } from '$lib/media';
  import {
    coalesceInlineMentions,
    expandNostrRefPlaceholders,
    protectNostrRefsForMarkup,
    splitNostrRefs,
    type RenderSegment,
    type ContentSegment
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
  import { webBookmarkUrl } from '$lib/web-bookmark';
  import WebBookmarkEmbed from './WebBookmarkEmbed.svelte';

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
    dedupeHeroUrls = []
  }: Props = $props();

  /** NIP-92 imeta tags plus bare image/video/audio URLs in the content. */
  const media = $derived(
    event ? uniqueMedia(event).filter((item) => isAllowedMediaUrl(item.url)) : []
  );
  const images = $derived(media.filter((item) => item.type === 'image'));
  const imageUrls = $derived(images.map((item) => item.url));
  const imageAlts = $derived(images.map((item) => item.alt?.trim() || ''));
  /** NIP-B0 URL from tags when content is empty / does not already include it. */
  const bookmarkUrl = $derived.by(() => {
    if (!event) return null;
    const url = webBookmarkUrl(event);
    if (!url) return null;
    const body = (event.content ?? content ?? '').toLowerCase();
    if (body.includes(url.toLowerCase())) return null;
    return url;
  });

  function openImageGallery(url: string): void {
    openMediaViewer({ url, urls: imageUrls, alts: imageAlts });
  }
  /** Drop played file URLs from the prose so a note is not a link and a player. */
  const source = $derived(omitMediaUrls(event?.content ?? content, media));
  const sourceKind = $derived(kind ?? event?.kind ?? KIND.LONG_FORM);
  const sourceTags = $derived(event?.tags ?? []);
  const markupFormat = $derived(resolveMarkup(sourceKind, source, sourceTags));
  const usePlaintextRich = $derived(markupFormat === 'plaintext');
  /** Kind 7/17 custom emoji reactions — paint the tagged face, not clipped alt text. */
  const reactionFace = $derived(event ? resolveReactionEmoji(event) : null);
  const heroUrls = $derived.by(() => {
    const urls: string[] = [...dedupeHeroUrls];
    if (dedupeHeroImage && event) urls.push(...eventHeroImageUrls(event));
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
    const qSnap = quotesSig;
    const q = untrack(() => quotes);
    const heroes = heroUrls;
    const embeds = showEmbeds && embedDepth <= 1;
    const ev = event;
    void qSnap;
    let cancelled = false;
    if (plaintext) {
      bodyPending = false;
      segments = [];
      resolved = {};
      extraEmbeds = [];
      return;
    }
    bodyPending = true;
    segments = [];
    resolved = {};
    extraEmbeds = [];
    void (async () => {
      const found: Record<number, Event | null> = {};
      let next: Array<ContentSegment | RenderSegment> = [];

      const shownMedia = media.flatMap((item) => [item.url, item.poster]);
      const maybeDedupe = (html: string, early = true) => {
        let out = shownMedia.length ? stripRenderedMedia(html, shownMedia) : html;
        if (early && heroes.length) out = stripEarlyDuplicateHeroImage(out, heroes);
        return out;
      };

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
            if (seg.type !== 'ref') return;
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
          if (!embeds) return;
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
    if (!el || !ready || !q.length) return;
    return attachHighlightBadges(el);
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
  {:else if usePlaintextRich}
    <NostrRichText
      content={source}
      {event}
      kind={sourceKind}
      showEmbeds={showEmbeds && embedDepth <= 1}
    />
  {:else}
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
      {:else if !showEmbeds}
        <!-- Caller asked to omit embedded event cards. -->
      {:else if embedDepth > 1}
        <span class="muted">Embedded event</span>
      {:else if resolved[block.index]}
        {@render embedCard(resolved[block.index]!)}
      {:else if resolved[block.index] === null}
        <p class="muted">This item could not be found.</p>
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
