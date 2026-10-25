<script lang="ts">
  import { replace } from 'svelte-spa-router';
  import {
    decodeFeedThreadTarget,
    feedListPath,
    feedThreadPointerFromId,
    parseFeedTab
  } from '$lib/feed';
  import { querystring } from 'svelte-spa-router';

  let { params = {} }: { params?: { id?: string } } = $props();

  $effect(() => {
    const raw = (params.id ?? '').trim().replace(/^nostr:/i, '');
    const target = raw ? decodeFeedThreadTarget(raw) : null;
    const tab = parseFeedTab(new URLSearchParams($querystring ?? '').get('tab'));
    if (!target) {
      void replace(feedListPath(tab));
      return;
    }
    const q = new URLSearchParams();
    // Keep naddr as-is; upgrade bare note1 / hex into nevent1.
    q.set(
      'thread',
      target.type === 'addr' ? raw : feedThreadPointerFromId(target.id)
    );
    if (tab !== 'original') q.set('tab', tab);
    void replace(`/feed?${q.toString()}`);
  });
</script>

<p class="muted" style="padding: 1rem">Opening thread…</p>
