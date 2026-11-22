<script lang="ts">
  import EmojiPicker, { type EmojiPick } from './EmojiPicker.svelte';
  import GifPicker from './GifPicker.svelte';
  import {
    appendImeta,
    appendMediaUrl,
    uploadComposeMedia
  } from '$lib/compose-media-insert';
  import { emojiTagRow, insertEmojiShortcode } from '$lib/emoji-compose';
  import { imetaFromGifItem, type GifPickerItem } from '$lib/gif-picker';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { session } from '$lib/stores/session';
  import { showNotice } from '$lib/stores/toast';
  import type { Snippet } from 'svelte';

  interface Props {
    disabled?: boolean;
    /** When false, hide the file upload control (caller already has one). */
    showUpload?: boolean;
    /** When false, hide emoji / GIF (e.g. kind 0 picture-only). */
    showEmoji?: boolean;
    showGif?: boolean;
    accept?: string;
    uploading?: boolean;
    onInsertText?: (text: string) => void;
    onSetContent?: (updater: (prev: string) => string) => void;
    onAddImeta?: (tag: string[]) => void;
    onAddEmojiTag?: (tag: string[]) => void;
    /** Full control when parent binds content + imeta + emoji tags. */
    content?: string;
    imetaTags?: string[][];
    emojiTags?: string[][];
    leading?: Snippet;
    trailing?: Snippet;
  }

  let {
    disabled = false,
    showUpload = true,
    showEmoji = true,
    showGif = true,
    accept = 'image/*,video/*,audio/*',
    uploading = $bindable(false),
    onInsertText,
    onSetContent,
    onAddImeta,
    onAddEmojiTag,
    content = $bindable<string | undefined>(undefined),
    imetaTags = $bindable<string[][] | undefined>(undefined),
    emojiTags = $bindable<string[][] | undefined>(undefined),
    leading,
    trailing
  }: Props = $props();

  let emojiOpen = $state(false);
  let gifOpen = $state(false);
  let localUploading = $state(false);

  const busy = $derived(disabled || uploading || localUploading);

  function mutateContent(updater: (prev: string) => string): void {
    if (content !== undefined) {
      content = updater(content);
      return;
    }
    if (onSetContent) {
      onSetContent(updater);
      return;
    }
    // Fallback: only know the inserted fragment.
  }

  function insertText(text: string): void {
    if (content !== undefined || onSetContent) {
      mutateContent((prev) => {
        if (!text) return prev;
        // Shortcodes: insertEmojiShortcode; media URLs: appendMediaUrl.
        if (text.startsWith(':') && text.endsWith(':') && text.length > 2) {
          return insertEmojiShortcode(prev, text.slice(1, -1));
        }
        return appendMediaUrl(prev, text);
      });
      return;
    }
    onInsertText?.(text);
  }

  function addImeta(tag: string[]): void {
    if (imetaTags !== undefined) {
      imetaTags = appendImeta(imetaTags, tag);
      return;
    }
    onAddImeta?.(tag);
  }

  function addEmojiTag(tag: string[]): void {
    if (emojiTags !== undefined) {
      const code = (tag[1] ?? '').trim().toLowerCase();
      const next = emojiTags.filter((row) => (row[1] ?? '').trim().toLowerCase() !== code);
      emojiTags = [...next, [...tag]];
      return;
    }
    onAddEmojiTag?.(tag);
  }

  function onEmojiPick(pick: EmojiPick): void {
    insertText(`:${pick.shortcode}:`);
    if (pick.kind === 'custom') {
      addEmojiTag(emojiTagRow({ shortcode: pick.shortcode, url: pick.url }));
    }
  }

  function onGifPick(item: GifPickerItem): void {
    insertText(item.url);
    addImeta(imetaFromGifItem(item));
  }

  async function onFilePicked(ev: Event & { currentTarget: HTMLInputElement }): Promise<void> {
    const file = ev.currentTarget.files?.[0];
    ev.currentTarget.value = '';
    if (!file) return;
    if (!$session.pubkey) {
      openLoginDialog();
      showNotice('Sign in to upload.');
      return;
    }
    localUploading = true;
    uploading = true;
    try {
      const uploaded = await uploadComposeMedia({ file, pubkey: $session.pubkey });
      insertText(uploaded.url);
      addImeta(uploaded.imeta);
      try {
        const host = new URL(uploaded.server).host;
        showNotice(`Uploaded to ${host}.`, true);
      } catch {
        showNotice('Uploaded.', true);
      }
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      localUploading = false;
      uploading = false;
    }
  }
</script>

<div class="compose-media-toolbar">
  {#if leading}
    {@render leading()}
  {/if}
  {#if showEmoji}
    <button
      class="btn btn-icon compose-media-btn"
      type="button"
      title="Emoji"
      aria-label="Emoji"
      disabled={busy}
      onclick={() => (emojiOpen = true)}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"
        />
        <path
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          d="M8.5 10.5h.01M15.5 10.5h.01M8.2 14.2c1.1 1.2 2.4 1.8 3.8 1.8s2.7-.6 3.8-1.8"
        />
      </svg>
    </button>
  {/if}
  {#if showGif}
    <button
      class="btn btn-icon compose-media-btn"
      type="button"
      title="GIF"
      aria-label="GIF"
      disabled={busy}
      onclick={() => (gifOpen = true)}
    >
      <span class="compose-media-gif-label">GIF</span>
    </button>
  {/if}
  {#if showUpload}
    <label
      class="btn btn-icon compose-media-btn compose-upload-btn"
      class:is-busy={localUploading || uploading}
      title={localUploading || uploading ? 'Uploading…' : 'Upload'}
      aria-label={localUploading || uploading ? 'Uploading…' : 'Upload'}
    >
      {#if localUploading || uploading}
        <span class="jump-busy-spinner" aria-hidden="true"></span>
      {:else}
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M12 15V4m0 0L8 8m4-4 4 4M5 16.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1.5"
          />
        </svg>
      {/if}
      <input
        type="file"
        {accept}
        hidden
        disabled={busy}
        onchange={(e) => void onFilePicked(e)}
      />
    </label>
  {/if}
  {#if trailing}
    {@render trailing()}
  {/if}
</div>

{#if showEmoji}
  <EmojiPicker bind:open={emojiOpen} onPick={onEmojiPick} />
{/if}
{#if showGif}
  <GifPicker bind:open={gifOpen} onPick={onGifPick} />
{/if}

<style>
  .compose-media-toolbar {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    flex-wrap: wrap;
  }
  .compose-media-btn {
    position: relative;
    min-width: 2.15rem;
    min-height: 2.15rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .compose-media-gif-label {
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .compose-upload-btn.is-busy {
    opacity: 0.75;
  }
</style>
