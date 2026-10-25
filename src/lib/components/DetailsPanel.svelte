<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { replaceableCoord } from '$lib/nostr/replaceable';
  import { eventSources } from '$lib/nostr/event-sources';
  import {
    exportPublicationDownload,
    type PublicationDownloadFormat
  } from '$lib/publication-export';
  import { cropRenderedUrlsInText } from '$lib/crop-url';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { opComposeId, registerOpReplyToolbar, toggleOpCompose } from '$lib/stores/op-reply';
  import { KIND } from '$lib/constants';
  import {
    isShortNoteEdited,
    onShortNoteEdits,
    shortNoteEditState,
    type ShortNoteEditState
  } from '$lib/short-note-edits';
  import { diffHasChanges, diffLines, type DiffLine } from '$lib/text-diff';
  import { formatAbsoluteTime, formatRelativeTime } from '$lib/relative-time';
  import CopyPointerButton from './CopyPointerButton.svelte';
  import LoadingHint from './LoadingHint.svelte';
  import HeartButton from './HeartButton.svelte';

  type EditRevision = {
    edit: Event;
    index: number;
    lines: DiffLine[];
    hasChanges: boolean;
    relative: string;
    absolute: string;
  };

  interface Props {
    event: Event;
    /** Extra sources known at the call site (merged with tracked provenance). */
    found?: string | string[];
    /** When set, offer EPUB / PDF / Asciidoc download in the ⋯ menu. */
    getSeedEvents?: () => Event[];
    canExport?: boolean;
  }

  let { event, found, getSeedEvents, canExport = false }: Props = $props();
  const replyOpen = $derived($opComposeId === event.id.toLowerCase());
  const canReply = $derived(!!$session.pubkey);

  let noteEditState = $state<ShortNoteEditState | null>(null);
  let noteEditTick = $state(0);

  $effect(() => {
    const ev = event;
    if (ev.kind !== KIND.TEXT_NOTE) {
      noteEditState = null;
      return;
    }
    return onShortNoteEdits(ev.id, () => {
      noteEditTick += 1;
    });
  });

  $effect(() => {
    const ev = event;
    void noteEditTick;
    if (ev.kind !== KIND.TEXT_NOTE) {
      noteEditState = null;
      return;
    }
    let cancelled = false;
    void shortNoteEditState(ev).then((state) => {
      if (!cancelled) noteEditState = state;
    });
    return () => {
      cancelled = true;
    };
  });

  /** Each author 1010 in time order, diffed against the previous text (original → … → latest). */
  const editRevisions = $derived.by((): EditRevision[] => {
    if (event.kind !== KIND.TEXT_NOTE || !noteEditState?.authorEdits.length) return [];
    const out: EditRevision[] = [];
    let prev = event.content ?? '';
    let n = 0;
    for (const edit of noteEditState.authorEdits) {
      const next = edit.content ?? '';
      if (next === prev) continue;
      n += 1;
      const lines = diffLines(prev, next);
      out.push({
        edit,
        index: n,
        lines,
        hasChanges: diffHasChanges(lines),
        relative: formatRelativeTime(edit.created_at),
        absolute: formatAbsoluteTime(edit.created_at)
      });
      prev = next;
    }
    return out;
  });
  const showEditDiffs = $derived(
    event.kind === KIND.TEXT_NOTE &&
      isShortNoteEdited(event, noteEditState?.latestAuthorEdit) &&
      editRevisions.length > 0
  );

  $effect(() => registerOpReplyToolbar(event.id));

  function onReplyClick(): void {
    if (!canReply) {
      openLoginDialog();
      return;
    }
    toggleOpCompose(event.id);
  }
  /** NIP-01 coordinate — only replaceable (`kind:pubkey`) and addressable (`kind:pubkey:d`). */
  const coord = $derived(replaceableCoord(event));
  const sources = $derived.by(() => {
    const tracked = eventSources(event.id);
    const extra = !found ? [] : Array.isArray(found) ? found : found.split(/[\n,]+/).map((s) => s.trim());
    const set = new Set([...tracked, ...extra].filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b));
  });

  const formats: { format: PublicationDownloadFormat; label: string }[] = [
    { format: 'epub', label: 'EPUB' },
    { format: 'pdf', label: 'PDF' },
    { format: 'adoc', label: 'Asciidoc' }
  ];

  let busy = $state<PublicationDownloadFormat | null>(null);
  let error = $state<string | null>(null);
  const formatLabel = $derived(
    busy === 'epub' ? 'EPUB' : busy === 'pdf' ? 'PDF' : busy === 'adoc' ? 'Asciidoc' : null
  );

  async function onExport(format: PublicationDownloadFormat): Promise<void> {
    if (!canExport || busy) return;
    busy = format;
    error = null;
    try {
      await exportPublicationDownload(event, format, getSeedEvents?.() ?? []);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = null;
    }
  }
</script>

<div class="details-panel-wrap">
  <div class="details-toolbar">
    <HeartButton {event} />
    <button
      class="btn btn-icon icon-action-btn thread-reply"
      type="button"
      aria-label={canReply ? 'Reply' : 'Sign in to reply'}
      title={canReply ? 'Reply' : 'Sign in to reply'}
      aria-expanded={replyOpen}
      onclick={onReplyClick}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          fill="currentColor"
          d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"
        />
      </svg>
    </button>
    <CopyPointerButton {event} class="details-more-menu">
      {#snippet after()}
        {#if canExport}
          <li class="menu-sep" role="separator"></li>
          <li class="menu-heading" role="presentation">Download</li>
          {#each formats as opt (opt.format)}
            <li role="none">
              <button
                class="menu-item"
                type="button"
                role="menuitem"
                disabled={!!busy}
                onclick={() => void onExport(opt.format)}
              >
                {busy === opt.format ? `Exporting ${opt.label}…` : opt.label}
              </button>
            </li>
          {/each}
        {/if}
      {/snippet}
    </CopyPointerButton>
  </div>
  <details class="accordion details-panel">
    <summary>Details</summary>
    <dl class="details-list">
      <dt>Event id</dt>
      <dd><code>{event.id}</code></dd>
      {#if coord}
        <dt>Coordinate</dt>
        <dd><code>{coord}</code></dd>
      {/if}
      <dt>Where it was found</dt>
      <dd>
        {#if sources.length}
          <ul class="found-list">
            {#each sources as source}
              <li><code title={source}>{cropRenderedUrlsInText(source)}</code></li>
            {/each}
          </ul>
        {:else}
          <span class="muted">Not yet observed on a relay</span>
        {/if}
      </dd>
      {#if showEditDiffs}
        <dt>Edits</dt>
        <dd class="details-edits">
          <ol class="details-edit-list">
            {#each editRevisions as rev (rev.edit.id)}
              <li class="details-edit-item">
                <p class="details-edit-meta muted">
                  #{rev.index}
                  · kind 1010
                  {#if rev.relative}
                    ·
                    <time
                      datetime={new Date(rev.edit.created_at * 1000).toISOString()}
                      title={rev.absolute}>{rev.relative}</time
                    >
                  {/if}
                  · <code title={rev.edit.id}>{rev.edit.id.slice(0, 12)}…</code>
                </p>
                {#if rev.hasChanges}
                  <pre
                    class="details-edit-diff"
                    aria-label={`Diff for edit ${rev.index}`}
                  ><code
                      >{#each rev.lines as line, i (i)}<span
                          class="diff-line"
                          class:diff-add={line.type === 'add'}
                          class:diff-del={line.type === 'del'}
                          class:diff-same={line.type === 'same'}
                          >{line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}{line.text}
</span>{/each}</code
                    ></pre
                  >
                {:else}
                  <p class="muted details-edit-empty">No line changes.</p>
                {/if}
              </li>
            {/each}
          </ol>
        </dd>
      {/if}
    </dl>
  </details>
  {#if busy && formatLabel}
    <LoadingHint message="Exporting {formatLabel}… This can take a minute." compact />
  {:else if error}
    <p class="details-export-error" role="alert">{error}</p>
  {/if}
</div>
