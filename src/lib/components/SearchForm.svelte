<script lang="ts">
  import { suggestTitles, npubFromInput, isNsec, exactEventQuery } from '$lib/search';

  interface Props {
    /** Extra class on the form (e.g. page-level layout). */
    class?: string;
    /** Prefill from the current search route. */
    initialQuery?: string;
  }

  let { class: className = '', initialQuery = '' }: Props = $props();

  let query = $state('');
  let suggestions = $state<string[]>([]);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let seeded = '';

  $effect(() => {
    const next = initialQuery.trim();
    if (next === seeded) return;
    seeded = next;
    query = next;
    suggestions = [];
  });

  function submitSearch(e: Event) {
    e.preventDefault();
    const q = query.trim();
    if (!q || isNsec(q)) {
      query = '';
      return;
    }
    const npub = npubFromInput(q);
    if (npub) {
      window.location.hash = `#/p/${npub}`;
      return;
    }
    suggestions = [];
    window.location.hash = `#/search?q=${encodeURIComponent(q)}`;
  }

  function onInput(): void {
    suggestions = [];
    if (timer) clearTimeout(timer);
    const q = query.trim();
    if (q.length < 2 || isNsec(q) || exactEventQuery(q)) return;
    timer = setTimeout(() => {
      void suggestTitles(q).then((hits) => {
        suggestions = hits.slice(0, 8);
      });
    }, 200);
  }

  function pick(hit: string): void {
    query = hit;
    suggestions = [];
    window.location.hash = `#/search?q=${encodeURIComponent(hit)}`;
  }
</script>

<form class={`search-form ${className}`.trim()} onsubmit={submitSearch}>
  <input
    type="search"
    placeholder="Search books, wiki, events…"
    bind:value={query}
    oninput={onInput}
    autocomplete="off"
  />
  {#if suggestions.length}
    <ul class="suggest-list">
      {#each suggestions as hit}
        <li>
          <button type="button" onclick={() => pick(hit)}>{hit}</button>
        </li>
      {/each}
    </ul>
  {/if}
</form>
