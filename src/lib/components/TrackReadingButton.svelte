<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { readingPrefs } from '$lib/stores/reading-prefs';
  import {
    activeReadingEntries,
    findQueueEntry,
    readingProgressPercent,
    readingQueueFromMetadata
  } from '$lib/reading-queue';
  import { stopTrackingPublication, trackReadingPublication } from '$lib/reading-queue-actions';
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
  let metaEvents = $state<Event[]>([]);

  $effect(() => {
    const unsub = session.metadata.subscribe((events) => {
      metaEvents = events;
    });
    return unsub;
  });

  const addr = $derived(eventAddress(publication));
  const entries = $derived(readingQueueFromMetadata(metaEvents));
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
    const live = readingProgressPercent({ pos, total: Math.max(total, entry.total, 1) });
    return Math.max(readingProgressPercent(entry), live);
  });

  async function track(): Promise<void> {
    if (busy) return;
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    if (!ready || alreadyRead) return;
    busy = true;
    try {
      await trackReadingPublication({ publication, pos, total, sectionId });
    } finally {
      busy = false;
    }
  }

  async function stop(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await stopTrackingPublication(publication);
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
  </div>
  <p class="muted reading-track-hint">Mark as read on the publication page to finish and leave the queue.</p>
{:else}
  <button class="btn" type="button" disabled={busy} onclick={() => void track()}>
    {$session.pubkey ? 'Track reading' : 'Sign in to track reading'}
  </button>
{/if}
