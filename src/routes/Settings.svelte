<script lang="ts">
  import TopBar from '$lib/components/TopBar.svelte';
  import { appearance } from '$lib/stores/appearance';
  import { cacheSizeHuman, clearEventCache } from '$lib/nostr/cache';

  let size = $state('0 B');

  async function refreshSize() {
    size = cacheSizeHuman();
  }

  async function clearCache() {
    await clearEventCache();
    await refreshSize();
  }

  $effect(() => {
    void refreshSize();
  });
</script>

<TopBar />
<main class="shell">
  <h1>Settings</h1>

  <section class="card" style="margin-bottom:1rem">
    <h2>Appearance</h2>
    <p class="muted">Scheme</p>
    <div class="chip-row">
      <button class="btn" type="button" onclick={() => appearance.setScheme('antique')}>Antique</button>
      <button class="btn" type="button" onclick={() => appearance.setScheme('ocean')}>Ocean</button>
      <button class="btn" type="button" onclick={() => appearance.setScheme('forrest')}>Forrest</button>
    </div>
    <label style="display:block;margin:1rem 0">
      <input type="checkbox" checked={$appearance.dark} onchange={(e) => appearance.setDark((e.target as HTMLInputElement).checked)} />
      Dark mode
    </label>
    <label>UI font<input type="text" value={$appearance.uiFont} onchange={(e) => appearance.setFonts((e.target as HTMLInputElement).value, $appearance.readingFont, $appearance.readingSize)} /></label>
    <label>Reading font<input type="text" value={$appearance.readingFont} onchange={(e) => appearance.setFonts($appearance.uiFont, (e.target as HTMLInputElement).value, $appearance.readingSize)} /></label>
    <label>Reading size<input type="number" min="14" max="28" value={$appearance.readingSize} onchange={(e) => appearance.setFonts($appearance.uiFont, $appearance.readingFont, Number((e.target as HTMLInputElement).value))} /></label>
    <button class="btn" type="button" onclick={() => appearance.resetColors()}>Reset colors</button>
  </section>

  <section class="card">
    <h2>Cache</h2>
    <p>Cache size: {size}</p>
    <button class="btn" type="button" onclick={clearCache}>Clear Cache</button>
    <p class="muted">Appearance settings are kept.</p>
  </section>
</main>
