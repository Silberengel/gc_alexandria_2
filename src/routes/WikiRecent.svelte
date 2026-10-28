<script lang="ts">
  import { querystring, replace } from 'svelte-spa-router';
  import { parseWikiRecentKind, wikiHubListingHref } from '$lib/wiki-hub';
  import { parseAuthorResultScope } from '$lib/result-scope';
  import { skipNextNavTrack } from '$lib/nav-history';

  $effect(() => {
    const params = new URLSearchParams($querystring ?? '');
    const kind = parseWikiRecentKind(params.get('kind'));
    const from = parseAuthorResultScope(params.get('from'));
    const href = wikiHubListingHref({ kind, from });
    skipNextNavTrack();
    void replace(href.startsWith('#') ? href.slice(1) : href);
  });
</script>

<p class="muted" style="padding: 1rem">Opening wiki…</p>
