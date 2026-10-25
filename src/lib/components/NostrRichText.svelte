<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { prepareLines, tokenizeInline } from '$lib/plaintext-markup';
  import { splitNostrRefs, type ContentSegment } from '$lib/nostr-refs';
  import {
    expandCustomEmojiPlaceholders,
    prepareContentWithEmojis,
    type EmojiInfo
  } from '$lib/emoji-content';
  import { KIND } from '$lib/constants';
  import { isAllowedHref } from '$lib/markup';
  import UserBadge from './UserBadge.svelte';
  import EmbedEventLine from './EmbedEventLine.svelte';
  import { fetchByAddress, fetchById } from '$lib/nostr/fetch';
  import { lruGet, lruSet } from '$lib/compose-lru';

  /** Kinds that need a full card (player, gallery, …) instead of a one-line blurb. */
  function useRichEmbedCard(event: Event): boolean {
    return (
      event.kind === KIND.LIVE_EVENT ||
      event.kind === KIND.VIDEO ||
      event.kind === KIND.SHORT_VIDEO ||
      event.kind === KIND.PICTURE ||
      event.kind === KIND.PUBLICATION ||
      event.kind === KIND.LONG_FORM ||
      event.kind === KIND.WIKI ||
      event.kind === KIND.SPEC
    );
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
    let s = escapeHtml(text);
    s = s.replace(URL_RE, (url) => {
      if (!isAllowedHref(url)) return url;
      return `<a href="${url}" rel="noopener noreferrer" target="_blank">${url}</a>`;
    });
    s = s.replace(HASHTAG, (_m, prefix: string, tag: string) => {
      return `${prefix}<a href="#/search?subject=${encodeURIComponent(tag)}">#${tag}</a>`;
    });
    return s;
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

  function renderPlainBlock(text: string): string {
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

<div
  class="nostr-rich-text"
  class:clamped={maxLines != null && !expanded}
  style={maxLines != null && !expanded ? `--nrt-max-lines: ${maxLines}` : undefined}
>
  {#each segments as seg, i}
    {#if seg.type === 'text'}
      {#each splitPayments(seg.text) as part}
        {#if part.type === 'ln'}
          <div class="nrt-pay" data-kind="lightning">
            <code>{part.value.slice(0, 24)}…</code>
            <span class="muted">Lightning invoice</span>
          </div>
        {:else if part.type === 'xmr'}
          <div class="nrt-pay" data-kind="monero">
            <code>{part.value.slice(0, 16)}…</code>
            <span class="muted">Monero address</span>
          </div>
        {:else}
          {@html expandCustomEmojiPlaceholders(renderPlainBlock(part.value), emojiSlots)}
        {/if}
      {/each}
    {:else if seg.kind === 'npub' || seg.kind === 'nprofile'}
      {#if seg.pubkey}
        <span class="nrt-mention"><UserBadge pubkey={seg.pubkey} compact /></span>
      {:else}
        <code>{seg.raw}</code>
      {/if}
    {:else if seg.type === 'ref' && showEmbeds && resolved[i]}
      <div class="nrt-embed" class:nrt-embed-card={useRichEmbedCard(resolved[i]!)}>
        {#if useRichEmbedCard(resolved[i]!)}
          {#await import('./EventCard.svelte') then mod}
            <mod.default event={resolved[i]!} embedDepth={1} asCard />
          {/await}
        {:else}
          <EmbedEventLine event={resolved[i]!} />
        {/if}
      </div>
    {:else if seg.type === 'ref' && showEmbeds && resolved[i] === null}
      <p class="muted">This item could not be found.</p>
    {:else if seg.type === 'ref' && showEmbeds}
      <p class="muted">Opening…</p>
    {:else if seg.type === 'ref' && seg.bech32}
      <a href={`#/feed?thread=${seg.bech32}`}>{seg.raw}</a>
    {:else if seg.type === 'ref'}
      <code>{seg.raw}</code>
    {/if}
  {/each}
  {#if maxLines != null}
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
  :global(.nrt-line) {
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
  .nrt-mention {
    display: inline-flex;
    vertical-align: baseline;
  }
  .nrt-embed-card {
    margin: 0.55rem 0;
  }
  .nrt-embed {
    margin: 0.5rem 0;
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
