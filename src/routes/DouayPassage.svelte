<script lang="ts">
  import { onMount } from 'svelte';
  import { replace } from 'svelte-spa-router';
  import { douayPassagePublicationPath, parseDouayPassage } from '$lib/douay-passage';

  /** Biblestr-shaped `/luke/9?verses=46-50` → Douay publication reader. */
  let { params = {} }: { params?: { book?: string; chapter?: string } } = $props();

  onMount(() => {
    const pathname = `/${params.book ?? ''}/${params.chapter ?? ''}`;
    const search = window.location.hash.includes('?')
      ? window.location.hash.slice(window.location.hash.indexOf('?'))
      : window.location.search;
    const focus = parseDouayPassage(pathname, search);
    if (!focus) {
      replace('/');
      return;
    }
    replace(douayPassagePublicationPath(focus));
  });
</script>

<p class="loading-hint" aria-live="polite">Opening passage…</p>
