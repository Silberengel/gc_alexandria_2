<script lang="ts">
  import IndexCardList from '$lib/components/IndexCardList.svelte';
  import { APP_VERSION, GITCITADEL_NPUB } from '$lib/constants';

  /** GitCitadel blog index (kind 30040). */
  const BLOG_NADDR =
    'naddr1qvzqqqr4tqpzplfq3m5v3u5r0q9f255fdeyz8nyac6lagssx8zy4wugxjs8ajf7pqywhwumn8ghj7mt9wf3h2une94ex2mrp0yhxjmthv9kxgtn9w5q3qamnwvaz7tmwdaehgu3wd3skueqprdmhxue69uhhg6r9vd5hgctyv4kzumn0wd68yvfwvdhk6qppw35x2tt8d96xx6t5v9jx2mpdvfkx7eedvfuj6um5v4kxccfdwcknzw0fh4m';

  /** GitCitadel project documentation index (kind 30040). */
  const DOCS_NADDR =
    'naddr1qvzqqqr4tqpzplfq3m5v3u5r0q9f255fdeyz8nyac6lagssx8zy4wugxjs8ajf7pqywhwumn8ghj7mt9wf3h2une94ex2mrp0yhxjmthv9kxgtn9w5q3qamnwvaz7tmwdaehgu3wd3skueqprdmhxue69uhhg6r9vd5hgctyv4kzumn0wd68yvfwvdhk6qpwva5hgcmfw3skgetv94c8ymm2v43hgttyda3h2mt9de6xzarfdahz6cne94ehgetvd3sj6a3dxyqednuw';
</script>

<main class="shell reading-body about-page">
  <header class="page-header">
    <p class="page-kicker">GitCitadel</p>
    <h1>About</h1>
    <p class="page-lede muted">
      A GitCitadel project for reading publications and wiki pages from Nostr.
    </p>
    {#if APP_VERSION}
      <p class="about-version muted">Version {APP_VERSION}</p>
    {/if}
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
    <li>Press the back button in the reader to return to ratings, comments, and details.</li>
    <li>Follow wikilinks inside articles to search by that d-tag.</li>
    <li>Sign in with a Nostr extension when you want to rate, comment, highlight, add lists or bookshelf shelves, or contact GitCitadel.</li>
  </ol>

  <section class="about-index-section" aria-labelledby="about-blog-heading">
    <h2 id="about-blog-heading">Our blog</h2>
    <IndexCardList naddr={BLOG_NADDR} />
  </section>

  <section class="about-index-section" aria-labelledby="about-docs-heading">
    <h2 id="about-docs-heading">Our Documentation</h2>
    <IndexCardList naddr={DOCS_NADDR} />
  </section>
</main>
