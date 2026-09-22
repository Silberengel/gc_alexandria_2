<script lang="ts">
  import TopBar from '$lib/components/TopBar.svelte';
  import { appearance, type Scheme } from '$lib/stores/appearance';
  import { trust } from '$lib/stores/trust';
  import { cacheSizeHuman, clearEventCache } from '$lib/nostr/cache';
  import {
    UI_FONT_CHOICES,
    READING_FONT_CHOICES,
    fontSelectValue,
    isKnownFont
  } from '$lib/fonts';

  let size = $state('0 B');

  const schemes: { id: Scheme; label: string; blurb: string; swatches: string[] }[] = [
    {
      id: 'antique',
      label: 'Antique',
      blurb: 'Warm leather and parchment',
      swatches: ['#efe6dc', '#c6a885', '#795c39', '#2a241c']
    },
    {
      id: 'ocean',
      label: 'Ocean',
      blurb: 'Cool coastal blues',
      swatches: ['#ecf8ff', '#61b6fb', '#0284c7', '#0c4a6e']
    },
    {
      id: 'forrest',
      label: 'Forrest',
      blurb: 'Deep library greens',
      swatches: ['#eaf7ea', '#5fa65f', '#2e6b2e', '#0c230c']
    }
  ];

  const uiFontValue = $derived(fontSelectValue($appearance.uiFont, UI_FONT_CHOICES));
  const readingFontValue = $derived(fontSelectValue($appearance.readingFont, READING_FONT_CHOICES));

  async function refreshSize() {
    size = cacheSizeHuman();
  }

  async function clearCache() {
    await clearEventCache();
    await refreshSize();
  }

  function setReadingSize(raw: string) {
    appearance.setFonts($appearance.uiFont, $appearance.readingFont, Number(raw));
  }

  function setUiFont(stack: string) {
    appearance.setFonts(stack, $appearance.readingFont, $appearance.readingSize);
  }

  function setReadingFont(stack: string) {
    appearance.setFonts($appearance.uiFont, stack, $appearance.readingSize);
  }

  $effect(() => {
    void refreshSize();
  });
</script>

<TopBar />
<main class="shell settings-shell">
  <header class="page-header">
    <p class="page-kicker">Preferences</p>
    <h1>Settings</h1>
    <p class="page-lede muted">Tune reading comfort, palette, and trust without leaving the library.</p>
  </header>

  <section class="settings-panel">
    <header class="settings-panel-head">
      <h2>Appearance</h2>
      <p class="muted">Scheme, type, and scale for the whole interface.</p>
    </header>

    <div class="settings-block">
      <h3 class="settings-label">Color scheme</h3>
      <div class="scheme-grid" role="group" aria-label="Color scheme">
        {#each schemes as s}
          <button
            class="scheme-card"
            class:scheme-card-active={$appearance.scheme === s.id}
            type="button"
            aria-pressed={$appearance.scheme === s.id}
            onclick={() => appearance.setScheme(s.id)}
          >
            <span class="scheme-swatches" aria-hidden="true">
              {#each s.swatches as c}
                <span style="background:{c}"></span>
              {/each}
            </span>
            <span class="scheme-copy">
              <span class="scheme-name">{s.label}</span>
              <span class="scheme-blurb muted">{s.blurb}</span>
            </span>
          </button>
        {/each}
      </div>
    </div>

    <label class="settings-toggle" class:settings-toggle-on={$appearance.dark}>
      <span class="settings-toggle-text">
        <span class="settings-toggle-title">Dark mode</span>
        <span class="muted">Lower luminance for evening reading</span>
      </span>
      <input
        type="checkbox"
        checked={$appearance.dark}
        onchange={(e) => appearance.setDark((e.target as HTMLInputElement).checked)}
      />
    </label>

    <div class="settings-fields">
      <label class="settings-field">
        <span>UI font</span>
        <select
          class="settings-font-select"
          style="font-family: {uiFontValue}"
          value={uiFontValue}
          onchange={(e) => setUiFont((e.target as HTMLSelectElement).value)}
        >
          {#each UI_FONT_CHOICES as f}
            <option value={f.stack} style="font-family: {f.stack}">{f.label}</option>
          {/each}
          {#if !isKnownFont($appearance.uiFont, UI_FONT_CHOICES)}
            <option value={$appearance.uiFont}>Custom</option>
          {/if}
        </select>
      </label>
      <label class="settings-field">
        <span>Reading font</span>
        <select
          class="settings-font-select"
          style="font-family: {readingFontValue}"
          value={readingFontValue}
          onchange={(e) => setReadingFont((e.target as HTMLSelectElement).value)}
        >
          {#each READING_FONT_CHOICES as f}
            <option value={f.stack} style="font-family: {f.stack}">{f.label}</option>
          {/each}
          {#if !isKnownFont($appearance.readingFont, READING_FONT_CHOICES)}
            <option value={$appearance.readingFont}>Custom</option>
          {/if}
        </select>
      </label>
      <div class="settings-field">
        <div class="settings-field-row">
          <label for="settings-text-size">Text size</label>
          <span class="settings-size-value" aria-hidden="true">{$appearance.readingSize}px</span>
        </div>
        <p class="muted settings-hint" id="settings-text-size-hint">
          Scales chrome, controls, and reading text together
        </p>
        <input
          id="settings-text-size"
          class="settings-range"
          type="range"
          min="14"
          max="28"
          step="1"
          value={$appearance.readingSize}
          aria-describedby="settings-text-size-hint"
          oninput={(e) => setReadingSize((e.target as HTMLInputElement).value)}
        />
      </div>
    </div>

    {#if $appearance.customPrimary}
      <button class="btn" type="button" onclick={() => appearance.resetColors()}>Reset custom color</button>
    {/if}
  </section>

  <section class="settings-panel">
    <header class="settings-panel-head">
      <h2>Trust filter</h2>
      <p class="muted">GrapeRank from Brainstorm (NIP-85) for search ranking and spam filtering.</p>
    </header>

    <label class="settings-toggle" class:settings-toggle-on={$trust.enabled}>
      <span class="settings-toggle-text">
        <span class="settings-toggle-title">Prefer trusted authors</span>
        <span class="muted">Hide authors below the minimum GrapeRank</span>
      </span>
      <input
        type="checkbox"
        checked={$trust.enabled}
        onchange={(e) => trust.setEnabled((e.target as HTMLInputElement).checked)}
      />
    </label>

    <label class="settings-field">
      <span>Minimum rank</span>
      <input
        type="number"
        min="1"
        max="100"
        value={$trust.rankMin}
        onchange={(e) => trust.setRankMin(Number((e.target as HTMLInputElement).value))}
      />
    </label>
  </section>

  <section class="settings-panel">
    <header class="settings-panel-head">
      <h2>Cache</h2>
      <p class="muted">Local event cache only. Appearance and trust settings are kept.</p>
    </header>
    <div class="settings-cache-row">
      <p class="settings-cache-size">Cache size <strong>{size}</strong></p>
      <button class="btn" type="button" onclick={clearCache}>Clear cache</button>
    </div>
  </section>
</main>
