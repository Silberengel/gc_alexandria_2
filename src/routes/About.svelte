<script lang="ts">
  import TopBar from '$lib/components/TopBar.svelte';
  import { GITCITADEL_NPUB } from '$lib/constants';
</script>

<TopBar />
<main class="shell reading-body">
  <h1>About</h1>
  <p>
    This is the Library of Alexandria, a GitCitadel project for reading publications and wiki pages from Nostr.
  </p>
  <ul>
    <li><a href="https://github.com/ShadowySupercode/gitcitadel" target="_blank" rel="noopener">GitHub</a></li>
    <li><a href="https://geyser.fund/project/gitcitadel" target="_blank" rel="noopener">Geyser</a></li>
    <li><a href="https://gitcitadel.com" target="_blank" rel="noopener">gitcitadel.com</a></li>
    <li><a href={`#/p/${GITCITADEL_NPUB}`}>GitCitadel on Nostr</a></li>
  </ul>
</main>
