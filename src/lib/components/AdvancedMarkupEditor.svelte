<script lang="ts">
  import { tick } from 'svelte';
  import type { Event as NostrEvent } from 'nostr-tools';
  import ComposeGrammarTextarea from './ComposeGrammarTextarea.svelte';
  import EventCard from './EventCard.svelte';
  import UserBadge from './UserBadge.svelte';
  import { grammarLanguageOptions, type GrammarIssue } from '$lib/compose-grammar';
  import { expandCustomEmojiPlaceholders, prepareContentWithEmojis } from '$lib/emoji-content';
  import { renderFormat } from '$lib/markup';
  import { fetchByAddress, fetchById } from '$lib/nostr/fetch';
  import {
    coalesceInlineMentions,
    expandNostrRefPlaceholders,
    protectNostrRefsForMarkup,
    type InlineBodyBlock
  } from '$lib/nostr-refs';
  import { activeMention, insertMention, type MentionCandidate } from '$lib/mention';
  import { searchMentions } from '$lib/mention-search';
  import { editMarkup, editMedia, type MarkupTool, type MediaFile, type SourceEdit } from '$lib/markup-editor';
  import { diffHasChanges, diffLines, type DiffLine } from '$lib/text-diff';

  export type DraftRevisionEntry = {
    created_at: number;
    content: string;
    id?: string;
    kind?: number;
  };

  interface Props {
    content?: string;
    format: 'djot' | 'asciidoc';
    placeholder?: string;
    issues?: GrammarIssue[];
    checkedSource?: string;
    grammarOn?: boolean;
    grammarLang?: string;
    grammarBusy?: boolean;
    onApply?: (issue: GrammarIssue, replacement: string) => void;
    onClose?: () => void;
    onFormat?: (format: 'djot' | 'asciidoc') => void;
    /** Blossom upload. Returns the published file so the URL can be inserted as markup. */
    onUploadMedia?: (file: File) => Promise<MediaFile>;
    uploading?: boolean;
    /** NIP-37 checkpoint chain (oldest → newest) for History diffs. */
    revisionHistory?: DraftRevisionEntry[];
  }

  let {
    content = $bindable(''),
    format,
    placeholder = '',
    issues = [],
    checkedSource = '',
    grammarOn = $bindable(false),
    grammarLang = $bindable('en-US'),
    grammarBusy = false,
    onApply,
    onClose,
    onFormat,
    onUploadMedia,
    uploading = false,
    revisionHistory = []
  }: Props = $props();

  let historyOpen = $state(false);

  type HistoryRevision = {
    index: number;
    created_at: number;
    id?: string;
    kind?: number;
    lines: DiffLine[];
    hasChanges: boolean;
  };

  const historyRevisions = $derived.by((): HistoryRevision[] => {
    if (!revisionHistory.length) return [];
    const out: HistoryRevision[] = [];
    let prev = '';
    let n = 0;
    for (const entry of revisionHistory) {
      const next = entry.content ?? '';
      if (next === prev && n > 0) continue;
      n += 1;
      const lines = diffLines(prev, next);
      out.push({
        index: n,
        created_at: entry.created_at,
        id: entry.id,
        kind: entry.kind,
        lines,
        hasChanges: diffHasChanges(lines)
      });
      prev = next;
    }
    return out;
  });

  function formatCheckpointTime(sec: number): string {
    try {
      return new Date(sec * 1000).toLocaleString();
    } catch {
      return String(sec);
    }
  }

  let sourceEl = $state<HTMLTextAreaElement | null>(null);
  let previewEl = $state<HTMLDivElement | null>(null);
  let blocks = $state<InlineBodyBlock[]>([]);
  let resolved = $state<Record<number, NostrEvent | null>>({});
  let uploadError = $state('');
  let caret = { start: 0, end: 0 };
  let mediaInput = $state<HTMLInputElement | undefined>(undefined);
  let mention = $state<{ start: number; query: string } | null>(null);
  let mentionHits = $state<MentionCandidate[]>([]);
  let mentionBusy = $state(false);
  let mentionIndex = $state(0);
  /** Latest mention list for listeners registered once on the textarea. */
  const mentionGate = {
    open: false,
    hits: [] as MentionCandidate[],
    index: 0
  };

  const adoc = $derived(format === 'asciidoc');
  const tools: { id: MarkupTool; label: string; title: string }[] = $derived(
    [
      {
        id: 'title' as const,
        label: 'Title',
        title: adoc ? 'Document title (= Title of the document)' : 'Document title (# Title of the document)'
      },
      {
        id: 'heading' as const,
        label: 'H',
        title: adoc ? 'Section header (== A second-level header)' : 'Section header (## A second-level header)'
      },
      { id: 'bold' as const, label: 'B', title: 'Bold (*)' },
      { id: 'italic' as const, label: 'I', title: 'Italic (_)' },
      { id: 'strike' as const, label: 'S', title: adoc ? 'Strikethrough ([.line-through]#)' : 'Strikethrough' },
      { id: 'underline' as const, label: 'U', title: adoc ? 'Underline ([.underline]#)' : 'Underline' },
      { id: 'highlight' as const, label: 'Mark', title: adoc ? 'Highlight (#)' : 'Highlight' },
      { id: 'superscript' as const, label: 'x²', title: 'Superscript (^)' },
      { id: 'subscript' as const, label: 'x₂', title: 'Subscript (~)' },
      { id: 'code' as const, label: 'Code', title: 'Inline code (`inline code`)' },
      {
        id: 'codeblock' as const,
        label: '```',
        title: adoc ? 'Source block ([source,json] ----)' : 'Source block (```json)'
      },
      {
        id: 'literal' as const,
        label: 'Lit',
        title: adoc ? 'Literal block (....)' : 'Literal block (unlabeled fence)'
      },
      {
        id: 'link' as const,
        label: 'Link',
        title: adoc ? 'Link (link:https://example.com[display text])' : 'Link ([display text](https://example.com))'
      },
      { id: 'xref' as const, label: 'Xref', title: adoc ? 'Cross reference (<<>>)' : 'Cross reference' },
      { id: 'kbd' as const, label: 'Kbd', title: 'Keyboard (kbd:[])' },
      { id: 'button' as const, label: 'Btn', title: 'Button (btn:[])' },
      { id: 'menu' as const, label: 'Menu', title: 'Menu (menu:[])' },
      {
        id: 'quote' as const,
        label: 'Quote',
        title: adoc ? 'Quote block ([quote] ____)' : 'Block quote ({source=…})'
      },
      {
        id: 'admonition' as const,
        label: 'NOTE',
        title: adoc
          ? 'Call-out: NOTE, TIP, IMPORTANT, CAUTION, WARNING'
          : 'Call-out: note, tip, important, caution, warning (::: note)'
      },
      { id: 'sidebar' as const, label: 'Side', title: adoc ? 'Sidebar (****)' : 'Sidebar' },
      { id: 'example' as const, label: 'Ex', title: adoc ? 'Example block (====)' : 'Example' },
      {
        id: 'list' as const,
        label: 'List',
        title: adoc ? 'Bulleted list (*, **, .)' : 'Bulleted list (*, nested 1. / *)'
      },
      {
        id: 'numbered' as const,
        label: '1.',
        title: adoc ? 'Numbered list (., .., *)' : 'Numbered list (1., nested 1. / *)'
      },
      {
        id: 'checklist' as const,
        label: 'Check',
        title: adoc ? 'Checklist (* [ ] / * [x])' : 'Checklist (- [ ] / - [x])'
      },
      {
        id: 'description' as const,
        label: 'Term',
        title: adoc ? 'Description list (term::)' : 'Definition list (: term)'
      },
      { id: 'table' as const, label: 'Table', title: adoc ? 'Table (.title + [cols] + |===)' : 'Table (|----|)' },
      { id: 'footnote' as const, label: 'Fn', title: adoc ? 'Footnote (footnote:[])' : 'Footnote' },
      { id: 'rule' as const, label: 'Rule', title: adoc ? 'Thematic break (' + "''')" : 'Horizontal rule' }
    ] satisfies { id: MarkupTool; label: string; title: string }[]
  );

  const langChoices = $derived(grammarLanguageOptions(grammarLang));
  const showPreview = $derived(content.trim().length > 0);

  $effect(() => {
    const src = content;
    const fmt = format;
    if (!src.trim()) {
      blocks = [];
      resolved = {};
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const { text: emojiReady, slots } = await prepareContentWithEmojis(src);
        const { text, refs } = protectNostrRefsForMarkup(emojiReady);
        const rendered = expandCustomEmojiPlaceholders(await renderFormat(fmt, text), slots);
        const segments = expandNostrRefPlaceholders(rendered, refs);
        if (cancelled) return;
        blocks = coalesceInlineMentions(segments);
        const found: Record<number, NostrEvent | null> = {};
        await Promise.all(
          segments.map(async (seg, index) => {
            if (seg.type !== 'ref') return;
            if ((seg.kind === 'nevent' || seg.kind === 'note') && seg.id) {
              found[index] = await fetchById(seg.id, {
                hintRelays: seg.relays,
                authorPubkey: seg.pubkey
              });
              return;
            }
            if (seg.kind === 'naddr' && seg.naddr) {
              found[index] = await fetchByAddress(
                `${seg.naddr.kind}:${seg.naddr.pubkey}:${seg.naddr.identifier}`,
                { hintRelays: seg.naddr.relays }
              );
            }
          })
        );
        if (!cancelled) resolved = found;
      })();
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });

  $effect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (mentionGate.open) {
        event.preventDefault();
        mention = null;
        mentionHits = [];
        return;
      }
      event.preventDefault();
      onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  });

  $effect(() => {
    sourceEl?.focus();
  });

  $effect(() => {
    mentionGate.open = mention !== null;
    mentionGate.hits = mentionHits;
    mentionGate.index = mentionIndex;
  });

  $effect(() => {
    const current = mention;
    if (!current || current.query.trim().length < 1) {
      mentionHits = [];
      mentionBusy = false;
      return;
    }
    const q = current.query;
    let cancelled = false;
    mentionBusy = true;
    const timer = setTimeout(() => {
      void searchMentions(q).then((hits) => {
        if (cancelled) return;
        mentionHits = hits;
        mentionBusy = false;
        mentionIndex = 0;
      });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });

  $effect(() => {
    const source = sourceEl;
    const preview = previewEl;
    if (!source || !preview) return;
    let echoSource = false;
    let echoPreview = false;
    let release = 0;

    const ratioOf = (el: HTMLElement) => {
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 1) return 0;
      return el.scrollTop / max;
    };
    const follow = (from: HTMLElement, to: HTMLElement, markEcho: () => void) => {
      const max = to.scrollHeight - to.clientHeight;
      const next = ratioOf(from) * Math.max(0, max);
      if (Math.abs(to.scrollTop - next) < 1) return;
      markEcho();
      to.scrollTop = next;
      cancelAnimationFrame(release);
      release = requestAnimationFrame(() => {
        echoSource = false;
        echoPreview = false;
      });
    };
    const fromSource = () => {
      if (echoSource) {
        echoSource = false;
        return;
      }
      follow(source, preview, () => {
        echoPreview = true;
      });
    };
    const fromPreview = () => {
      if (echoPreview) {
        echoPreview = false;
        return;
      }
      follow(preview, source, () => {
        echoSource = true;
      });
    };

    const keepPreviewHere = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest('a, .event-embed-card')) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const rememberCaret = () => {
      caret = { start: source.selectionStart ?? 0, end: source.selectionEnd ?? 0 };
      syncMention(source);
    };
    const onSourceKeyDown = (event: KeyboardEvent) => {
      if (!mentionGate.open) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        mention = null;
        mentionHits = [];
        return;
      }
      const hits = mentionGate.hits;
      if (!hits.length) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        mentionIndex = (mentionGate.index + 1) % hits.length;
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        mentionIndex = (mentionGate.index - 1 + hits.length) % hits.length;
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        const hit = hits[mentionGate.index];
        if (!hit) return;
        event.preventDefault();
        void chooseMention(hit);
      }
    };
    source.addEventListener('keydown', onSourceKeyDown);
    source.addEventListener('keyup', rememberCaret);
    source.addEventListener('mouseup', rememberCaret);
    source.addEventListener('select', rememberCaret);
    source.addEventListener('input', rememberCaret);
    source.addEventListener('blur', rememberCaret);
    source.addEventListener('scroll', fromSource, { passive: true });
    preview.addEventListener('scroll', fromPreview, { passive: true });
    preview.addEventListener('click', keepPreviewHere, true);
    preview.addEventListener('auxclick', keepPreviewHere, true);
    return () => {
      cancelAnimationFrame(release);
      source.removeEventListener('keydown', onSourceKeyDown);
      source.removeEventListener('keyup', rememberCaret);
      source.removeEventListener('mouseup', rememberCaret);
      source.removeEventListener('select', rememberCaret);
      source.removeEventListener('input', rememberCaret);
      source.removeEventListener('blur', rememberCaret);
      source.removeEventListener('scroll', fromSource);
      preview.removeEventListener('scroll', fromPreview);
      preview.removeEventListener('click', keepPreviewHere, true);
      preview.removeEventListener('auxclick', keepPreviewHere, true);
    };
  });

  function range(): { start: number; end: number } {
    const el = sourceEl;
    if (el && document.activeElement === el) {
      return { start: el.selectionStart ?? caret.start, end: el.selectionEnd ?? caret.end };
    }
    return caret;
  }

  async function applyEdit(edit: SourceEdit) {
    content = edit.value;
    caret = { start: edit.selectionStart, end: edit.selectionEnd };
    await tick();
    const el = sourceEl;
    if (!el) return;
    el.focus();
    el.setSelectionRange(edit.selectionStart, edit.selectionEnd);
  }

  function runTool(id: MarkupTool) {
    const { start, end } = range();
    void applyEdit(editMarkup(id, format, content, start, end));
  }

  function syncMention(el: HTMLTextAreaElement) {
    if (el.selectionStart !== el.selectionEnd) {
      mention = null;
      return;
    }
    const active = activeMention(el.value, el.selectionStart ?? 0);
    if (!active) {
      mention = null;
      return;
    }
    if (mention && mention.start === active.start && mention.query === active.query) return;
    mention = active;
    mentionIndex = 0;
  }

  async function chooseMention(hit: MentionCandidate) {
    const current = mention;
    const el = sourceEl;
    if (!current || !el) return;
    const end = el.selectionStart ?? current.start + 1 + current.query.length;
    const edit = insertMention(el.value, current.start, end, hit.npub);
    mention = null;
    mentionHits = [];
    if (!edit) return;
    await applyEdit(edit);
  }

  function openMediaPicker() {
    const el = sourceEl;
    if (el) caret = { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 };
    mediaInput?.click();
  }

  async function onMediaPicked(event: Event) {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !onUploadMedia) return;
    uploadError = '';
    const { start, end } = caret;
    try {
      const uploaded = await onUploadMedia(file);
      await applyEdit(editMedia(format, content, start, end, uploaded));
    } catch (err) {
      uploadError = err instanceof Error ? err.message : 'Upload failed.';
    }
  }
</script>

<div
  class="advanced-editor"
  role="dialog"
  aria-modal="true"
  aria-labelledby="advanced-editor-title"
>
  <header class="advanced-editor-bar">
    <h2 id="advanced-editor-title">Advanced Editor</h2>
    <div class="markup-toggle" role="group" aria-label="Markup">
      <button
        type="button"
        aria-pressed={format === 'djot'}
        onclick={() => onFormat?.('djot')}
      >
        Djot
      </button>
      <button
        type="button"
        aria-pressed={format === 'asciidoc'}
        onclick={() => onFormat?.('asciidoc')}
      >
        AsciiDoc
      </button>
    </div>
    <div class="advanced-editor-actions">
      {#if historyRevisions.length}
        <button
          type="button"
          class="btn"
          aria-pressed={historyOpen}
          title="Checkpoint revision history"
          onclick={() => (historyOpen = !historyOpen)}
        >
          History ({historyRevisions.length})
        </button>
      {/if}
      <button
        type="button"
        class="btn"
        disabled={!content}
        title="Clear the source"
        onclick={() => {
          content = '';
        }}
      >
        Clear
      </button>
      <button type="button" class="btn" onclick={() => onClose?.()}>Close</button>
    </div>
  </header>

  {#if historyOpen && historyRevisions.length}
    <section class="advanced-history" aria-label="Draft revision history">
      <ol class="advanced-history-list">
        {#each historyRevisions as rev (rev.id ?? rev.index)}
          <li>
            <header class="advanced-history-head">
              <span>Checkpoint {rev.index}</span>
              <time datetime={new Date(rev.created_at * 1000).toISOString()}
                >{formatCheckpointTime(rev.created_at)}</time
              >
              {#if rev.kind != null}
                <span class="muted">kind {rev.kind}</span>
              {/if}
            </header>
            {#if rev.hasChanges}
              <pre class="details-edit-diff" aria-label={`Diff for checkpoint ${rev.index}`}
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
              <p class="muted">No line changes.</p>
            {/if}
          </li>
        {/each}
      </ol>
    </section>
  {/if}

  <div class="advanced-split">
    <section class="advanced-pane advanced-source" aria-label="Source">
      <div class="advanced-pane-label">Source</div>
      <div class="advanced-tools-bar">
      <div class="advanced-tools" role="toolbar" aria-label="Markup">
        {#each tools as tool (tool.id)}
          <button
            type="button"
            class="advanced-tool"
            class:advanced-tool-bold={tool.id === 'bold'}
            class:advanced-tool-italic={tool.id === 'italic'}
            class:advanced-tool-strike={tool.id === 'strike'}
            class:advanced-tool-underline={tool.id === 'underline'}
            title={tool.title}
            aria-label={tool.title}
            onmousedown={(event) => event.preventDefault()}
            onclick={() => runTool(tool.id)}
          >
            {tool.label}
          </button>
        {/each}
        <button
          type="button"
          class="advanced-tool"
          class:is-busy={uploading}
          title="Upload media"
          aria-label="Upload media"
          disabled={uploading || !onUploadMedia}
          onmousedown={(event) => event.preventDefault()}
          onclick={openMediaPicker}
        >
          {#if uploading}
            <span class="jump-busy-spinner" aria-hidden="true"></span>
          {/if}
          <span>{uploading ? 'Uploading…' : 'Media'}</span>
        </button>
        <input
          bind:this={mediaInput}
          type="file"
          accept="image/*,video/*,audio/*"
          hidden
          tabindex="-1"
          aria-hidden="true"
          disabled={uploading || !onUploadMedia}
          onchange={(event) => void onMediaPicked(event)}
        />
      </div>
      </div>
      {#if uploadError}
        <p class="advanced-upload-error" role="alert">{uploadError}</p>
      {/if}
      <div class="advanced-source-body">
        {#if mention}
          <div class="mention-popover" role="listbox" aria-label="People">
            {#if !mention.query.trim()}
              <p class="mention-hint">Type a name, NIP-05, or npub</p>
            {:else if mentionBusy && mentionHits.length === 0}
              <p class="mention-hint">Searching…</p>
            {:else if mentionHits.length === 0}
              <p class="mention-hint">No one found</p>
            {:else}
              {#each mentionHits as hit, i (hit.pubkey)}
                <button
                  type="button"
                  role="option"
                  class="mention-option"
                  class:active={i === mentionIndex}
                  aria-selected={i === mentionIndex}
                  onmousedown={(event) => event.preventDefault()}
                  onclick={() => void chooseMention(hit)}
                >
                  <span class="mention-title">{hit.title}</span>
                  <span class="mention-detail">{hit.detail}</span>
                </button>
              {/each}
            {/if}
          </div>
        {/if}
        <ComposeGrammarTextarea
          bind:value={content}
          bind:element={sourceEl}
          fill
          rows={12}
          {placeholder}
          {issues}
          {checkedSource}
          enabled={grammarOn}
          {onApply}
        />
      </div>
      <div class="advanced-grammar">
        <label class="advanced-grammar-check">
          <input type="checkbox" bind:checked={grammarOn} />
          <span>Grammar{#if grammarOn && grammarBusy}…{/if}</span>
        </label>
        <label>
          <span class="visually-hidden">Language</span>
          <select bind:value={grammarLang} disabled={!grammarOn} aria-label="Language">
            {#each langChoices as opt (opt.languageToolCode)}
              <option value={opt.languageToolCode}>{opt.label}</option>
            {/each}
          </select>
        </label>
      </div>
    </section>

    <section class="advanced-pane advanced-preview-pane" aria-label="Preview">
      <div class="advanced-pane-label">Preview</div>
      <div class="advanced-preview" bind:this={previewEl}>
        {#if showPreview}
          <div class="event-body advanced-preview-prose">
            {#each blocks as block, i (i)}
              {#if block.type === 'html'}
                {@html block.html}
              {:else if block.type === 'flow'}
                <p class="event-inline">
                  {#each block.parts as part, pi (pi)}
                    {#if part.type === 'html'}
                      {@html part.html}
                    {:else}
                      <UserBadge pubkey={part.pubkey} compact />
                    {/if}
                  {/each}
                </p>
              {:else if resolved[block.index]}
                <EventCard event={resolved[block.index]!} embedDepth={1} asCard />
              {:else if resolved[block.index] === null}
                <p class="muted">This item could not be found.</p>
              {:else}
                <p class="muted">Opening…</p>
              {/if}
            {/each}
          </div>
        {:else}
          <p class="advanced-preview-empty">Nothing to preview yet.</p>
        {/if}
      </div>
    </section>
  </div>
</div>

<style>
  .advanced-editor {
    position: fixed;
    inset: 0;
    z-index: 110;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--paper);
    color: var(--ink);
  }
  .advanced-editor-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex: 0 0 auto;
    padding: 0.55rem 0.85rem;
    border-bottom: 1px solid color-mix(in srgb, var(--rule) 70%, transparent);
    background: var(--paper-light);
  }
  .advanced-editor-bar h2 {
    margin: 0;
    font-family: var(--ui-font);
    font-size: 1rem;
    font-weight: 650;
    letter-spacing: 0;
  }
  .markup-toggle {
    display: inline-flex;
    border: 1px solid color-mix(in srgb, var(--rule) 70%, transparent);
    border-radius: 0.4rem;
    overflow: hidden;
  }
  .markup-toggle button {
    margin: 0;
    padding: 0.28rem 0.7rem;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--ink-soft);
    font: inherit;
    font-family: var(--ui-font);
    font-size: 0.82rem;
    cursor: pointer;
  }
  .markup-toggle button + button {
    border-left: 1px solid color-mix(in srgb, var(--rule) 70%, transparent);
  }
  .markup-toggle button[aria-pressed='true'] {
    background: var(--accent);
    color: var(--brand-primary-0);
    font-weight: 650;
  }
  :global(:root.dark) .markup-toggle button[aria-pressed='true'] {
    color: var(--brand-primary-1000);
  }
  .advanced-editor-actions {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .advanced-editor-bar .btn {
    padding: 0.32rem 0.7rem;
    font-size: 0.88rem;
  }
  .advanced-split {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .advanced-pane {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .advanced-preview-pane {
    border-top: 1px solid color-mix(in srgb, var(--rule) 70%, transparent);
    background: color-mix(in srgb, var(--paper-light) 65%, var(--paper));
  }
  .advanced-tools-bar {
    flex: 0 0 auto;
    width: 100%;
    padding: 0.35rem 0.75rem 0.45rem;
  }
  .advanced-tools {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .advanced-tool {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    min-width: 2rem;
    margin: 0;
    padding: 0.22rem 0.5rem;
    font: inherit;
    font-family: var(--ui-font);
    font-size: 0.82rem;
    line-height: 1.2;
    color: var(--ink);
    background: color-mix(in srgb, var(--paper-dark) 40%, var(--paper-light));
    border: 1px solid color-mix(in srgb, var(--rule) 65%, transparent);
    border-radius: 0.35rem;
    cursor: pointer;
  }
  .advanced-tool:hover {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--rule));
  }
  .advanced-tool-bold {
    font-weight: 700;
  }
  .advanced-tool-italic {
    font-style: italic;
  }
  .advanced-tool-strike {
    text-decoration: line-through;
  }
  .advanced-tool-underline {
    text-decoration: underline;
    text-underline-offset: 0.12em;
  }
  .advanced-tool.is-busy {
    pointer-events: none;
    opacity: 0.7;
  }
  .advanced-upload-error {
    flex: 0 0 auto;
    margin: 0.35rem 0.9rem 0;
    color: var(--danger, #a33);
    font-family: var(--ui-font);
    font-size: 0.85rem;
  }
  .advanced-pane-label {
    flex: 0 0 auto;
    padding: 0.35rem 0.9rem 0.15rem;
    font-family: var(--ui-font);
    font-size: 0.72rem;
    font-weight: 650;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .advanced-source-body {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 0 0.75rem;
  }
  .mention-popover {
    position: absolute;
    z-index: 4;
    top: 0.35rem;
    left: 0.75rem;
    right: 0.75rem;
    max-height: min(16rem, 50%);
    overflow: auto;
    padding: 0.3rem;
    border: 1px solid color-mix(in srgb, var(--rule) 78%, transparent);
    border-radius: 0.45rem;
    background: var(--paper-light);
    box-shadow: var(--shadow-soft, 0 4px 16px rgb(0 0 0 / 12%));
  }
  .mention-hint {
    margin: 0;
    padding: 0.35rem 0.45rem;
    color: var(--ink-soft);
    font-family: var(--ui-font);
    font-size: 0.85rem;
  }
  .mention-option {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.05rem;
    width: 100%;
    margin: 0;
    padding: 0.35rem 0.45rem;
    text-align: left;
    font: inherit;
    color: inherit;
    background: transparent;
    border: none;
    border-radius: 0.3rem;
    cursor: pointer;
  }
  .mention-option.active,
  .mention-option:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .mention-title {
    font-family: var(--ui-font);
    font-size: 0.92rem;
  }
  .mention-detail {
    color: var(--ink-soft);
    font-family: var(--ui-font);
    font-size: 0.75rem;
    word-break: break-all;
  }
  .advanced-source-body :global(.grammar-field) {
    flex: 1 1 auto;
    min-height: 0;
  }
  .advanced-source-body :global(textarea.grammar-textarea) {
    font-family: ui-monospace, 'Source Code Pro', Menlo, Consolas, monospace;
    font-size: 0.92rem;
    line-height: 1.55;
  }
  .advanced-grammar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem 0.85rem;
    align-items: center;
    flex: 0 0 auto;
    padding: 0.4rem 0.9rem 0.55rem;
    color: color-mix(in srgb, currentColor 52%, transparent);
    font-family: var(--ui-font);
    font-size: 0.78rem;
  }
  .advanced-grammar-check {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    cursor: pointer;
    user-select: none;
  }
  .advanced-grammar-check input {
    width: auto;
    margin: 0;
    accent-color: color-mix(in srgb, currentColor 55%, transparent);
  }
  .advanced-grammar select {
    width: auto;
    min-width: 6.5rem;
    max-width: 9rem;
    padding: 0.15rem 0.35rem;
    font-size: 0.78rem;
    color: inherit;
    background: transparent;
    border-color: color-mix(in srgb, currentColor 22%, transparent);
  }
  .advanced-grammar select:disabled {
    opacity: 0.55;
  }
  .advanced-preview {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    overflow-anchor: none;
    overscroll-behavior: contain;
    /* Scroll stays synced with the source; only the source bar in the middle shows. */
    scrollbar-width: none;
    padding: 0.35rem 1.15rem 2rem;
  }
  .advanced-preview::-webkit-scrollbar {
    display: none;
  }
  .advanced-preview-prose {
    font-family: var(--reading-font);
    font-size: 1.125rem;
    line-height: 1.65;
    width: min(var(--max-read), 100%);
    margin-inline: auto;
  }
  .advanced-preview-empty {
    margin: 0.35rem 0 0;
    color: var(--ink-soft);
    font-family: var(--ui-font);
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .advanced-history {
    flex: 0 0 auto;
    max-height: min(40vh, 22rem);
    overflow: auto;
    padding: 0.65rem 0.9rem 0.85rem;
    border-bottom: 1px solid color-mix(in srgb, var(--rule) 70%, transparent);
    background: color-mix(in srgb, var(--paper) 70%, var(--paper-light));
  }
  .advanced-history-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.75rem;
  }
  .advanced-history-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem 0.75rem;
    margin-bottom: 0.25rem;
    font-family: var(--ui-font);
    font-size: 0.85rem;
  }

  @media (min-width: 720px) {
    .advanced-split {
      flex-direction: row;
    }
    .advanced-preview-pane {
      border-top: none;
      border-left: 1px solid color-mix(in srgb, var(--rule) 70%, transparent);
    }
  }
</style>
