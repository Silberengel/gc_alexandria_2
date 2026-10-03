<script lang="ts">
  import TopBar from '$lib/components/TopBar.svelte';
  import { GITCITADEL_NPUB } from '$lib/constants';
</script>

<TopBar />
<main class="shell reading-body about-page">
  <header class="page-header">
    <p class="page-kicker">GitCitadel</p>
    <h1>About</h1>
    <p class="page-lede muted">
      A GitCitadel project for reading publications and wiki pages from Nostr.
    </p>
  </header>
  <img class="about-hero" src="/screenshots/old_books.jpg" alt="Library of Alexandria" />
  <ul>
    <li><a href="https://github.com/ShadowySupercode/gitcitadel" target="_blank" rel="noopener">GitHub</a></li>
    <li><a href="https://geyser.fund/project/gitcitadel" target="_blank" rel="noopener">Geyser</a></li>
    <li><a href="https://gitcitadel.com" target="_blank" rel="noopener">gitcitadel.com</a></li>
    <li><a href={`#/p/${GITCITADEL_NPUB}`}>GitCitadel on Nostr</a></li>
  </ul>

  <h2>Getting started</h2>
  <ol>
    <li>Use the search bar on the home page to find books, wiki pages, or Nostr events.</li>
    <li>Open a publication to see ratings, comments, and highlights before reading.</li>
    <li>Press <strong>Read the publication</strong> when you are ready for the text (catalog-only stubs have no readable copy).</li>
    <li>Press <strong>Back to the publication info page</strong> in the reader to return to ratings, comments, and details.</li>
    <li>Follow wikilinks inside articles to search by that d-tag.</li>
    <li>Sign in with a Nostr extension when you want to rate, comment, highlight, add lists or bookshelf shelves, or contact GitCitadel.</li>
  </ol>
</main>
