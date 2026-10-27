<script lang="ts">
  import {
    MAX_LEAF_BYTES,
    applyIdealPublicationSplit,
    exposeStructureForIdealSplit,
    formatIdealSplitNote,
    parsePublicationAsciiDoc,
    previewIdealSplitGhosts,
    type IdealSplitGhost,
    type PublicationIndexDepth,
    type PublicationSplitNode,
    type PublicationSplitResult
  } from '$lib/publication-asciidoc-split';
  import type { PublishProgress } from '$lib/publication-publish';
  import { KIND } from '$lib/constants';

  interface Props {
    source?: string;
    maxIndexLevel?: PublicationIndexDepth;
    rootTitle?: string;
    rootDTag?: string;
    publishing?: boolean;
    progress?: PublishProgress | null;
    /** d-tags still missing after publish — show Retry. */
    missingDTags?: string[];
    onRetryFailed?: () => void;
    onClose?: () => void;
    onApplyIdeal?: (next: { source: string; maxIndexLevel: PublicationIndexDepth }) => void;
  }

  let {
    source = $bindable(''),
    maxIndexLevel = $bindable<PublicationIndexDepth>(2),
    rootTitle = 'Untitled',
    rootDTag = '',
    publishing = false,
    progress = null,
    missingDTags = [],
    onRetryFailed,
    onClose,
    onApplyIdeal
  }: Props = $props();

  let sourceEl = $state<HTMLTextAreaElement | null>(null);
  let idealNote = $state('');
  /** Snapshot of source/depth when `idealNote` was set — clear the note once either drifts. */
  let idealNoteAt = $state<{ source: string; depth: PublicationIndexDepth } | null>(null);

  /**
   * Outline matches Index depth + raw editor buffer (same inputs publish uses).
   * Ideal expose is preview-only so we never hide oversize leaves that publish
   * would still hit at the current depth.
   */
  const parsed = $derived.by((): PublicationSplitResult =>
    parsePublicationAsciiDoc(source, {
      rootTitle,
      rootDTag: rootDTag || undefined,
      maxIndexLevel
    })
  );

  const idealExpose = $derived(
    exposeStructureForIdealSplit(source, {
      rootTitle,
      rootDTag: rootDTag || undefined,
      maxIndexLevel
    })
  );
  const idealDepthRaised = $derived(idealExpose.maxIndexLevel > maxIndexLevel);
  const idealDepthLabel = $derived(
    idealExpose.maxIndexLevel <= 2
      ? '== chapters'
      : idealExpose.maxIndexLevel === 3
        ? '=== sections'
        : '==== deep'
  );
  const idealParsed = $derived.by((): PublicationSplitResult =>
    parsePublicationAsciiDoc(idealExpose.source, {
      rootTitle,
      rootDTag: rootDTag || undefined,
      maxIndexLevel: idealExpose.maxIndexLevel
    })
  );
  /** Ghosts after Ideal’s expose pass (what Apply will pack). */
  const idealGhosts = $derived(
    previewIdealSplitGhosts(idealParsed, idealExpose.maxIndexLevel)
  );
  /**
   * Attach ghosts to the visible tree only when depth already matches Ideal.
   * Otherwise parents would be mansions while Ideal packs chapters.
   */
  const ghosts = $derived(idealDepthRaised ? [] : idealGhosts);
  const idealSectionsPlanned = $derived(
    idealGhosts.reduce((n, g) => n + g.sections.length, 0)
  );
  const ghostByParent = $derived.by(() => {
    const m = new Map<string, IdealSplitGhost>();
    for (const g of ghosts) m.set(`${g.parentSourceLine}:${g.parentTitle}`, g);
    return m;
  });

  $effect(() => {
    if (!idealNoteAt) return;
    if (source !== idealNoteAt.source || maxIndexLevel !== idealNoteAt.depth) {
      idealNote = '';
      idealNoteAt = null;
    }
  });

  function formatKiB(bytes: number): string {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }

  function selectHeading(line: number): void {
    if (!sourceEl || line <= 0) return;
    const lines = source.split('\n');
    let start = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i += 1) {
      start += (lines[i]?.length ?? 0) + 1;
    }
    const end = start + (lines[line - 1]?.length ?? 0);
    sourceEl.focus();
    sourceEl.setSelectionRange(start, end);
    // Scroll roughly into view
    const ratio = (line - 1) / Math.max(1, lines.length);
    sourceEl.scrollTop = ratio * sourceEl.scrollHeight;
  }

  function applyIdeal(): void {
    const result = applyIdealPublicationSplit(source, {
      rootTitle,
      rootDTag: rootDTag || undefined,
      maxIndexLevel
    });
    source = result.source;
    maxIndexLevel = result.maxIndexLevel;
    idealNote = formatIdealSplitNote(result);
    idealNoteAt = { source: result.source, depth: result.maxIndexLevel };
    onApplyIdeal?.({ source: result.source, maxIndexLevel: result.maxIndexLevel });
  }

  function ghostFor(node: PublicationSplitNode): IdealSplitGhost | undefined {
    return ghostByParent.get(`${node.sourceLine}:${node.title}`);
  }
</script>

{#snippet treeNode(node: PublicationSplitNode, depth: number)}
  {@const over = node.kind === KIND.SECTION && node.contentBytes > MAX_LEAF_BYTES}
  {@const ghost = over ? ghostFor(node) : undefined}
  <li class="pub-split-node" style={`--depth: ${depth}`}>
    <button
      type="button"
      class="pub-split-row"
      class:is-over={over}
      class:is-root={node.level === 0}
      onclick={() => selectHeading(node.sourceLine)}
    >
      <span class="pub-split-kind" class:is-index={node.kind === KIND.PUBLICATION}
        >{node.kind}</span
      >
      <span class="pub-split-title">{node.title}</span>
      <code class="pub-split-d">{node.dTag}</code>
      {#if node.kind === KIND.SECTION}
        <span class="pub-split-size" class:is-over={over}>{formatKiB(node.contentBytes)}</span>
      {/if}
      {#if over}
        <span class="pub-split-flag">needs split</span>
      {/if}
    </button>
    {#if ghost}
      <ul class="pub-split-ghosts" aria-label="Proposed ideal split">
        {#each ghost.sections as sec}
          <li class="pub-split-ghost">
            <span class="pub-split-kind is-ghost">30041</span>
            <span class="pub-split-title muted">{sec.title}</span>
            <span class="pub-split-size muted">~{formatKiB(sec.bytes)}</span>
          </li>
        {/each}
      </ul>
    {/if}
    {#if node.children.length}
      <ul class="pub-split-children">
        {#each node.children as child (child.dTag + child.sourceLine)}
          {@render treeNode(child, depth + 1)}
        {/each}
      </ul>
    {/if}
  </li>
{/snippet}

<div class="pub-split-editor" role="dialog" aria-modal="true" aria-label="Publication AsciiDoc splitter">
  <header class="pub-split-toolbar">
    <div class="pub-split-toolbar-main">
      <strong>Split from AsciiDoc</strong>
      <span class="muted pub-split-summary">
        {parsed.sectionCount} section{parsed.sectionCount === 1 ? '' : 's'} · {parsed.indexCount}
        nested index{parsed.indexCount === 1 ? '' : 'es'}
        {#if parsed.oversizeLeaves.length}
          · <span class="pub-split-warn">{parsed.oversizeLeaves.length} over 50 KiB</span>
        {/if}
      </span>
    </div>
    <div class="pub-split-toolbar-actions">
      <label class="pub-split-depth">
        <span class="muted">Index depth</span>
        <select
          value={String(maxIndexLevel)}
          disabled={publishing}
          onchange={(e) => {
            const n = Number((e.currentTarget as HTMLSelectElement).value);
            maxIndexLevel = (n === 3 || n === 4 ? n : 2) as PublicationIndexDepth;
          }}
        >
          <option value="2">== chapters</option>
          <option value="3">=== sections</option>
          <option value="4">==== deep</option>
        </select>
      </label>
      <button
        type="button"
        class="btn btn-primary"
        disabled={publishing}
        title="Raise index depth to expose nested headings, then insert Section 1…N under any leaf still over 50 KiB"
        onclick={applyIdeal}
      >
        Apply ideal split
      </button>
      {#if onRetryFailed}
        <button type="button" class="btn" disabled={publishing} onclick={() => onRetryFailed()}>
          Retry failed
        </button>
      {/if}
      <button type="button" class="btn" disabled={publishing} onclick={() => onClose?.()}>Done</button>
    </div>
  </header>

  {#if idealNote}
    <p class="muted pub-split-ideal-note">{idealNote}</p>
  {:else if idealDepthRaised}
    <p class="muted pub-split-ideal-note">
      Ideal will raise Index depth to {idealDepthLabel}
      {#if idealSectionsPlanned > 0}
        and insert {idealSectionsPlanned} section(s) under oversize leaves
      {:else}
        ; nested headings become separate leaves and none exceed 50 KiB
      {/if}. Publish still uses the depth above until you Apply.
    </p>
  {/if}

  {#if progress}
    <p class="pub-split-progress" role="status">
      {progress.message}
      {#if progress.total}
        <span class="muted">({progress.done}/{progress.total})</span>
      {/if}
    </p>
  {/if}

  {#if missingDTags.length}
    <p class="pub-split-missing" role="alert">
      Missing on relays: {missingDTags.slice(0, 12).join(', ')}{missingDTags.length > 12
        ? '…'
        : ''}
    </p>
  {/if}

  {#if parsed.warnings.length}
    <ul class="pub-split-warnings">
      {#each parsed.warnings as w, i (i)}
        <li class:is-error={w.code === 'oversize_leaf' || w.code === 'document_title'}>
          {w.message}
        </li>
      {/each}
    </ul>
  {/if}

  <div class="pub-split-panes">
    <section class="pub-split-pane" aria-label="AsciiDoc source">
      <div class="pub-split-pane-label">AsciiDoc</div>
      <textarea
        bind:this={sourceEl}
        class="pub-split-source"
        bind:value={source}
        disabled={publishing}
        placeholder={'== Chapter one\n\nBody…\n\n== Chapter two\n\n…'}
        spellcheck="true"
      ></textarea>
    </section>
    <section class="pub-split-pane" aria-label="Publication structure">
      <div class="pub-split-pane-label">Publication tree</div>
      <ul class="pub-split-tree">
        {@render treeNode(parsed.root, 0)}
      </ul>
    </section>
  </div>
</div>

<style>
  .pub-split-editor {
    position: fixed;
    inset: 0;
    z-index: 120;
    display: flex;
    flex-direction: column;
    background: var(--paper-light, #f7f4ef);
    color: var(--ink, #1a1a1a);
    padding: 0.75rem 1rem 1rem;
    gap: 0.5rem;
  }
  .pub-split-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .pub-split-toolbar-main {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.65rem;
  }
  .pub-split-toolbar-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem;
  }
  .pub-split-depth {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.85rem;
  }
  .pub-split-depth select {
    font: inherit;
  }
  .pub-split-warn {
    color: #a33;
    font-weight: 600;
  }
  .pub-split-ideal-note,
  .pub-split-progress,
  .pub-split-missing {
    margin: 0;
    font-size: 0.9rem;
  }
  .pub-split-missing {
    color: #a33;
    font-weight: 600;
  }
  .pub-split-warnings {
    margin: 0;
    padding: 0.35rem 0.75rem;
    list-style: disc;
    font-size: 0.85rem;
    background: color-mix(in srgb, #c44 12%, transparent);
    border-radius: 0.35rem;
  }
  .pub-split-warnings .is-error {
    font-weight: 600;
  }
  .pub-split-panes {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }
  @media (max-width: 860px) {
    .pub-split-panes {
      grid-template-columns: 1fr;
      grid-template-rows: 1fr 1fr;
    }
  }
  .pub-split-pane {
    min-height: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid color-mix(in srgb, var(--rule, #ccc) 70%, transparent);
    border-radius: 0.45rem;
    background: var(--paper, #fff);
    overflow: hidden;
  }
  .pub-split-pane-label {
    font-size: 0.72rem;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0.35rem 0.65rem;
    border-bottom: 1px solid color-mix(in srgb, var(--rule, #ccc) 50%, transparent);
  }
  .pub-split-source {
    flex: 1;
    width: 100%;
    border: 0;
    resize: none;
    padding: 0.65rem;
    font-family: var(--mono-font, ui-monospace, monospace);
    font-size: 0.85rem;
    line-height: 1.45;
    background: transparent;
    color: inherit;
  }
  .pub-split-tree,
  .pub-split-children,
  .pub-split-ghosts {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .pub-split-tree {
    flex: 1;
    overflow: auto;
    padding: 0.4rem 0.35rem 0.75rem;
  }
  .pub-split-node {
    margin: 0;
  }
  .pub-split-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.35rem 0.55rem;
    width: 100%;
    text-align: left;
    border: 0;
    background: transparent;
    font: inherit;
    cursor: pointer;
    padding: 0.28rem 0.4rem;
    padding-left: calc(0.4rem + var(--depth, 0) * 0.85rem);
    border-radius: 0.3rem;
  }
  .pub-split-row:hover {
    background: color-mix(in srgb, var(--accent, #3b6) 8%, transparent);
  }
  .pub-split-row.is-over {
    background: color-mix(in srgb, #c44 10%, transparent);
  }
  .pub-split-kind {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    padding: 0.1rem 0.35rem;
    border-radius: 0.25rem;
    background: color-mix(in srgb, var(--ink, #111) 8%, transparent);
  }
  .pub-split-kind.is-index {
    background: color-mix(in srgb, var(--accent, #3b6) 22%, transparent);
  }
  .pub-split-kind.is-ghost {
    opacity: 0.65;
    border: 1px dashed color-mix(in srgb, var(--rule, #999) 80%, transparent);
    background: transparent;
  }
  .pub-split-title {
    font-weight: 600;
  }
  .pub-split-d {
    font-size: 0.75rem;
    opacity: 0.75;
  }
  .pub-split-size {
    font-size: 0.78rem;
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }
  .pub-split-size.is-over {
    color: #a33;
    font-weight: 700;
  }
  .pub-split-flag {
    font-size: 0.72rem;
    font-weight: 700;
    color: #a33;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .pub-split-ghosts {
    margin: 0 0 0.25rem;
    padding-left: calc(1.2rem + var(--depth, 0) * 0.85rem);
  }
  .pub-split-ghost {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.35rem 0.55rem;
    padding: 0.15rem 0.4rem;
    border-left: 2px dashed color-mix(in srgb, var(--rule, #999) 70%, transparent);
    opacity: 0.85;
    font-size: 0.9em;
  }
</style>
