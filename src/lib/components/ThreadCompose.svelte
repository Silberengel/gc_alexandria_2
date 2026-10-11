<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { KIND } from '$lib/constants';
  import {
    expandCustomEmojiPlaceholders,
    prepareContentWithEmojis
  } from '$lib/emoji-content';
  import { renderWithFallback } from '$lib/markup';
  import { session } from '$lib/stores/session';

  interface Props {
    value?: string;
    placeholder?: string;
    posting?: boolean;
    submitLabel?: string;
    offerKind1?: boolean;
    asKind1Reply?: boolean;
    onSubmit: () => void;
    onCancel?: () => void;
  }

  let {
    value = $bindable(''),
    placeholder = 'Write a comment',
    posting = false,
    submitLabel = 'Post',
    offerKind1 = false,
    asKind1Reply = $bindable(false),
    onSubmit,
    onCancel
  }: Props = $props();

  let showPreview = $state(false);
  let previewHtml = $state('');

  $effect(() => {
    const text = value;
    const kind = asKind1Reply ? KIND.TEXT_NOTE : KIND.COMMENT;
    const open = showPreview;
    const pubkey = $session.pubkey;
    if (!text.trim() || !open) {
      previewHtml = '';
      if (!text.trim()) showPreview = false;
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      const draft: Event | null = pubkey
        ? { id: '', pubkey, sig: '', kind, created_at: 0, tags: [], content: text }
        : null;
      void prepareContentWithEmojis(text, draft).then(async ({ text: ready, slots }) => {
        const html = expandCustomEmojiPlaceholders(await renderWithFallback(kind, ready), slots);
        if (!cancelled) previewHtml = html;
      });
    }, 160);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });
</script>

<form
  class="compose"
  onsubmit={(e) => {
    e.preventDefault();
    onSubmit();
  }}
>
  <textarea bind:value rows="3" {placeholder}></textarea>
  {#if previewHtml}
    <div class="compose-preview">
      <p class="compose-preview-label muted">Preview</p>
      <div class="event-body">{@html previewHtml}</div>
    </div>
  {/if}
  {#if offerKind1}
    <details class="compose-options">
      <summary>Options:</summary>
      <label class="compose-kind1">
        <input type="checkbox" bind:checked={asKind1Reply} />
        Post as a kind 1 reply, instead of a comment
      </label>
    </details>
  {/if}
  <div class="compose-actions">
    <button class="btn btn-primary" type="submit" disabled={posting || !value.trim()}
      >{posting ? 'Posting…' : submitLabel}</button
    >
    <button
      class="btn"
      type="button"
      disabled={!value.trim()}
      aria-pressed={showPreview}
      onclick={() => (showPreview = !showPreview)}
    >
      Preview
    </button>
    {#if onCancel}
      <button class="btn" type="button" onclick={onCancel}>Cancel</button>
    {/if}
  </div>
</form>
