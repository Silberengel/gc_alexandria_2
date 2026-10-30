<script lang="ts">
  import UserBadge from '$lib/components/UserBadge.svelte';
  import ProseGrammarField from '$lib/components/ProseGrammarField.svelte';
  import LoadingHint from '$lib/components/LoadingHint.svelte';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { CONTACT_A_TAG, KIND, REPO_OWNER_HEX } from '$lib/constants';
  import { GITCITADEL_HEX } from '$lib/hex';
  import { scrubClipboardTextPaste, scrubProseText } from '$lib/clean-url';
  import { signAndPublish } from '$lib/sign';
  import { feedThreadPath } from '$lib/feed';
  import { nip19 } from 'nostr-tools';
  import { link } from 'svelte-spa-router';

  const ALEXANDRIA_REPO_THREAD = (() => {
    try {
      const naddr = nip19.naddrEncode({
        kind: KIND.GIT_REPO,
        pubkey: REPO_OWNER_HEX,
        identifier: 'Alexandria'
      });
      return `#/feed?thread=${naddr}`;
    } catch {
      return '#/feed';
    }
  })();

  let subject = $state('');
  let body = $state('');
  let error = $state('');
  let success = $state('');
  let issueHref = $state('');
  let sending = $state(false);

  function onBodyPaste(event: ClipboardEvent): void {
    scrubClipboardTextPaste(event, (scrubbed, start, end) => {
      body = body.slice(0, start) + scrubbed + body.slice(end);
    });
  }

  function onSubjectPaste(event: ClipboardEvent): void {
    scrubClipboardTextPaste(event, (scrubbed, start, end) => {
      subject = subject.slice(0, start) + scrubbed + subject.slice(end);
    });
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    success = '';
    issueHref = '';
    if (!$session.pubkey) return;
    subject = scrubProseText(subject);
    body = scrubProseText(body);
    if (!subject.trim() || !body.trim()) {
      error = 'Subject and body are required.';
      return;
    }
    sending = true;
    try {
      const signed = await signAndPublish({
        kind: KIND.ISSUE,
        content: body.trim(),
        tags: [
          ['a', CONTACT_A_TAG],
          ['p', REPO_OWNER_HEX],
          ['subject', subject.trim()]
        ]
      });
      if (!signed) {
        error = 'Could not sign or publish the issue.';
        return;
      }
      issueHref = `#${feedThreadPath(signed)}`;
      success = 'Issue published. Thank you.';
      subject = '';
      body = '';
    } finally {
      sending = false;
    }
  }
</script>

<main class="shell reading-body contact-page">
  <header class="page-header">
    <p class="page-kicker">GitCitadel</p>
    <h1>Contact</h1>
    <p class="page-lede muted">
      Reach the project maintainers or open an Alexandria issue on Nostr.
    </p>
  </header>

  <p>
    <a href="https://github.com/ShadowySupercode/gitcitadel" target="_blank" rel="noopener">GitHub</a> ·
    <a href="https://geyser.fund/project/gitcitadel" target="_blank" rel="noopener">Geyser</a>
  </p>
  <p><UserBadge pubkey={GITCITADEL_HEX} /></p>
  <p class="contact-actions">
    <a class="btn" href={ALEXANDRIA_REPO_THREAD} use:link>Alexandria issues</a>
  </p>

  {#if $session.pubkey}
    <form class="card contact-form" onsubmit={submit}>
      <label>Subject<input type="text" bind:value={subject} required onpaste={onSubjectPaste} /></label>
      <div class="contact-body-field">
        <ProseGrammarField
          label="Body"
          rows={8}
          bind:value={body}
          required
          onPaste={onBodyPaste}
        />
      </div>
      {#if sending}<LoadingHint message="Sending…" compact />{/if}
      {#if error}<p class="contact-form-error">{error}</p>{/if}
      {#if success}
        <p class="contact-form-success">{success}</p>
        {#if issueHref}
          <p><a href={issueHref} use:link>View your issue in Alexandria</a></p>
        {/if}
      {/if}
      <button class="btn btn-primary" type="submit" style="margin-top:1rem" disabled={sending}>
        {sending ? 'Sending…' : 'Send'}
      </button>
    </form>
  {:else}
    <p class="muted">Sign in with Nostr to send a message to the maintainers.</p>
    <p class="contact-actions">
      <button class="btn btn-primary" type="button" onclick={() => openLoginDialog()}>Sign in</button>
    </p>
  {/if}
</main>
