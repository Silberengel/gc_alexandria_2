<script lang="ts">
  import TopBar from '$lib/components/TopBar.svelte';
  import UserBadge from '$lib/components/UserBadge.svelte';
  import { session } from '$lib/stores/session';
  import { CONTACT_A_TAG, KIND, REPO_OWNER_HEX } from '$lib/constants';
  import { GITCITADEL_HEX } from '$lib/hex';
  import { signAndPublish } from '$lib/sign';
  import { nip19 } from 'nostr-tools';

  const ISSUES_BASE = 'https://gitworkshop.dev/silberengel@gitcitadel.com/Alexandria/issues';

  let subject = $state('');
  let body = $state('');
  let error = $state('');
  let success = $state('');
  let issueHref = $state('');
  let draftSaved = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    success = '';
    issueHref = '';
    if (!subject.trim() || !body.trim()) {
      error = 'Subject and body are required.';
      return;
    }
    if (!$session.pubkey) {
      draftSaved = true;
      error = 'Please sign in to publish your report.';
      return;
    }
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
    draftSaved = false;
  }
</script>

<TopBar />
<main class="shell reading-body">
  <h1>Contact GitCitadel</h1>
  <p>
    <a href="https://github.com/ShadowySupercode/gitcitadel" target="_blank" rel="noopener">GitHub</a> ·
    <a href="https://geyser.fund/project/gitcitadel" target="_blank" rel="noopener">Geyser</a>
  </p>
  <p><UserBadge pubkey={GITCITADEL_HEX} /></p>
  <p><a href={ISSUES_BASE} target="_blank" rel="noopener">Alexandria issues</a></p>

  <form class="card" onsubmit={submit}>
    <label>Subject<input type="text" bind:value={subject} required /></label>
    <label style="display:block;margin-top:1rem">Body<textarea rows="8" bind:value={body} required></textarea></label>
    {#if error}<p style="color:crimson">{error}</p>{/if}
    {#if draftSaved && !$session.pubkey}<p class="muted">Your draft is kept in the form.</p>{/if}
    {#if success}
      <p style="color:green">{success}</p>
      {#if issueHref}
        <p><a href={issueHref} target="_blank" rel="noopener">{issueHref}</a></p>
      {/if}
    {/if}
    <button class="btn btn-primary" type="submit" style="margin-top:1rem">Send</button>
  </form>
</main>
