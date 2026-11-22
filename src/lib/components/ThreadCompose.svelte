<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { scrubClipboardTextPaste, scrubProseText } from '$lib/clean-url';
  import {
    deleteThreadDraft,
    loadThreadDraft,
    saveThreadDraft
  } from '$lib/comment-drafts';
  import { KIND } from '$lib/constants';
  import { emojiTagsForContent, mergeEmojiTagRows } from '$lib/emoji-compose';
  import { session } from '$lib/stores/session';
  import { showNotice } from '$lib/stores/toast';
  import ComposeMediaToolbar from './ComposeMediaToolbar.svelte';
  import DrawingEditor from './DrawingEditor.svelte';
  import EventBody from './EventBody.svelte';
  import ProseGrammarField from './ProseGrammarField.svelte';

  interface Props {
    value?: string;
    /** NIP-92 imeta rows for drawings / media attached to this draft. */
    imetaTags?: string[][];
    /** NIP-30 custom emoji tags for shortcodes in the draft. */
    emojiTags?: string[][];
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
    emojiTags = $bindable<string[][]>([]),
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
  let drawOpen = $state(false);
  let mediaUploading = $state(false);
  let hydratedScope = $state('');
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const drawDraftScope = $derived(draftScope ? `draw:${draftScope}` : '');
  /** Same EventBody path as Compose preview — expands nostr: refs, media, embeds. */
  const previewEvent = $derived.by((): Event | null => {
    if (!showPreview || !value.trim()) return null;
    const pubkey = $session.pubkey || '0'.repeat(64);
    return {
      id: '',
      pubkey,
      sig: '',
      kind: asKind1Reply ? KIND.TEXT_NOTE : KIND.COMMENT,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ...imetaTags.map((row) => [...row]),
        ...mergeEmojiTagRows(emojiTags, emojiTagsForContent(value, [], emojiTags))
      ],
      content: value
    };
  });

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
      emojiTags,
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
    const scrubbed = scrubProseText(value);
    if (scrubbed !== value) value = scrubbed;
    emojiTags = mergeEmojiTagRows(emojiTags, emojiTagsForContent(value, [], emojiTags));
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
    if (!value.trim() && !imetaTags.length && !emojiTags.length) {
      value = saved.text;
      imetaTags = saved.imetaTags.map((row) => [...row]);
      emojiTags = (saved.emojiTags ?? []).map((row) => [...row]);
      asKind1Reply = saved.asKind1Reply;
    } else {
      if (!imetaTags.length && saved.imetaTags.length) {
        imetaTags = saved.imetaTags.map((row) => [...row]);
      }
      if (!emojiTags.length && saved.emojiTags?.length) {
        emojiTags = saved.emojiTags.map((row) => [...row]);
      }
    }
  });

  $effect(() => {
    void value;
    void imetaTags;
    void emojiTags;
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
    if (!value.trim() && showPreview) showPreview = false;
  });
</script>

<form
  class="compose"
  onsubmit={(e) => {
    e.preventDefault();
    void submit();
  }}
>
  <ProseGrammarField rows={3} bind:value {placeholder} onPaste={onPaste} />
  {#if previewEvent}
    <div class="compose-preview">
      <p class="compose-preview-label muted">Preview</p>
      <EventBody event={previewEvent} showEmbeds />
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
      class="btn btn-icon"
      type="button"
      title="Draw"
      aria-label="Draw"
      disabled={posting || mediaUploading}
      onclick={() => (drawOpen = true)}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M9.06 11.9 4 17.94V20h2.06l6.06-5.06"
        />
        <path
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M17.94 5.94a1.5 1.5 0 0 0-2.12 0L9.06 12.7l2.12 2.12 6.76-6.76a1.5 1.5 0 0 0 0-2.12Z"
        />
      </svg>
    </button>
    <ComposeMediaToolbar
      disabled={posting}
      bind:uploading={mediaUploading}
      bind:content={value}
      bind:imetaTags
      bind:emojiTags
    />
    <button
      class="btn btn-primary"
      type="submit"
      disabled={posting || mediaUploading || !value.trim()}
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
