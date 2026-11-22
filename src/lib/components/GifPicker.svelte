<script lang="ts">
  import {
    buildReactionClipDraft,
    GIF_RELAY_URLS,
    loadReactionClips,
    REACTION_CLIP_DEFAULT_EMOTION,
    REACTION_CLIP_EMOTIONS,
    type GifPickerItem
  } from '$lib/gif-picker';
  import { uploadComposeMedia } from '$lib/compose-media-insert';
  import { followPubkeysFromMetadata } from '$lib/mute';
  import { rememberEvents } from '$lib/nostr/event-memory';
  import { relayPool } from '$lib/nostr/pool';
  import { signUnsigned } from '$lib/sign';
  import { session } from '$lib/stores/session';
  import { showNotice } from '$lib/stores/toast';

  interface Props {
    open?: boolean;
    onClose?: () => void;
    onPick: (item: GifPickerItem) => void;
  }

  let { open = $bindable(false), onClose, onPick }: Props = $props();

  let tab = $state<'find' | 'import'>('find');
  let items = $state<GifPickerItem[]>([]);
  let loading = $state(false);
  let error = $state('');
  let importUrl = $state('');
  let importDesc = $state('');
  let emotions = $state<string[]>([REACTION_CLIP_DEFAULT_EMOTION]);
  let importing = $state(false);

  function close(): void {
    open = false;
    onClose?.();
  }

  function onBackdrop(e: MouseEvent): void {
    if (e.target === e.currentTarget) close();
  }

  async function loadFind(): Promise<void> {
    loading = true;
    error = '';
    try {
      const follows = [...followPubkeysFromMetadata(session.getMetadata())];
      items = await loadReactionClips({
        viewerPubkey: $session.pubkey,
        followPubkeys: follows
      });
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not load GIFs.';
      items = [];
    } finally {
      loading = false;
    }
  }

  function toggleEmotion(emotion: string): void {
    const has = emotions.includes(emotion);
    if (has) {
      emotions = emotions.filter((e) => e !== emotion);
      if (!emotions.length) emotions = [REACTION_CLIP_DEFAULT_EMOTION];
      return;
    }
    if (emotions.length >= 6) return;
    emotions = [...emotions, emotion];
  }

  function pickFind(item: GifPickerItem): void {
    onPick(item);
    close();
  }

  async function publishIndexBestEffort(item: GifPickerItem): Promise<void> {
    if (!item.sha256 || item.sourceKind === 1090) return;
    const draft = buildReactionClipDraft({
      url: item.url,
      sha256: item.sha256,
      description: item.description,
      mimeType: item.mimeType,
      dim: item.dim,
      size: item.size,
      emotions
    });
    if (!draft) return;
    try {
      const signed = await signUnsigned(draft);
      if (!signed) return;
      rememberEvents([signed]);
      void relayPool.publish([...GIF_RELAY_URLS], signed, { bypassConstrain: true });
    } catch {
      /* best-effort */
    }
  }

  async function importFromUrl(): Promise<void> {
    const url = importUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      error = 'Enter an http(s) GIF URL.';
      return;
    }
    importing = true;
    error = '';
    try {
      const item: GifPickerItem = {
        url,
        description: importDesc.trim() || undefined,
        mimeType: 'image/gif',
        sourceKind: 0,
        eventId: '',
        pubkey: $session.pubkey?.toLowerCase() ?? '',
        createdAt: Math.floor(Date.now() / 1000)
      };
      onPick(item);
      void publishIndexBestEffort(item);
      close();
    } finally {
      importing = false;
    }
  }

  async function importFromFile(file: File | undefined): Promise<void> {
    if (!file) return;
    if (!$session.pubkey) {
      error = 'Sign in to upload.';
      return;
    }
    importing = true;
    error = '';
    try {
      const uploaded = await uploadComposeMedia({ file, pubkey: $session.pubkey });
      const item: GifPickerItem = {
        url: uploaded.url,
        description: importDesc.trim() || file.name,
        sha256: uploaded.sha256,
        mimeType: uploaded.mime || file.type || 'image/gif',
        sourceKind: 0,
        eventId: '',
        pubkey: $session.pubkey.toLowerCase(),
        createdAt: Math.floor(Date.now() / 1000)
      };
      // Prefer full imeta from upload when caller builds from item fields.
      const tag = uploaded.imeta;
      void tag;
      onPick(item);
      void publishIndexBestEffort(item);
      showNotice('GIF uploaded.', true);
      close();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Upload failed.';
    } finally {
      importing = false;
    }
  }

  $effect(() => {
    if (!open) return;
    tab = 'find';
    error = '';
    importUrl = '';
    importDesc = '';
    emotions = [REACTION_CLIP_DEFAULT_EMOTION];
    void loadFind();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

{#if open}
  <div class="login-overlay" role="presentation" onclick={onBackdrop}>
    <div
      class="login-dialog card gif-picker"
      role="dialog"
      aria-modal="true"
      aria-label="GIF picker"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <header class="gif-picker-head">
        <h2>GIFs</h2>
        <button class="btn" type="button" onclick={close}>Close</button>
      </header>
      <div class="gif-picker-tabs" role="tablist">
        <button
          type="button"
          class="btn"
          class:active={tab === 'find'}
          role="tab"
          aria-selected={tab === 'find'}
          onclick={() => {
            tab = 'find';
            void loadFind();
          }}>Find</button
        >
        <button
          type="button"
          class="btn"
          class:active={tab === 'import'}
          role="tab"
          aria-selected={tab === 'import'}
          onclick={() => (tab = 'import')}>Import</button
        >
      </div>

      {#if error}
        <p class="gif-picker-error">{error}</p>
      {/if}

      {#if tab === 'find'}
        <div class="gif-picker-grid">
          {#if loading}
            <p class="muted gif-picker-empty">Searching reaction clips…</p>
          {:else if !items.length}
            <p class="muted gif-picker-empty">No kind 1090 clips found on GIF relays.</p>
          {:else}
            {#each items as item (item.eventId || item.url)}
              <button
                type="button"
                class="gif-picker-cell"
                title={item.description || item.url}
                onclick={() => pickFind(item)}
              >
                <img src={item.url} alt={item.description || 'GIF'} loading="lazy" />
              </button>
            {/each}
          {/if}
        </div>
      {:else}
        <div class="gif-picker-import">
          <label>
            <span>Description</span>
            <input type="text" bind:value={importDesc} placeholder="Optional caption / topics" />
          </label>
          <label>
            <span>Emotions</span>
            <div class="gif-emotion-chips">
              {#each REACTION_CLIP_EMOTIONS as emotion}
                <button
                  type="button"
                  class="btn gif-emotion"
                  class:active={emotions.includes(emotion)}
                  onclick={() => toggleEmotion(emotion)}>{emotion}</button
                >
              {/each}
            </div>
          </label>
          <label>
            <span>Hosted URL</span>
            <div class="gif-import-row">
              <input type="url" bind:value={importUrl} placeholder="https://…" disabled={importing} />
              <button
                class="btn btn-primary"
                type="button"
                disabled={importing || !importUrl.trim()}
                onclick={() => void importFromUrl()}>Insert</button
              >
            </div>
          </label>
          <label class="btn gif-file-btn">
            {importing ? 'Uploading…' : 'Upload file'}
            <input
              type="file"
              accept="image/gif,image/webp,video/mp4,image/*"
              hidden
              disabled={importing}
              onchange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = '';
                void importFromFile(file);
              }}
            />
          </label>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .gif-picker {
    width: min(36rem, 96vw);
    max-height: min(36rem, 90vh);
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    padding: 0.85rem 1rem 1rem;
  }
  .gif-picker-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .gif-picker-head h2 {
    margin: 0;
    font-size: 1.05rem;
  }
  .gif-picker-tabs {
    display: flex;
    gap: 0.35rem;
  }
  .gif-picker-tabs .btn.active,
  .gif-emotion.active {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--rule));
  }
  .gif-picker-error {
    margin: 0;
    color: color-mix(in srgb, #b42318 80%, var(--ink));
    font-size: 0.85rem;
  }
  .gif-picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
    grid-auto-rows: 7rem;
    align-content: start;
    gap: 0.45rem;
    overflow: auto;
    flex: 1 1 auto;
    min-height: 12rem;
    max-height: 24rem;
  }
  .gif-picker-cell {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 7rem;
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--rule) 70%, transparent);
    border-radius: 0.35rem;
    overflow: hidden;
    background: color-mix(in srgb, var(--panel, #fff) 92%, #000);
    cursor: pointer;
  }
  .gif-picker-cell img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .gif-picker-empty {
    grid-column: 1 / -1;
    text-align: center;
    margin: 1rem 0;
  }
  .gif-picker-import {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .gif-picker-import label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.88rem;
  }
  .gif-picker-import input[type='text'],
  .gif-picker-import input[type='url'] {
    padding: 0.4rem 0.55rem;
  }
  .gif-import-row {
    display: flex;
    gap: 0.4rem;
  }
  .gif-import-row input {
    flex: 1 1 auto;
    min-width: 0;
  }
  .gif-emotion-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .gif-emotion {
    font-size: 0.78rem;
    padding: 0.2rem 0.45rem;
  }
  .gif-file-btn {
    align-self: flex-start;
    cursor: pointer;
  }
</style>
