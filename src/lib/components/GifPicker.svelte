<script lang="ts">
  import { untrack } from 'svelte';
  import {
    buildReactionClipDraft,
    GIF_RELAY_URLS,
    gifItemFromNostrBuild,
    loadReactionClips,
    REACTION_CLIP_DEFAULT_EMOTION,
    REACTION_CLIP_EMOTIONS,
    type GifPickerItem
  } from '$lib/gif-picker';
  import {
    dedupeNostrBuildGifs,
    GIFS_NOSTR_BUILD_ATTRIBUTION_URL,
    GIFS_QUERY_DEBOUNCE_MS,
    GIFS_STARTER_QUERIES,
    isValidGifsVideoUrl,
    normalizeGifQuery,
    nostrBuildGifsErrorMessage,
    previewUrlForNostrBuildGif,
    searchNostrBuildGifs,
    shouldSearchGifQuery,
    suggestNostrBuildGifs,
    tidySuggestTerms,
    type NostrBuildGif,
    type NostrBuildGifSuggestTerm
  } from '$lib/gifs-nostr-build';
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

  /** Match imwald-android: Search → Find → Import. */
  let tab = $state<'search' | 'find' | 'import'>('search');
  let items = $state<GifPickerItem[]>([]);
  let findQuery = $state('');
  let loading = $state(false);
  let error = $state('');
  let importUrl = $state('');
  let importDesc = $state('');
  let emotions = $state<string[]>([REACTION_CLIP_DEFAULT_EMOTION]);
  let importing = $state(false);
  let pickedOnce = $state(false);

  let searchQuery = $state('');
  let activeSearch = $state<string>(GIFS_STARTER_QUERIES[0]);
  let searchItems = $state<NostrBuildGif[]>([]);
  let searching = $state(false);
  let searchError = $state('');
  let searchRetryable = $state(false);
  let keepTypingHint = $state(false);
  let suggestions = $state<NostrBuildGifSuggestTerm[]>([]);
  let suggestOpen = $state(false);
  let resultAnnouncement = $state('');
  let hiddenSearchIds = $state<Set<string>>(new Set());
  let searchEpoch = $state(0);
  /** Non-reactive gate so open-reset does not re-enter on its own writes. */
  let openSessionActive = false;

  const filteredFind = $derived.by(() => {
    const q = findQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        (it.description?.toLowerCase().includes(q) ?? false) ||
        it.url.toLowerCase().includes(q)
    );
  });

  const visibleSearch = $derived(
    searchItems.filter((g) => !hiddenSearchIds.has(g.id))
  );

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

  function pickFind(item: GifPickerItem): void {
    onPick(item);
    void publishIndexBestEffort(item);
    close();
  }

  function pickSearch(gif: NostrBuildGif): void {
    if (pickedOnce) return;
    pickedOnce = true;
    const item = gifItemFromNostrBuild(gif);
    onPick(item);
    void publishIndexBestEffort(item);
    close();
  }

  function runSearch(q: string): void {
    activeSearch = q;
    searchEpoch += 1;
  }

  async function executeSearch(requested: string, epoch: number): Promise<void> {
    searching = true;
    searchError = '';
    searchRetryable = false;
    const result = await searchNostrBuildGifs(requested);
    if (epoch !== searchEpoch || activeSearch !== requested) return;
    if (result.ok) {
      const items = dedupeNostrBuildGifs(result.value.items);
      searchItems = items;
      resultAnnouncement = `${items.length} results for “${requested}”`;
    } else {
      searchItems = [];
      searchError = nostrBuildGifsErrorMessage(result.error);
      searchRetryable = result.error.kind === 'unavailable';
      resultAnnouncement = '';
    }
    searching = false;
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
    if (!open) {
      openSessionActive = false;
      return;
    }
    // Reset once per open. Never read searchEpoch here — `+=` would doom-loop.
    if (!openSessionActive) {
      openSessionActive = true;
      untrack(() => {
        tab = 'search';
        error = '';
        searchError = '';
        importUrl = '';
        importDesc = '';
        findQuery = '';
        searchQuery = '';
        emotions = [REACTION_CLIP_DEFAULT_EMOTION];
        pickedOnce = false;
        hiddenSearchIds = new Set();
        suggestions = [];
        suggestOpen = false;
        keepTypingHint = false;
        searchItems = [];
        resultAnnouncement = '';
        runSearch(GIFS_STARTER_QUERIES[0]);
      });
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  $effect(() => {
    if (!open || tab !== 'search') return;
    const epoch = searchEpoch;
    const requested = activeSearch;
    // Don't track searching/results writes from executeSearch.
    untrack(() => {
      void executeSearch(requested, epoch);
    });
  });

  $effect(() => {
    if (!open || tab !== 'search') return;
    const raw = searchQuery;
    if (!raw.trim()) {
      untrack(() => {
        suggestions = [];
        suggestOpen = false;
        keepTypingHint = false;
      });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        if (cancelled) return;
        const normalised = normalizeGifQuery(raw);
        if (normalised.length === 1 && /[a-z]/i.test(normalised)) {
          keepTypingHint = true;
          suggestOpen = false;
          return;
        }
        keepTypingHint = false;
        if (!shouldSearchGifQuery(normalised)) return;
        const suggest = await suggestNostrBuildGifs(normalised);
        if (cancelled || searchQuery !== raw) return;
        if (suggest.ok) {
          const terms = tidySuggestTerms(suggest.value, normalised);
          suggestions = terms;
          suggestOpen = terms.length > 0;
        } else {
          suggestions = [];
          suggestOpen = false;
        }
        runSearch(normalised);
      })();
    }, GIFS_QUERY_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });
</script>

{#if open}
  <div class="login-overlay gif-picker-overlay" role="presentation" onclick={onBackdrop}>
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
          class:active={tab === 'search'}
          role="tab"
          aria-selected={tab === 'search'}
          onclick={() => (tab = 'search')}>Search</button
        >
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

      {#if error && tab !== 'search'}
        <p class="gif-picker-error">{error}</p>
      {/if}

      {#if tab === 'search'}
        <div class="gif-picker-search">
          <label class="gif-search-field">
            <span class="visually-hidden">Search GIFs</span>
            <input
              type="search"
              bind:value={searchQuery}
              placeholder="Search…"
              autocomplete="off"
            />
            {#if searching}
              <span class="gif-search-busy" aria-hidden="true"></span>
            {/if}
          </label>
          <p class="muted gif-attribution">
            Powered by
            <a href={GIFS_NOSTR_BUILD_ATTRIBUTION_URL} target="_blank" rel="noopener noreferrer"
              >nostr.build</a
            >
          </p>
          <div class="gif-starter-chips" role="group" aria-label="Starter searches">
            <span class="gif-chip-spacer" aria-hidden="true"></span>
            {#each GIFS_STARTER_QUERIES as chip}
              <button
                type="button"
                class="btn gif-chip"
                class:active={activeSearch === chip && !searchQuery.trim()}
                aria-pressed={activeSearch === chip && !searchQuery.trim()}
                onclick={() => {
                  searchQuery = '';
                  keepTypingHint = false;
                  suggestOpen = false;
                  runSearch(chip);
                }}>{chip}</button
              >
            {/each}
            <span class="gif-chip-spacer" aria-hidden="true"></span>
          </div>
          {#if suggestOpen && suggestions.length}
            <ul class="gif-suggest-list">
              {#each suggestions.slice(0, 8) as term}
                <li>
                  <button
                    type="button"
                    onclick={() => {
                      searchQuery = term.term;
                      suggestOpen = false;
                    }}>{term.term}</button
                  >
                </li>
              {/each}
            </ul>
          {/if}
          {#if keepTypingHint}
            <p class="muted">Keep typing…</p>
          {/if}
          {#if resultAnnouncement}
            <p class="muted gif-result-count" aria-live="polite">{resultAnnouncement}</p>
          {/if}
          {#if searchError}
            <div class="gif-picker-error-block">
              <p class="gif-picker-error">{searchError}</p>
              {#if searchRetryable}
                <button class="btn" type="button" onclick={() => runSearch(activeSearch)}
                  >Try again</button
                >
              {/if}
            </div>
          {:else}
            <div class="gif-picker-grid">
              {#if searching && !visibleSearch.length}
                <p class="muted gif-picker-empty">Searching…</p>
              {:else if !visibleSearch.length}
                <p class="muted gif-picker-empty">No GIFs for this search. Try another word.</p>
              {:else}
                {#each visibleSearch as gif (gif.id)}
                  <button
                    type="button"
                    class="gif-picker-cell"
                    title={gif.title || gif.url}
                    aria-label={(gif.title || 'GIF').trim() || 'GIF'}
                    onclick={() => pickSearch(gif)}
                  >
                    {#if isValidGifsVideoUrl(gif.mp4)}
                      <video
                        src={gif.mp4}
                        muted
                        loop
                        playsinline
                        autoplay
                        preload="metadata"
                        aria-hidden="true"
                      ></video>
                    {:else}
                      <img
                        src={previewUrlForNostrBuildGif(gif)}
                        alt=""
                        loading="lazy"
                      />
                    {/if}
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
        </div>
      {:else if tab === 'find'}
        <label class="gif-search-field">
          <span class="visually-hidden">Filter reaction clips</span>
          <input type="search" bind:value={findQuery} placeholder="Filter…" autocomplete="off" />
        </label>
        <div class="gif-picker-grid">
          {#if loading}
            <p class="muted gif-picker-empty">Searching reaction clips…</p>
          {:else if !filteredFind.length}
            <p class="muted gif-picker-empty">No kind 1090 clips found on GIF relays.</p>
          {:else}
            {#each filteredFind as item (item.eventId || item.url)}
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
          <p class="muted">
            Paste a hosted GIF URL, or upload a file to Blossom. Import can also index a kind 1090
            for Find when a sha256 is known.
          </p>
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
  .gif-picker-overlay {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  /* Higher specificity than global .login-dialog (26rem / 40rem). */
  :global(.login-dialog).gif-picker {
    width: min(42rem, 96vw);
    max-width: calc(100vw - 2rem);
    max-height: min(92dvh, 56rem);
    height: min(92dvh, 56rem);
    margin-inline: auto;
    /* Beat .login-dialog { overflow: auto } which was clipping tab borders. */
    overflow: visible;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    padding: 0.85rem 1rem 1rem;
    flex: 0 0 auto;
    box-sizing: border-box;
  }
  @media (min-width: 720px) {
    :global(.login-dialog).gif-picker {
      width: min(48rem, 94vw);
      max-height: min(94dvh, 64rem);
      height: min(90dvh, 64rem);
    }
  }
  @media (min-width: 1100px) {
    :global(.login-dialog).gif-picker {
      width: min(54rem, 70vw);
      max-height: min(94dvh, 72rem);
      height: min(88dvh, 72rem);
    }
  }
  /* Head / tabs / filter must not flex-shrink — that was clipping button tops. */
  .gif-picker-head,
  .gif-picker-tabs,
  .gif-picker-error,
  .gif-picker-error-block,
  .gif-picker-import,
  .gif-picker > .gif-search-field {
    flex: 0 0 auto;
  }
  .gif-picker > .gif-picker-grid {
    min-height: 0;
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
    line-height: 1.25;
  }
  .gif-picker-tabs {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
    align-items: center;
    /* 1px+ so button borders aren’t painted under the header / clip edge. */
    padding-top: 2px;
    padding-bottom: 2px;
    overflow: visible;
  }
  .gif-picker-tabs :global(.btn),
  .gif-picker-head :global(.btn) {
    line-height: 1.25;
    padding: 0.4rem 0.75rem;
    min-height: 2.15rem;
    box-sizing: border-box;
    overflow: visible;
  }
  .gif-picker :global(.btn) {
    line-height: 1.25;
    padding: 0.4rem 0.75rem;
    min-height: 2.15rem;
    box-sizing: border-box;
  }
  .gif-picker-tabs .btn.active,
  .gif-emotion.active,
  .gif-chip.active {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--rule));
  }
  .gif-picker-error {
    margin: 0;
    color: color-mix(in srgb, #b42318 80%, var(--ink));
    font-size: 0.85rem;
  }
  .gif-picker-error-block {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .gif-picker-search {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    min-height: 0;
    flex: 1 1 auto;
    overflow: hidden;
  }
  /* Only the results grid may shrink — keep search chrome readable. */
  .gif-picker-search > :not(.gif-picker-grid) {
    flex: 0 0 auto;
  }
  .gif-search-field {
    position: relative;
    display: block;
  }
  .gif-search-field input {
    width: 100%;
    padding: 0.45rem 2rem 0.45rem 0.55rem;
    box-sizing: border-box;
    line-height: 1.3;
  }
  .gif-search-busy {
    position: absolute;
    right: 0.55rem;
    top: 50%;
    width: 0.85rem;
    height: 0.85rem;
    margin-top: -0.425rem;
    border: 2px solid color-mix(in srgb, var(--ink) 25%, transparent);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: gif-spin 0.7s linear infinite;
  }
  @keyframes gif-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .gif-attribution {
    margin: 0;
    font-size: 0.8rem;
    line-height: 1.35;
  }
  .gif-starter-chips {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 0.4rem;
    overflow-x: auto;
    padding-block: 0.35rem;
    margin-block: -0.15rem;
    box-sizing: border-box;
  }
  /* Real spacers — scrollport padding alone still clips the first chip in Firefox. */
  .gif-chip-spacer {
    flex: 0 0 4px;
    width: 4px;
    height: 1px;
    pointer-events: none;
  }
  .gif-chip {
    flex: 0 0 auto;
    font-size: 0.8rem;
    line-height: 1.25;
    padding: 0.4rem 0.7rem;
    min-height: 2rem;
    box-sizing: border-box;
  }
  .gif-emotion {
    font-size: 0.78rem;
    line-height: 1.25;
    padding: 0.35rem 0.55rem;
    min-height: 1.9rem;
  }
  .gif-suggest-list {
    list-style: none;
    margin: 0;
    padding: 0.25rem;
    border: 1px solid color-mix(in srgb, var(--rule) 70%, transparent);
    border-radius: 0.35rem;
    max-height: 9rem;
    overflow: auto;
  }
  .gif-suggest-list li {
    margin: 0;
  }
  .gif-suggest-list button {
    display: block;
    width: 100%;
    text-align: left;
    border: 0;
    background: transparent;
    padding: 0.45rem 0.55rem;
    min-height: 2rem;
    line-height: 1.3;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .gif-suggest-list button:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .gif-result-count {
    margin: 0;
    font-size: 0.75rem;
    line-height: 1.35;
  }
  .gif-picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
    grid-auto-rows: 7rem;
    align-content: start;
    gap: 0.45rem;
    overflow: auto;
    flex: 1 1 auto;
    min-height: 10rem;
    /* Fill remaining dialog height instead of a short fixed cap. */
    max-height: none;
  }
  @media (min-width: 720px) {
    .gif-picker-grid {
      grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
      grid-auto-rows: 8rem;
    }
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
  .gif-picker-cell img,
  .gif-picker-cell video {
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
  .gif-file-btn {
    align-self: flex-start;
    cursor: pointer;
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
