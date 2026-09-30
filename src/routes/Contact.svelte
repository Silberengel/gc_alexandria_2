<script lang="ts">
  import { replace } from 'svelte-spa-router';
  import TopBar from '$lib/components/TopBar.svelte';
  import UserBadge from '$lib/components/UserBadge.svelte';
  import LoadingHint from '$lib/components/LoadingHint.svelte';
  import { session } from '$lib/stores/session';
  import { CONTACT_A_TAG, KIND, REPO_OWNER_HEX } from '$lib/constants';
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

  $effect(() => {
    if (!$session.pubkey && !$session.loading) {
      replace('/');
    }
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    success = '';
    issueHref = '';
    if (!$session.pubkey) {
      replace('/');
      return;
    }
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
      issueHref = `${ISSUES_BASE}/${nip19.noteEncode(signed.id)}`;
      success = 'Issue published. Thank you.';
    } finally {
      sending = false;
    }
  }
</script>

{#if $session.pubkey}
  <TopBar />
  <main class="shell reading-body contact-page">
    <header class="page-header">
      <p class="page-kicker">GitCitadel</p>
      <h1>Contact</h1>
      <p class="page-lede muted">Reach the project maintainers or open an Alexandria issue on Nostr.</p>
    </header>
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
  </main>
{/if}
