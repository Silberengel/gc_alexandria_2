<script lang="ts">
  import { replace } from 'svelte-spa-router';
  import { decodeFeedPointer, feedListPath, parseFeedTab } from '$lib/feed';
  import { querystring } from 'svelte-spa-router';

  let { params = {} }: { params?: { id?: string } } = $props();

  $effect(() => {
    const id = params.id ? decodeFeedPointer(params.id) : null;
    const tab = parseFeedTab(new URLSearchParams($querystring ?? '').get('tab'));
    if (!id) {
      void replace(feedListPath(tab));
      return;
    }
    const q = new URLSearchParams();
    q.set('thread', id);
    if (tab !== 'original') q.set('tab', tab);
    void replace(`/feed?${q.toString()}`);
  });
</script>

<p class="muted" style="padding: 1rem">Opening thread…</p>
