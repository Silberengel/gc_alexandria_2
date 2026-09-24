<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { readingPrefs } from '$lib/stores/reading-prefs';
  import {
    activeReadingEntries,
    findQueueEntry,
    readingProgressPercent
  } from '$lib/reading-queue';
  import { viewerReadingEntries } from '$lib/viewer-reading-queue';
  import { stopTrackingPublication, trackReadingPublication, resetReadingProgress } from '$lib/reading-queue-actions';
  import { eventAddress } from '$lib/nostr/verify';
  import { myReadLabel, readLabelsForPublication } from '$lib/read-marks';

  interface Props {
    publication: Event;
    total: number;
    pos: number;
    sectionId?: string;
    readLabels?: Event[];
  }

  let { publication, total, pos, sectionId, readLabels = [] }: Props = $props();

  let busy = $state(false);
  let errorHint = $state('');

  const addr = $derived(eventAddress(publication));
  const entries = $derived($viewerReadingEntries);
  const entry = $derived(findQueueEntry(entries, addr));
  const concurrent = $derived($readingPrefs.concurrent);
  const active = $derived(activeReadingEntries(entries, concurrent));
  const inActive = $derived(!!entry && active.some((e) => e.a === entry!.a));
  const alreadyRead = $derived(
    !!myReadLabel(readLabelsForPublication(readLabels, publication), publication, $session.pubkey)
  );
  const ready = $derived(total >= 1);
  const percent = $derived.by(() => {
    if (!entry) return 0;
    return readingProgressPercent(entry);
  });
  const behindTracked = $derived(!!entry && entry.pos > 0);
  const bunker = $derived($session.signerType === 'bunker');

  async function track(): Promise<void> {
    if (busy) return;
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    if (!ready || alreadyRead) return;
    busy = true;
    errorHint = '';
    try {
      if (bunker) {
        const ok = await session.ensureBunkerSigner();
        if (!ok && !session.getSigner()) {
          errorHint = 'Amber is not connected. Open Sign in and reconnect Amber, then try Track again.';
          return;
        }
      }
      const published = await trackReadingPublication({ publication, pos, total, sectionId });
      if (!published) {
        errorHint = bunker
          ? 'Could not publish. Approve the request in Amber (keep this tab open), then try again.'
          : 'Could not publish reading progress. Check your signer and try again.';
      }
    } finally {
      busy = false;
    }
  }

  async function stop(): Promise<void> {
    if (busy) return;
    busy = true;
    errorHint = '';
    try {
      if (bunker) await session.ensureBunkerSigner();
      const published = await stopTrackingPublication(publication);
      if (!published) {
        errorHint = bunker
          ? 'Could not update the queue. Approve in Amber, then try again.'
          : 'Could not stop tracking. Try again.';
      }
    } finally {
      busy = false;
    }
  }

  async function reset(): Promise<void> {
    if (busy || !entry) return;
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    busy = true;
    errorHint = '';
    try {
      if (bunker) await session.ensureBunkerSigner();
      const published = await resetReadingProgress({ publication, total });
      if (!published) {
        errorHint = bunker
          ? 'Could not reset. Approve in Amber, then try again.'
          : 'Could not reset tracking. Try again.';
      }
    } finally {
      busy = false;
    }
  }
</script>

{#if alreadyRead}
  <p class="muted reading-track-hint">Marked as read</p>
{:else if !ready}
  <p class="muted reading-track-hint">Loading text…</p>
{:else if entry}
  <div class="reading-track-row">
    <div class="reading-progress" role="progressbar" aria-valuenow={percent} aria-valuemin="0" aria-valuemax="100">
      <span class="reading-progress-fill" style={`width:${percent}%`}></span>
    </div>
    <span class="muted reading-track-status">
      {percent}% · {inActive ? 'In rotation' : 'Up next'}
    </span>
    <button class="btn btn-sm" type="button" disabled={busy} onclick={() => void stop()}>
      Stop tracking
    </button>
    <button
      class="btn btn-sm"
      type="button"
      disabled={busy || !behindTracked}
      title="Clear tracked progress back to the start"
      onclick={() => void reset()}
    >
      Reset tracking
    </button>
  </div>
  <aside class="reading-track-help" aria-label="Tracking help">
    <p>
      Progress only moves forward as you read further. Scrolling up does not wipe it.
      Reset tracking sets progress back to 0.
    </p>
    <p>Mark as read on the publication page to finish and leave the queue.</p>
    {#if bunker}
      <p>Progress is remembered as you read; Amber asks to publish every few seconds (not on every scroll).</p>
    {/if}
  </aside>
{:else}
  <button class="btn" type="button" disabled={busy} onclick={() => void track()}>
    {$session.pubkey
      ? busy && bunker
        ? 'Waiting for Amber…'
        : 'Track reading'
      : 'Sign in to track reading'}
  </button>
  {#if bunker && !busy}
    <aside class="reading-track-help" aria-label="Tracking help">
      <p>Amber will ask you to approve publishing your reading queue.</p>
    </aside>
  {/if}
{/if}
{#if errorHint}
  <p class="muted reading-track-hint" role="alert">{errorHint}</p>
{/if}
