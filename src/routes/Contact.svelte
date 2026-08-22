<script lang="ts">
  import TopBar from '$lib/components/TopBar.svelte';
  import UserBadge from '$lib/components/UserBadge.svelte';
  import { session } from '$lib/stores/session';
  import { GITCITADEL_NPUB, REPO_OWNER_HEX } from '$lib/constants';
  import { type Event, type EventTemplate } from 'nostr-tools';

  let subject = $state('');
  let body = $state('');
  let error = $state('');
  let success = $state('');
  let draftSaved = $state(false);

  async function submit(e: Event) {
    e.preventDefault();
    error = '';
    success = '';
    if (!subject.trim() || !body.trim()) {
      error = 'Subject and body are required.';
      return;
    }
    if (!$session.pubkey) {
      draftSaved = true;
      error = 'Please sign in to publish your report.';
      return;
    }
    const ext = window.nostr;
    if (!ext?.signEvent) return;
    const template: EventTemplate = {
      kind: 1621,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['a', `30617:${REPO_OWNER_HEX}:Alexandria`],
        ['p', REPO_OWNER_HEX]
      ],
      content: `Subject: ${subject}\n\n${body}`
    };
    const signed = (await ext.signEvent(template)) as Event;
    await session.publish(signed);
    success = 'Issue published. Thank you.';
  }
</script>

<TopBar />
<main class="shell reading-body">
  <h1>Contact GitCitadel</h1>
  <p>
    <a href="https://github.com/ShadowySupercode/gitcitadel" target="_blank" rel="noopener">GitHub</a> ·
    <a href="https://geyser.fund/project/gitcitadel" target="_blank" rel="noopener">Geyser</a>
  </p>
  <p><UserBadge pubkey={REPO_OWNER_HEX} /></p>
  <p><a href="https://gitworkshop.dev/silberengel@gitcitadel.com/Alexandria/issues" target="_blank" rel="noopener">Alexandria issues</a></p>

  <form class="card" onsubmit={submit}>
    <label>Subject<input type="text" bind:value={subject} required /></label>
    <label style="display:block;margin-top:1rem">Body<textarea rows="8" bind:value={body} required></textarea></label>
    {#if error}<p style="color:crimson">{error}</p>{/if}
    {#if draftSaved && !$session.pubkey}<p class="muted">Your draft is kept in the form.</p>{/if}
    {#if success}<p style="color:green">{success}</p>{/if}
    <button class="btn btn-primary" type="submit" style="margin-top:1rem">Send</button>
  </form>
</main>
