<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { prepareLines, tokenizeInline } from '$lib/plaintext-markup';
  import {
    coalescePlainMentionFlows,
    splitNostrRefs,
    type ContentSegment,
    type PlainBodyBlock
  } from '$lib/nostr-refs';
  import {
    expandCustomEmojiPlaceholders,
    prepareContentWithEmojis,
    type EmojiInfo
  } from '$lib/emoji-content';
  import { KIND } from '$lib/constants';
  import { isAllowedHref } from '$lib/markup';
  import { formatUrlHtml } from '$lib/crop-url';
  import { isNip53Kind, NIP53_KIND } from '$lib/nip53';
  import UserBadge from './UserBadge.svelte';
  import EmbedEventLine from './EmbedEventLine.svelte';
  import YouTubeEmbed from './YouTubeEmbed.svelte';
  import OgLinkPreviewCard from './OgLinkPreviewCard.svelte';
  import ExpandableUrlEventLink from './ExpandableUrlEventLink.svelte';
  import { parseYouTubeUrl } from '$lib/youtube';
  import { shouldOgPreview, tidyLinkUrl } from '$lib/og-preview';
  import { urlEmbedsNostrEvent } from '$lib/nostr-entity';
  import { fetchByAddress, fetchById } from '$lib/nostr/fetch';
  import { lruGet, lruSet } from '$lib/compose-lru';
  import { webBookmarkHrefFromD } from '$lib/web-bookmark';
  import WebBookmarkEmbed from './WebBookmarkEmbed.svelte';
  import { renderKatexHtml, splitMathSegments } from '$lib/katex-math';

  /** Kinds that need a full card (player, gallery, …) instead of a one-line blurb. */
  function useRichEmbedCard(event: Event): boolean {
    if (isNip53Kind(event.kind) && event.kind !== NIP53_KIND.LIVE_CHAT) return true;
    return (
      event.kind === KIND.VIDEO ||
      event.kind === KIND.SHORT_VIDEO ||
      event.kind === KIND.PICTURE ||
      event.kind === KIND.PUBLICATION ||
      event.kind === KIND.LONG_FORM ||
      event.kind === KIND.WIKI ||
      event.kind === KIND.SPEC ||
      event.kind === KIND.WEB_BOOKMARK
    );
  }

  function missingBookmarkUrl(seg: ContentSegment): string | null {
    if (seg.type !== 'ref' || seg.kind !== 'naddr' || !seg.naddr) return null;
    if (seg.naddr.kind !== KIND.WEB_BOOKMARK) return null;
    return webBookmarkHrefFromD(seg.naddr.identifier);
  }

  interface Props {
    content: string;
    event?: Event | null;
    kind?: number;
    /** Clamp with expand when set. */
    maxLines?: number;
    showEmbeds?: boolean;
  }

  let {
    content,
    event = null,
    kind: _kind,
    maxLines,
    showEmbeds = true
  }: Props = $props();

  let expanded = $state(false);
  let segments = $state<ContentSegment[]>([]);
  let resolved = $state<Record<number, Event | null>>({});
  /** Custom emoji slots — expand to <img> only after HTML escaping. */
  let emojiSlots = $state<EmojiInfo[]>([]);
  let generation = 0;
  let rootEl = $state<HTMLElement | null>(null);
  /** True only when clamped content actually overflows (hides useless Show more). */
  let truncated = $state(false);

  const LNBC = /\b(lnbc[0-9a-z]+)\b/gi;
  const XMR =
    /\b(4[0-9AB][1-9A-HJ-NP-Za-km-z]{93}|8[0-9AB][1-9A-HJ-NP-Za-km-z]{93})\b/g;
  const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/gi;
  const HASHTAG = /(^|[^\p{L}\p{N}_])#([\p{L}\p{N}_]{1,64})/gu;

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function linkifyBody(text: string): string {
    // Split around URLs so we can escape text while formatting links (safe-prefix
    // hyperlink + plaintext tracker tail, no ellipsis crop).
    const parts: string[] = [];
    let last = 0;
    URL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = URL_RE.exec(text))) {
      const url = m[1] ?? m[0];
      if (m.index > last) parts.push(escapeHtml(text.slice(last, m.index)));
      // YouTube / OG / njump-event links are lifted out — leave raw escaped text.
      if (parseYouTubeUrl(url) || urlEmbedsNostrEvent(url) || shouldOgPreview(url)) {
        parts.push(escapeHtml(url));
      } else if (!isAllowedHref(url)) {
        parts.push(escapeHtml(url));
      } else {
        parts.push(formatUrlHtml(url));
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push(escapeHtml(text.slice(last)));
    let s = parts.join('');
    s = s.replace(HASHTAG, (_m, prefix: string, tag: string) => {
      return `${prefix}<a href="#/search?subject=${encodeURIComponent(tag)}">#${tag}</a>`;
    });
    return s;
  }

  type LinkEmbedBit = { type: 'text' | 'youtube' | 'og' | 'url-event'; value: string };

  /** Pull YouTube, njump-event chevrons, and Open Graph cards out of plaintext. */
  function splitLinkEmbeds(text: string): LinkEmbedBit[] {
    const hits: Array<{
      index: number;
      end: number;
      type: 'youtube' | 'og' | 'url-event';
      value: string;
    }> = [];
    URL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = URL_RE.exec(text))) {
      const raw = m[1] ?? m[0];
      const value = tidyLinkUrl(raw);
      let type: 'youtube' | 'og' | 'url-event' | null = null;
      if (parseYouTubeUrl(value)) type = 'youtube';
      else if (urlEmbedsNostrEvent(value)) type = 'url-event';
      else if (shouldOgPreview(value)) type = 'og';
      if (!type) continue;
      hits.push({ index: m.index, end: m.index + m[0].length, type, value });
    }
    if (!hits.length) return [{ type: 'text', value: text }];
    const out: LinkEmbedBit[] = [];
    let last = 0;
    for (const hit of hits) {
      if (hit.index < last) continue;
      if (hit.index > last) out.push({ type: 'text', value: text.slice(last, hit.index) });
      out.push({ type: hit.type, value: hit.value });
      last = hit.end;
    }
    if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
    // Collapse blank lines glued to embeds (keep mid-paragraph spaces).
    for (let i = 0; i < out.length; i++) {
      const bit = out[i]!;
      if (bit.type !== 'text') continue;
      let value = bit.value;
      const prevEmbed = i > 0 && out[i - 1]!.type !== 'text';
      const nextEmbed = i + 1 < out.length && out[i + 1]!.type !== 'text';
      if (prevEmbed) value = value.replace(/^[ \t]*(?:\r?\n[ \t]*)+/g, '');
      if (nextEmbed) value = value.replace(/(?:[ \t]*\r?\n)+[ \t]*$/g, '');
      out[i] = { type: 'text', value };
    }
    return out.filter((bit) => bit.type !== 'text' || bit.value.length > 0);
  }

  function renderInline(body: string): string {
    return tokenizeInline(body)
      .map((tok) => {
        if (tok.type === 'bold') return `<strong>${linkifyBody(tok.value)}</strong>`;
        if (tok.type === 'italic') return `<em>${linkifyBody(tok.value)}</em>`;
        return linkifyBody(tok.value);
      })
      .join('');
  }

  function renderPlainBlockInner(text: string): string {
    const lines = prepareLines(text);
    return lines
      .map((line) => {
        const inner = `${escapeHtml(line.prefix)}${renderInline(line.body)}`;
        if (line.kind === 'greentext') {
          return `<div class="nrt-greentext">${inner || '&nbsp;'}</div>`;
        }
        if (line.kind === 'quote') {
          return `<blockquote class="nrt-quote">${inner || '&nbsp;'}</blockquote>`;
        }
        return `<div class="nrt-line">${inner || '&nbsp;'}</div>`;
      })
      .join('');
  }

  /** Inline-safe lines so a UserBadge can sit mid-sentence without a hard break. */
  function renderFlowTextInner(text: string): string {
    const lines = prepareLines(text);
    return lines
      .map((line) => {
        const inner = `${escapeHtml(line.prefix)}${renderInline(line.body)}`;
        if (line.kind === 'greentext') {
          return `<span class="nrt-greentext">${inner || '&nbsp;'}</span>`;
        }
        if (line.kind === 'quote') {
          return `<span class="nrt-quote">${inner || '&nbsp;'}</span>`;
        }
        return `<span class="nrt-phrase">${inner}</span>`;
      })
      .join('<br>');
  }

  /** KaTeX for `$…$` / `$$…$$` and math wrapped in backticks / ``` fences. */
  function renderWithMath(text: string, inline: boolean): string {
    if (!text.includes('$') && !text.includes('`')) {
      return inline ? renderFlowTextInner(text) : renderPlainBlockInner(text);
    }
    return splitMathSegments(text)
      .map((seg) => {
        if (seg.type === 'math') return renderKatexHtml(seg.tex, seg.display);
        return inline ? renderFlowTextInner(seg.value) : renderPlainBlockInner(seg.value);
      })
      .join('');
  }

  function renderPlainBlock(text: string): string {
    return renderWithMath(text, false);
  }

  function renderFlowText(text: string): string {
    return renderWithMath(text, true);
  }

  const bodyBlocks = $derived(coalescePlainMentionFlows(segments));

  function flowHasMention(block: PlainBodyBlock): boolean {
    return block.type === 'flow' && block.parts.some((p) => p.type === 'mention');
  }

  function splitPayments(text: string): Array<{ type: 'text' | 'ln' | 'xmr'; value: string }> {
    const hits: Array<{ index: number; end: number; type: 'ln' | 'xmr'; value: string }> = [];
    for (const re of [
      { re: LNBC, type: 'ln' as const },
      { re: XMR, type: 'xmr' as const }
    ]) {
      re.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.re.exec(text))) {
        hits.push({
          index: m.index,
          end: m.index + m[0].length,
          type: re.type,
          value: m[1] ?? m[0]
        });
      }
    }
    hits.sort((a, b) => a.index - b.index);
    const out: Array<{ type: 'text' | 'ln' | 'xmr'; value: string }> = [];
    let last = 0;
    for (const hit of hits) {
      if (hit.index < last) continue;
      if (hit.index > last) out.push({ type: 'text', value: text.slice(last, hit.index) });
      out.push({ type: hit.type, value: hit.value });
      last = hit.end;
    }
    if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
    if (!out.length) out.push({ type: 'text', value: text });
    return out;
  }

  $effect(() => {
    void content;
    expanded = false;
    truncated = false;
  });

  $effect(() => {
    const el = rootEl;
    const lines = maxLines;
    void content;
    void segments;
    void emojiSlots;
    void resolved;
    void bodyBlocks;
    if (!el || lines == null || expanded) return;
    let cancelled = false;
    let raf2 = 0;
    const measure = () => {
      if (cancelled) return;
      // Only meaningful while clamped — overflow means the line clamp is hiding text.
      truncated = el.scrollHeight > el.clientHeight + 1;
    };
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(measure);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  });

  $effect(() => {
    const src = content;
    const ev = event;
    const gen = ++generation;
    let cancelled = false;
    void (async () => {
      const { text: emojiReady, slots } = await prepareContentWithEmojis(src, ev ?? undefined);
      if (cancelled || gen !== generation) return;
      // Keep private-use placeholders through escape/linkify; expand to <img> at paint time.
      const segs = splitNostrRefs(emojiReady);
      segments = segs;
      emojiSlots = slots;
      const found: Record<number, Event | null> = {};
      if (showEmbeds) {
        await Promise.all(
          segs.map(async (seg, i) => {
            if (seg.type !== 'ref') return;
            const cacheKey =
              seg.kind === 'naddr' && seg.naddr
                ? `a:${seg.naddr.kind}:${seg.naddr.pubkey}:${seg.naddr.identifier}`
                : seg.id
                  ? `e:${seg.id}`
                  : '';
            if (cacheKey) {
              const cached = lruGet<Event>(cacheKey);
              if (cached) {
                found[i] = cached;
                return;
              }
            }
            let hit: Event | null = null;
            if (seg.kind === 'naddr' && seg.naddr) {
              hit = await fetchByAddress(
                `${seg.naddr.kind}:${seg.naddr.pubkey}:${seg.naddr.identifier}`,
                { hintRelays: seg.naddr.relays }
              );
            } else if (seg.id) {
              hit = await fetchById(seg.id, {
                hintRelays: seg.relays,
                authorPubkey: seg.pubkey
              });
            }
            found[i] = hit;
            if (hit && cacheKey) lruSet(cacheKey, hit);
          })
        );
      }
      if (cancelled || gen !== generation) return;
      resolved = found;
    })();
    return () => {
      cancelled = true;
    };
  });
</script>

{#snippet richTextChunk(text: string, inline: boolean)}
  {#each splitPayments(text) as pay}
    {#if pay.type === 'ln'}
      <div class="nrt-pay" data-kind="lightning">
        <code>{pay.value.slice(0, 24)}…</code>
        <span class="muted">Lightning invoice</span>
      </div>
    {:else if pay.type === 'xmr'}
      <div class="nrt-pay" data-kind="monero">
        <code>{pay.value.slice(0, 16)}…</code>
        <span class="muted">Monero address</span>
      </div>
    {:else}
      {#each splitLinkEmbeds(pay.value) as bit}
        {#if bit.type === 'youtube'}
          <YouTubeEmbed url={bit.value} />
        {:else if bit.type === 'url-event'}
          <ExpandableUrlEventLink url={bit.value} />
        {:else if bit.type === 'og'}
          <OgLinkPreviewCard url={bit.value} />
        {:else if inline ? bit.value.length > 0 : bit.value.trim()}
          {@html expandCustomEmojiPlaceholders(
            inline ? renderFlowText(bit.value) : renderPlainBlock(bit.value),
            emojiSlots
          )}
        {/if}
      {/each}
    {/if}
  {/each}
{/snippet}

<div
  bind:this={rootEl}
  class="nostr-rich-text"
  class:clamped={maxLines != null && !expanded}
  style={maxLines != null && !expanded ? `--nrt-max-lines: ${maxLines}` : undefined}
>
  {#each bodyBlocks as block}
    {#if block.type === 'flow'}
      {#if flowHasMention(block)}
        <div class="nrt-flow">
          {#each block.parts as part}
            {#if part.type === 'mention'}
              <span class="nrt-mention"><UserBadge pubkey={part.pubkey} compact /></span>
            {:else}
              {@render richTextChunk(part.text, true)}
            {/if}
          {/each}
        </div>
      {:else}
        {#each block.parts as part}
          {#if part.type === 'text'}
            {@render richTextChunk(part.text, false)}
          {/if}
        {/each}
      {/if}
    {:else}
      {@const seg = segments[block.index]}
      {@const i = block.index}
      {#if seg?.type === 'ref' && (seg.kind === 'npub' || seg.kind === 'nprofile')}
        {#if seg.pubkey}
          <span class="nrt-mention"><UserBadge pubkey={seg.pubkey} compact /></span>
        {:else}
          <code>{seg.raw}</code>
        {/if}
      {:else if seg?.type === 'ref' && showEmbeds && resolved[i]}
        <div class="nrt-embed" class:nrt-embed-card={useRichEmbedCard(resolved[i]!)}>
          {#if useRichEmbedCard(resolved[i]!)}
            {#await import('./EventCard.svelte') then mod}
              <mod.default event={resolved[i]!} embedDepth={1} asCard />
            {/await}
          {:else}
            <EmbedEventLine event={resolved[i]!} />
          {/if}
        </div>
      {:else if seg?.type === 'ref' && showEmbeds && resolved[i] === null}
        {@const bookmarkFallback = missingBookmarkUrl(seg)}
        {#if bookmarkFallback}
          <div class="nrt-embed nrt-embed-card">
            <WebBookmarkEmbed url={bookmarkFallback} />
          </div>
        {:else}
          <p class="muted">This item could not be found.</p>
        {/if}
      {:else if seg?.type === 'ref' && showEmbeds}
        <p class="muted">Opening…</p>
      {:else if seg?.type === 'ref' && seg.bech32}
        <a href={`#/feed?thread=${seg.bech32}`}>{seg.raw}</a>
      {:else if seg?.type === 'ref'}
        <code>{seg.raw}</code>
      {/if}
    {/if}
  {/each}
  {#if maxLines != null && (truncated || expanded)}
    <button type="button" class="nrt-expand" onclick={() => (expanded = !expanded)}>
      {expanded ? 'Show less' : 'Show more'}
    </button>
  {/if}
</div>

<style>
  .nostr-rich-text.clamped {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: var(--nrt-max-lines, 6);
    line-clamp: var(--nrt-max-lines, 6);
    overflow: hidden;
  }
  .nrt-flow {
    word-break: break-word;
  }
  :global(.nrt-line),
  :global(.nrt-phrase) {
    white-space: pre-wrap;
    word-break: break-word;
  }
  :global(.nrt-greentext) {
    color: #2a8f2a;
    white-space: pre-wrap;
  }
  :global(.nrt-quote) {
    margin: 0.25rem 0;
    padding-left: 0.75rem;
    border-left: 3px solid color-mix(in srgb, currentColor 25%, transparent);
    color: color-mix(in srgb, currentColor 75%, transparent);
  }
  .nrt-flow :global(.nrt-quote) {
    margin: 0;
  }
  .nrt-mention {
    display: inline-flex;
    vertical-align: baseline;
  }
  .nrt-embed-card {
    margin: 0.35rem 0 0.5rem;
  }
  .nrt-embed {
    margin: 0.35rem 0 0.5rem;
  }
  .nrt-pay {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    padding: 0.5rem 0.75rem;
    margin: 0.35rem 0;
    border: 1px solid color-mix(in srgb, currentColor 15%, transparent);
    border-radius: 6px;
    font-size: 0.9rem;
  }
  .nrt-expand {
    margin-top: 0.35rem;
    background: none;
    border: none;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
    opacity: 0.8;
  }
  .muted {
    opacity: 0.7;
  }
  :global(.nrt-line a),
  :global(.nrt-quote a),
  :global(.nrt-greentext a) {
    color: inherit;
    text-decoration: underline;
  }
</style>
