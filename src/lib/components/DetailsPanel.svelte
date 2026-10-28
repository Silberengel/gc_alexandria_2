<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import { pruneToLatestReplaceables, replaceableCoord } from '$lib/nostr/replaceable';
  import { eventSources } from '$lib/nostr/event-sources';
  import {
    exportPublicationDownload,
    type PublicationDownloadFormat
  } from '$lib/publication-export';
  import {
    republishPublicationToWriteRelays,
    type RepublishProgress
  } from '$lib/publication-republish';
  import { cropRenderedUrlsInText } from '$lib/crop-url';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { showNotice } from '$lib/stores/toast';
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
  import AppHandlerIcon from './AppHandlerIcon.svelte';
  import UserBadge from './UserBadge.svelte';
  import { uniqueAppHandlers } from '$lib/app-handlers';
  import { muteState, filterMuted } from '$lib/mute';
  import { displayTitle, libraryDocumentPath } from '$lib/metadata';
  import { mercuryFilter } from '$lib/nostr/mercury';
  import { relayPool } from '$lib/nostr/pool';
  import { wikiStack } from '$lib/nostr/selector';
  import { eventAddress } from '$lib/nostr/verify';
  import { fetchByAddress, fetchById } from '$lib/nostr/fetch';
  import { rememberEvents } from '$lib/nostr/event-memory';
  import {
    getWikiForkTarget,
    isWikiOrSpecKind,
    uniqueWikiForks,
    wikiForkOriginHref
  } from '$lib/wiki-fork';

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
    /** NIP-89 kind-31990 handlers that advertise this work / kind (not social responses). */
    appHandlers?: Event[];
    /**
     * Metadata list only — nest inside another Details accordion (e.g. reader profile).
     * Skips toolbar, heart/reply, and the outer Details summary.
     */
    embedded?: boolean;
  }

  let {
    event,
    found,
    getSeedEvents,
    canExport = false,
    appHandlers = [],
    embedded = false
  }: Props = $props();
  const apps = $derived(uniqueAppHandlers(filterMuted(appHandlers, $muteState)));
  const replyOpen = $derived($opComposeId === event.id.toLowerCase());
  const canReply = $derived(!!$session.pubkey);
  const showWikiForks = $derived(isWikiOrSpecKind(event.kind));
  /** Signed-in readers can fan out a 30040 tree to their write relays. */
  const showRepublish = $derived(event.kind === KIND.PUBLICATION && !!$session.pubkey);

  let noteEditState = $state<ShortNoteEditState | null>(null);
  let noteEditTick = $state(0);
  let forksFrom = $state<Event | null>(null);
  let forksFromHref = $state<string | null>(null);
  let forksOf = $state<Event[]>([]);
  let forksLoading = $state(false);
  let forkCompareId = $state<string | null>(null);

  $effect(() => {
    const ev = event;
    if (!isWikiOrSpecKind(ev.kind)) {
      forksFrom = null;
      forksFromHref = null;
      forksOf = [];
      forksLoading = false;
      forkCompareId = null;
      return;
    }
    let cancelled = false;
    forksLoading = true;
    forksFrom = null;
    forksFromHref = null;
    forksOf = [];
    forkCompareId = null;
    void loadWikiForks(ev).then((hit) => {
      if (cancelled) return;
      forksFrom = hit.origin;
      forksFromHref = hit.originHref;
      forksOf = hit.forks;
      forksLoading = false;
    });
    return () => {
      cancelled = true;
    };
  });

  async function loadWikiForks(target: Event): Promise<{
    origin: Event | null;
    originHref: string | null;
    forks: Event[];
  }> {
    const addr = eventAddress(target);
    const dTag = target.tags.find((t) => t[0] === 'd')?.[1];
    const filters = [
      { kinds: [KIND.WIKI, KIND.SPEC], '#a': [addr], limit: 40 },
      { kinds: [KIND.WIKI, KIND.SPEC], '#e': [target.id], limit: 40 },
      ...(dTag ? [{ kinds: [KIND.WIKI, KIND.SPEC], '#d': [dTag], limit: 40 }] : [])
    ];
    const batches = await Promise.all(
      filters.map((filter) => mercuryFilter(filter).catch(() => [] as Event[]))
    );
    const byId = new Map<string, Event>();
    for (const batch of batches) for (const e of batch) byId.set(e.id, e);
    if (byId.size < 2) {
      const relayHits = await relayPool.query(wikiStack(), filters, 4000).catch(() => [] as Event[]);
      for (const e of relayHits) byId.set(e.id, e);
    }
    const candidates = pruneToLatestReplaceables([...byId.values()]);
    rememberEvents(candidates);
    const forks = uniqueWikiForks(candidates, target);

    const ref = getWikiForkTarget(target);
    let origin: Event | null = null;
    if (ref?.eventId) {
      origin = await fetchById(ref.eventId, {
        hintRelays: ref.relayHint ? [ref.relayHint] : undefined
      });
    }
    if (!origin && ref?.coordinate) {
      origin = await fetchByAddress(ref.coordinate, {
        hintRelays: ref.relayHint ? [ref.relayHint] : undefined
      });
    }
    if (origin) rememberEvents([origin]);
    return {
      origin,
      originHref: wikiForkOriginHref(origin, ref ?? undefined),
      forks
    };
  }

  function forkHref(ev: Event): string {
    return `#${libraryDocumentPath(ev)}`;
  }

  function forkDiffLines(other: Event): DiffLine[] {
    return diffLines(event.content ?? '', other.content ?? '');
  }

  function toggleForkCompare(id: string): void {
    forkCompareId = forkCompareId === id ? null : id;
  }

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

  $effect(() => {
    if (embedded) return;
    return registerOpReplyToolbar(event.id);
  });

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
  let republishing = $state(false);
  let republishProgress = $state<RepublishProgress | null>(null);
  const formatLabel = $derived(
    busy === 'epub' ? 'EPUB' : busy === 'pdf' ? 'PDF' : busy === 'adoc' ? 'Asciidoc' : null
  );

  async function onExport(format: PublicationDownloadFormat): Promise<void> {
    if (!canExport || busy || republishing) return;
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

  async function onRepublish(): Promise<void> {
    if (!showRepublish || busy || republishing) return;
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    republishing = true;
    error = null;
    republishProgress = {
      phase: 'collecting',
      done: 0,
      total: 0,
      message: 'Collecting publication indexes and sections…'
    };
    try {
      const result = await republishPublicationToWriteRelays(event, {
        seedEvents: getSeedEvents?.() ?? [],
        onProgress: (p) => {
          republishProgress = p;
        }
      });
      showNotice(result.error ?? republishProgress?.message ?? 'Done.', result.ok);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      error = message;
      showNotice(message);
    } finally {
      republishing = false;
    }
  }
</script>

{#snippet detailsList()}
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
    {#if apps.length}
      <dt>Apps</dt>
      <dd>
        <p class="details-apps">
          {#each apps.slice(0, 24) as app, i (app.event.id)}
            {#if i > 0}<span class="details-apps-sep" aria-hidden="true">·</span>{/if}
            <AppHandlerIcon {app} />
          {/each}
          {#if apps.length > 24}
            <span class="details-apps-sep" aria-hidden="true">·</span>
            <span class="muted">+{apps.length - 24}</span>
          {/if}
        </p>
      </dd>
    {/if}
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
      {#if showWikiForks}
        <dt>Forked from</dt>
        <dd class="details-forks">
          {#if forksLoading && !forksFrom && !forksFromHref}
            <span class="muted">Looking up origin…</span>
          {:else if forksFrom || forksFromHref}
            <div class="details-fork-row">
              {#if forksFromHref}
                <a
                  class="details-fork-title"
                  href={forksFromHref.startsWith('#') ? forksFromHref : `#${forksFromHref}`}
                  use:link
                  >{forksFrom ? displayTitle(forksFrom) : 'Origin article'}</a
                >
              {:else if forksFrom}
                <a class="details-fork-title" href={forkHref(forksFrom)} use:link
                  >{displayTitle(forksFrom)}</a
                >
              {/if}
              {#if forksFrom}
                <span class="muted">by</span>
                <UserBadge pubkey={forksFrom.pubkey} compact />
                <button
                  class="btn details-fork-compare"
                  type="button"
                  aria-expanded={forkCompareId === forksFrom.id}
                  onclick={() => toggleForkCompare(forksFrom!.id)}
                  >{forkCompareId === forksFrom.id ? 'Hide differences' : 'Show differences'}</button
                >
                {#if forkCompareId === forksFrom.id}
                  {@const lines = forkDiffLines(forksFrom)}
                  {#if diffHasChanges(lines)}
                    <pre
                      class="details-edit-diff details-fork-diff"
                      aria-label="Diff against origin"
                    ><code
                        >{#each lines as line, i (i)}<span
                            class="diff-line"
                            class:diff-add={line.type === 'add'}
                            class:diff-del={line.type === 'del'}
                            class:diff-same={line.type === 'same'}
                            >{line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}{line.text}
</span>{/each}</code
                      ></pre
                    >
                  {:else}
                    <p class="muted details-edit-empty">No content differences.</p>
                  {/if}
                {/if}
              {/if}
            </div>
          {:else}
            <span class="muted">Not a fork of another page</span>
          {/if}
        </dd>
        <dt>Forks of this page</dt>
        <dd class="details-forks">
          {#if forksLoading && !forksOf.length}
            <span class="muted">Looking up forks…</span>
          {:else if forksOf.length}
            <ul class="details-fork-list">
              {#each forksOf as fork (fork.id)}
                <li class="details-fork-row">
                  <a class="details-fork-title" href={forkHref(fork)} use:link
                    >{displayTitle(fork)}</a
                  >
                  <span class="muted">by</span>
                  <UserBadge pubkey={fork.pubkey} compact />
                  <button
                    class="btn details-fork-compare"
                    type="button"
                    aria-expanded={forkCompareId === fork.id}
                    onclick={() => toggleForkCompare(fork.id)}
                    >{forkCompareId === fork.id ? 'Hide differences' : 'Show differences'}</button
                  >
                  {#if forkCompareId === fork.id}
                    {@const lines = forkDiffLines(fork)}
                    {#if diffHasChanges(lines)}
                      <pre
                        class="details-edit-diff details-fork-diff"
                        aria-label={`Diff against fork ${displayTitle(fork)}`}
                      ><code
                          >{#each lines as line, i (i)}<span
                              class="diff-line"
                              class:diff-add={line.type === 'add'}
                              class:diff-del={line.type === 'del'}
                              class:diff-same={line.type === 'same'}
                              >{line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}{line.text}
</span>{/each}</code
                        ></pre
                      >
                    {:else}
                      <p class="muted details-edit-empty">No content differences.</p>
                    {/if}
                  {/if}
                </li>
              {/each}
            </ul>
          {:else}
            <span class="muted">No known forks</span>
          {/if}
        </dd>
      {/if}
  </dl>
{/snippet}

{#if embedded}
  {@render detailsList()}
{:else}
  <div class="details-panel-wrap">
    <div class="details-toolbar">
      <HeartButton {event} />
      <button
        class="btn btn-icon icon-action-btn thread-reply"
        type="button"
        aria-label={canReply ? (replyOpen ? 'Cancel reply' : 'Reply') : 'Sign in to reply'}
        title={canReply ? (replyOpen ? 'Cancel reply' : 'Reply') : 'Sign in to reply'}
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
          {#if showRepublish}
            <li class="menu-sep" role="separator"></li>
            <li class="menu-heading" role="presentation">Relays</li>
            <li role="none">
              <button
                class="menu-item"
                type="button"
                role="menuitem"
                disabled={!!busy || republishing}
                onclick={() => void onRepublish()}
              >
                {republishing ? 'Republishing…' : 'Republish entire publication'}
              </button>
            </li>
          {/if}
          {#if canExport}
            <li class="menu-sep" role="separator"></li>
            <li class="menu-heading" role="presentation">Download</li>
            {#each formats as opt (opt.format)}
              <li role="none">
                <button
                  class="menu-item"
                  type="button"
                  role="menuitem"
                  disabled={!!busy || republishing}
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
    {#if showRepublish}
      <div class="details-republish">
        <button
          class="btn"
          type="button"
          disabled={!!busy || republishing}
          onclick={() => void onRepublish()}
        >
          {republishing ? 'Republishing…' : 'Republish entire publication'}
        </button>
        <p class="muted details-republish-hint">
          Writes this index and every linked section to your outboxes in the background.
        </p>
      </div>
    {/if}
    <details class="accordion details-panel">
      <summary>Details</summary>
      {@render detailsList()}
    </details>
    {#if republishing && republishProgress}
      <LoadingHint message={republishProgress.message} compact />
    {:else if busy && formatLabel}
      <LoadingHint message="Exporting {formatLabel}… This can take a minute." compact />
    {:else if error}
      <p class="details-export-error" role="alert">{error}</p>
    {/if}
  </div>
{/if}
