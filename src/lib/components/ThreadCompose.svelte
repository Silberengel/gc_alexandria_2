<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { scrubClipboardTextPaste, scrubTrackingUrlsInText } from '$lib/clean-url';
  import {
    deleteThreadDraft,
    loadThreadDraft,
    saveThreadDraft
  } from '$lib/comment-drafts';
  import { KIND } from '$lib/constants';
  import {
    expandCustomEmojiPlaceholders,
    prepareContentWithEmojis
  } from '$lib/emoji-content';
  import { renderWithFallback } from '$lib/markup';
  import { session } from '$lib/stores/session';
  import { showNotice } from '$lib/stores/toast';
  import DrawingEditor from './DrawingEditor.svelte';
  import MentionControl from './MentionControl.svelte';

  interface Props {
    value?: string;
    /** NIP-92 imeta rows for drawings attached to this draft. */
    imetaTags?: string[][];
    placeholder?: string;
    posting?: boolean;
    submitLabel?: string;
    offerKind1?: boolean;
    asKind1Reply?: boolean;
    /**
     * Autosave key within the signed-in pubkey (e.g. `comment:<eventId>`).
     * When set, text + drawings restore after navigation / refresh.
     */
    draftScope?: string;
    onSubmit: () => void | boolean | Promise<void | boolean>;
    onCancel?: () => void;
  }

  let {
    value = $bindable(''),
    imetaTags = $bindable<string[][]>([]),
    placeholder = 'Write a comment',
    posting = false,
    submitLabel = 'Post',
    offerKind1 = false,
    asKind1Reply = $bindable(false),
    draftScope = '',
    onSubmit,
    onCancel
  }: Props = $props();

  let showPreview = $state(false);
  let previewHtml = $state('');
  let drawOpen = $state(false);
  let hydratedScope = $state('');
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const drawDraftScope = $derived(draftScope ? `draw:${draftScope}` : '');

  function onPaste(event: ClipboardEvent): void {
    scrubClipboardTextPaste(event, (scrubbed, start, end) => {
      value = value.slice(0, start) + scrubbed + value.slice(end);
    });
  }

  function persistDraft(): void {
    const pubkey = $session.pubkey;
    if (!pubkey || !draftScope) return;
    saveThreadDraft(pubkey, draftScope, {
      text: value,
      imetaTags,
      asKind1Reply
    });
  }

  function schedulePersist(): void {
    if (!draftScope || !$session.pubkey) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persistDraft();
    }, 280);
  }

  function clearStoredDraft(): void {
    const pubkey = $session.pubkey;
    if (!pubkey || !draftScope) return;
    deleteThreadDraft(pubkey, draftScope);
  }

  async function submit(): Promise<void> {
    const scrubbed = scrubTrackingUrlsInText(value);
    if (scrubbed !== value) value = scrubbed;
    const result = await onSubmit();
    if (result === false) return;
    clearStoredDraft();
  }

  function cancel(): void {
    // Keep autosave so reopening restores text + drawings.
    persistDraft();
    drawOpen = false;
    onCancel?.();
  }

  function onDrawingComplete(result: {
    url: string;
    imeta: string[];
    alt: string;
  }): void {
    const url = result.url.trim();
    if (!url) return;
    const sep = value.trim() ? (value.endsWith('\n') ? '' : '\n') : '';
    value = `${value}${sep}${url}`;
    if (result.imeta.length) imetaTags = [...imetaTags, result.imeta];
    showNotice('Drawing attached — post when ready.', true);
    schedulePersist();
  }

  $effect(() => {
    const pubkey = $session.pubkey;
    const scope = draftScope;
    if (!pubkey || !scope) return;
    if (hydratedScope === `${pubkey}:${scope}`) return;
    hydratedScope = `${pubkey}:${scope}`;
    const saved = loadThreadDraft(pubkey, scope);
    if (!saved) return;
    // Prefer stored draft when the live fields are empty (fresh mount / navigation).
    if (!value.trim() && !imetaTags.length) {
      value = saved.text;
      imetaTags = saved.imetaTags.map((row) => [...row]);
      asKind1Reply = saved.asKind1Reply;
    } else if (!imetaTags.length && saved.imetaTags.length) {
      imetaTags = saved.imetaTags.map((row) => [...row]);
    }
  });

  $effect(() => {
    void value;
    void imetaTags;
    void asKind1Reply;
    void draftScope;
    if (!$session.pubkey || !draftScope) return;
    if (!hydratedScope) return;
    schedulePersist();
    return () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      persistDraft();
    };
  });

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
        ? {
            id: '',
            pubkey,
            sig: '',
            kind,
            created_at: 0,
            tags: imetaTags.map((row) => [...row]),
            content: text
          }
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
    void submit();
  }}
>
  <MentionControl mode="prose" multiline rows={3} bind:value {placeholder} onpaste={onPaste} />
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
    <button
      class="btn"
      type="button"
      disabled={posting}
      onclick={() => (drawOpen = true)}
      >Draw</button
    >
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
      <button class="btn" type="button" onclick={cancel}>Cancel</button>
    {/if}
  </div>
</form>
<DrawingEditor
  bind:open={drawOpen}
  draftScope={drawDraftScope}
  onComplete={onDrawingComplete}
/>
