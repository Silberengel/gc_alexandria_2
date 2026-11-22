<script lang="ts">
  import {
    fetchAuthorEmojiInfos,
    unicodeEmojiCatalog,
    type EmojiInfo,
    type UnicodeEmojiEntry
  } from '$lib/emoji-compose';
  import { session } from '$lib/stores/session';

  export type EmojiPick =
    | { kind: 'unicode'; shortcode: string; emoji: string }
    | { kind: 'custom'; shortcode: string; url: string };

  interface Props {
    open?: boolean;
    onClose?: () => void;
    onPick: (pick: EmojiPick) => void;
  }

  let { open = $bindable(false), onClose, onPick }: Props = $props();

  let query = $state('');
  let custom = $state<EmojiInfo[]>([]);
  let loadingCustom = $state(false);
  let tab = $state<'custom' | 'unicode'>('custom');

  const unicode = $derived(unicodeEmojiCatalog());
  const q = $derived(query.trim().toLowerCase());

  const filteredCustom = $derived.by(() => {
    if (!q) return custom;
    return custom.filter((e) => e.shortcode.toLowerCase().includes(q));
  });

  const filteredUnicode = $derived.by(() => {
    const list = unicode;
    if (!q) return list.slice(0, 180);
    return list.filter((e) => e.shortcode.includes(q) || e.name.toLowerCase().includes(q)).slice(0, 180);
  });

  async function loadCustom(): Promise<void> {
    const pk = $session.pubkey;
    if (!pk) {
      custom = [];
      return;
    }
    loadingCustom = true;
    try {
      custom = await fetchAuthorEmojiInfos(pk);
      if (custom.length) tab = 'custom';
      else tab = 'unicode';
    } finally {
      loadingCustom = false;
    }
  }

  function close(): void {
    open = false;
    onClose?.();
  }

  function onBackdrop(e: MouseEvent): void {
    if (e.target === e.currentTarget) close();
  }

  function pickUnicode(entry: UnicodeEmojiEntry): void {
    onPick({ kind: 'unicode', shortcode: entry.shortcode, emoji: entry.emoji });
    close();
  }

  function pickCustom(info: EmojiInfo): void {
    onPick({ kind: 'custom', shortcode: info.shortcode, url: info.url });
    close();
  }

  $effect(() => {
    if (!open) return;
    query = '';
    void loadCustom();
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
      class="login-dialog card emoji-picker"
      role="dialog"
      aria-modal="true"
      aria-label="Emoji picker"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <header class="emoji-picker-head">
        <h2>Emoji</h2>
        <button class="btn" type="button" onclick={close}>Close</button>
      </header>
      <input
        class="emoji-picker-search"
        type="search"
        placeholder="Search shortcodes…"
        bind:value={query}
        aria-label="Search emoji"
      />
      <div class="emoji-picker-tabs" role="tablist">
        <button
          type="button"
          class="btn"
          class:active={tab === 'custom'}
          role="tab"
          aria-selected={tab === 'custom'}
          onclick={() => (tab = 'custom')}
          >Custom</button
        >
        <button
          type="button"
          class="btn"
          class:active={tab === 'unicode'}
          role="tab"
          aria-selected={tab === 'unicode'}
          onclick={() => (tab = 'unicode')}
          >Standard</button
        >
      </div>
      <div class="emoji-picker-grid" role="listbox" aria-label="Emoji list">
        {#if tab === 'custom'}
          {#if loadingCustom}
            <p class="muted emoji-picker-empty">Loading packs…</p>
          {:else if !filteredCustom.length}
            <p class="muted emoji-picker-empty">
              {$session.pubkey
                ? 'No custom emoji in your packs yet.'
                : 'Sign in to load your emoji packs.'}
            </p>
          {:else}
            {#each filteredCustom as info (info.shortcode)}
              <button
                type="button"
                class="emoji-picker-cell"
                title={`:${info.shortcode}:`}
                onclick={() => pickCustom(info)}
              >
                <img src={info.url} alt={info.shortcode} loading="lazy" />
                <span>:{info.shortcode}:</span>
              </button>
            {/each}
          {/if}
        {:else if !filteredUnicode.length}
          <p class="muted emoji-picker-empty">No matches.</p>
        {:else}
          {#each filteredUnicode as entry (entry.shortcode)}
            <button
              type="button"
              class="emoji-picker-cell"
              title={`:${entry.shortcode}:`}
              onclick={() => pickUnicode(entry)}
            >
              <span class="emoji-picker-glyph" aria-hidden="true">{entry.emoji}</span>
              <span>:{entry.shortcode}:</span>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .emoji-picker {
    width: min(28rem, 94vw);
    max-height: min(32rem, 88vh);
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    padding: 0.85rem 1rem 1rem;
  }
  .emoji-picker-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .emoji-picker-head h2 {
    margin: 0;
    font-size: 1.05rem;
  }
  .emoji-picker-search {
    width: 100%;
    box-sizing: border-box;
    padding: 0.4rem 0.55rem;
  }
  .emoji-picker-tabs {
    display: flex;
    gap: 0.35rem;
  }
  .emoji-picker-tabs .btn.active {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--rule));
  }
  .emoji-picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr));
    gap: 0.35rem;
    overflow: auto;
    min-height: 10rem;
    max-height: 20rem;
    padding: 0.15rem;
  }
  .emoji-picker-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.4rem 0.25rem;
    border: 1px solid color-mix(in srgb, var(--rule) 70%, transparent);
    border-radius: 0.35rem;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 0.68rem;
    line-height: 1.2;
    word-break: break-all;
  }
  .emoji-picker-cell:hover {
    border-color: color-mix(in srgb, var(--accent) 50%, var(--rule));
  }
  .emoji-picker-cell img {
    width: 1.75rem;
    height: 1.75rem;
    object-fit: contain;
  }
  .emoji-picker-glyph {
    font-size: 1.55rem;
    line-height: 1;
  }
  .emoji-picker-empty {
    grid-column: 1 / -1;
    margin: 0.75rem 0;
    text-align: center;
  }
</style>
