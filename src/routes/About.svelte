<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import UserBadge from '$lib/components/UserBadge.svelte';
  import LoadingHint from '$lib/components/LoadingHint.svelte';
  import { session } from '$lib/stores/session';
  import {
    APP_VERSION,
    CONTACT_A_TAG,
    GITCITADEL_NPUB,
    KIND,
    REPO_OWNER_HEX
  } from '$lib/constants';
  import { GITCITADEL_HEX } from '$lib/hex';
  import { signAndPublish } from '$lib/sign';
  import { nip19 } from 'nostr-tools';

  const PROJECT_URL = 'https://gitworkshop.dev/silberengel@gitcitadel.com/Alexandria';
  const ISSUES_BASE = `${PROJECT_URL}/issues`;

  let subject = $state('');
  let body = $state('');
  let error = $state('');
  let success = $state('');
  let issueHref = $state('');
  let sending = $state(false);

  onMount(() => {
    let scroll = false;
    try {
      scroll = sessionStorage.getItem('alexandria-scroll-contact') === '1';
      if (scroll) sessionStorage.removeItem('alexandria-scroll-contact');
    } catch {
      /* ignore */
    }
    if (!scroll) return;
    requestAnimationFrame(() => {
      document.getElementById('contact')?.scrollIntoView({ block: 'start' });
    });
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    success = '';
    issueHref = '';
    if (!$session.pubkey) return;
    if (!subject.trim() || !body.trim()) {
      error = 'Subject and body are required.';
      return;
    }
    sending = true;
    try {
      const signed = await signAndPublish({
        kind: KIND.ISSUE,
        content: `Subject: ${subject}\n\n${body}`,
        tags: [
          ['a', CONTACT_A_TAG],
          ['p', REPO_OWNER_HEX]
        ]
      });
      if (!signed) {
        error = 'Could not sign or publish the issue.';
        return;
      }
      issueHref = `${ISSUES_BASE}/${nip19.neventEncode({
        id: signed.id,
        author: signed.pubkey,
        kind: signed.kind
      })}`;
      success = 'Issue published. Thank you.';
    } finally {
      sending = false;
    }
  }
</script>

<TopBar />
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

  {#if $session.pubkey}
    <section id="contact" class="about-contact">
      <h2>Contact</h2>
      <p class="muted">Reach the project maintainers or open an Alexandria issue on Nostr.</p>
      <p>
        <a href="https://github.com/ShadowySupercode/gitcitadel" target="_blank" rel="noopener">GitHub</a> ·
        <a href="https://geyser.fund/project/gitcitadel" target="_blank" rel="noopener">Geyser</a>
      </p>
      <p><UserBadge pubkey={GITCITADEL_HEX} /></p>
      <p class="contact-actions">
        <a class="btn" href={ISSUES_BASE} target="_blank" rel="noopener">Alexandria issues</a>
      </p>

      <form class="card" onsubmit={submit}>
        <label>Subject<input type="text" bind:value={subject} required /></label>
        <label style="display:block;margin-top:1rem">Body<textarea rows="8" bind:value={body} required></textarea></label>
        {#if sending}<LoadingHint message="Sending…" compact />{/if}
        {#if error}<p class="contact-form-error">{error}</p>{/if}
        {#if success}
          <p class="contact-form-success">{success}</p>
          {#if issueHref}
            <p><a href={issueHref} target="_blank" rel="noopener">{issueHref}</a></p>
          {/if}
        {/if}
        <button class="btn btn-primary" type="submit" style="margin-top:1rem" disabled={sending}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </section>
  {/if}
</main>
