<script lang="ts">
  import type { GrammarIssue } from '$lib/compose-grammar';

  interface Props {
    value?: string;
    rows?: number;
    placeholder?: string;
    /** Issues for the last successful check (only painted when source matches value). */
    issues?: GrammarIssue[];
    /** Exact text that was checked — underlines hide when it diverges from value. */
    checkedSource?: string;
    enabled?: boolean;
    onApply?: (issue: GrammarIssue, replacement: string) => void;
  }

  let {
    value = $bindable(''),
    rows = 10,
    placeholder = '',
    issues = [],
    checkedSource = '',
    enabled = true,
    onApply
  }: Props = $props();

  let wrapEl = $state<HTMLDivElement | null>(null);
  let taEl = $state<HTMLTextAreaElement | null>(null);
  let mirrorEl = $state<HTMLDivElement | null>(null);
  let active = $state<GrammarIssue | null>(null);
  let popTop = $state(0);
  let popLeft = $state(0);

  const paintIssues = $derived.by(() => {
    if (!enabled || !issues.length) return [] as GrammarIssue[];
    if (checkedSource !== value) return [] as GrammarIssue[];
    return issues
      .filter((i) => i.length > 0 && i.offset >= 0 && i.offset + i.length <= value.length)
      .slice()
      .sort((a, b) => a.offset - b.offset);
  });

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const mirrorHtml = $derived.by(() => {
    const text = value;
    const marks = paintIssues;
    if (!marks.length) return escapeHtml(text) + '\n';
    let html = '';
    let last = 0;
    let idx = 0;
    for (const issue of marks) {
      if (issue.offset < last) continue;
      html += escapeHtml(text.slice(last, issue.offset));
      html += `<mark class="grammar-mark" data-g="${idx}">${escapeHtml(
        text.slice(issue.offset, issue.offset + issue.length)
      )}</mark>`;
      last = issue.offset + issue.length;
      idx += 1;
    }
    html += escapeHtml(text.slice(last));
    return html + '\n';
  });

  function syncMirrorStyles(): void {
    const ta = taEl;
    const mirror = mirrorEl;
    if (!ta || !mirror) return;
    const cs = getComputedStyle(ta);
    const keys = [
      'fontFamily',
      'fontSize',
      'fontWeight',
      'fontStyle',
      'fontVariant',
      'letterSpacing',
      'wordSpacing',
      'lineHeight',
      'textTransform',
      'textIndent',
      'tabSize',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'borderTopWidth',
      'borderRightWidth',
      'borderBottomWidth',
      'borderLeftWidth',
      'boxSizing',
      'direction'
    ] as const;
    for (const key of keys) {
      mirror.style[key] = cs[key];
    }
    mirror.style.width = `${ta.clientWidth}px`;
    mirror.style.height = `${ta.clientHeight}px`;
    mirror.scrollTop = ta.scrollTop;
    mirror.scrollLeft = ta.scrollLeft;
  }

  function issueAtCaret(pos: number): GrammarIssue | null {
    for (const issue of paintIssues) {
      const end = issue.offset + issue.length;
      if (pos >= issue.offset && pos <= end) return issue;
    }
    return null;
  }

  function placePopover(issue: GrammarIssue): void {
    const mirror = mirrorEl;
    const wrap = wrapEl;
    if (!mirror || !wrap) {
      active = issue;
      return;
    }
    const marks = paintIssues;
    const index = marks.indexOf(issue);
    const mark =
      index >= 0
        ? (mirror.querySelector(`mark.grammar-mark[data-g="${index}"]`) as HTMLElement | null)
        : null;
    const wrapRect = wrap.getBoundingClientRect();
    if (mark) {
      const rects = mark.getClientRects();
      const r = rects.length ? rects[rects.length - 1]! : mark.getBoundingClientRect();
      popTop = r.bottom - wrapRect.top + 6;
      popLeft = Math.max(0, Math.min(r.left - wrapRect.left, wrapRect.width - 180));
    } else {
      popTop = (taEl?.offsetHeight ?? 0) + 4;
      popLeft = 0;
    }
    active = issue;
  }

  function onSelectOrClick(): void {
    if (!enabled || !taEl) {
      active = null;
      return;
    }
    const pos = taEl.selectionStart ?? 0;
    const hit = issueAtCaret(pos);
    if (hit) placePopover(hit);
    else active = null;
  }

  function applyFix(rep: string): void {
    if (!active || !onApply) return;
    onApply(active, rep);
    active = null;
  }

  $effect(() => {
    void value;
    void paintIssues;
    void mirrorHtml;
    queueMicrotask(() => {
      syncMirrorStyles();
      if (active) {
        const still = paintIssues.find(
          (i) => i.offset === active!.offset && i.length === active!.length
        );
        if (!still) active = null;
        else placePopover(still);
      }
    });
  });

  $effect(() => {
    const ta = taEl;
    if (!ta) return;
    const onScroll = () => {
      if (mirrorEl) {
        mirrorEl.scrollTop = ta.scrollTop;
        mirrorEl.scrollLeft = ta.scrollLeft;
      }
      if (active) placePopover(active);
    };
    const onResize = () => {
      syncMirrorStyles();
      if (active) placePopover(active);
    };
    ta.addEventListener('scroll', onScroll);
    window.addEventListener('resize', onResize);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    ro?.observe(ta);
    syncMirrorStyles();
    return () => {
      ta.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
    };
  });
</script>

<div class="grammar-field" bind:this={wrapEl}>
  <div class="grammar-mirror" bind:this={mirrorEl} aria-hidden="true">{@html mirrorHtml}</div>
  <textarea
    bind:this={taEl}
    bind:value
    {rows}
    {placeholder}
    class="grammar-textarea"
    spellcheck="false"
    onselect={onSelectOrClick}
    onclick={onSelectOrClick}
    onkeyup={onSelectOrClick}
  ></textarea>
  {#if active && enabled}
    <div class="grammar-popover" style:top="{popTop}px" style:left="{popLeft}px" role="dialog">
      {#if active.message}
        <p class="grammar-popover-msg">{active.message}</p>
      {/if}
      <div class="grammar-popover-actions">
        {#each active.replacements.slice(0, 5) as rep}
          <button type="button" class="btn" onclick={() => applyFix(rep)}>{rep}</button>
        {/each}
        <button type="button" class="btn grammar-popover-dismiss" onclick={() => (active = null)}
          >Dismiss</button
        >
      </div>
    </div>
  {/if}
</div>

<style>
  .grammar-field {
    position: relative;
    width: 100%;
  }
  .grammar-mirror {
    position: absolute;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    word-wrap: break-word;
    color: transparent;
    caret-color: transparent;
    pointer-events: none;
    border-style: solid;
    border-color: transparent;
    border-radius: 0.45rem;
    background: var(--paper-light);
  }
  :global(:root.dark) .grammar-mirror {
    background: color-mix(in srgb, var(--paper-dark) 55%, var(--paper-light));
  }
  :global(.grammar-mirror .grammar-mark) {
    color: transparent;
    background: transparent;
    border-radius: 0;
    padding: 0;
    /* Wavy underline — imwald uses a red underline the spellchecker will not strip. */
    text-decoration-line: underline;
    text-decoration-style: wavy;
    text-decoration-color: #c62828;
    text-decoration-thickness: 2px;
    text-underline-offset: 2px;
  }
  .grammar-textarea {
    position: relative;
    z-index: 1;
    background: transparent !important;
    width: 100%;
  }
  .grammar-popover {
    position: absolute;
    z-index: 3;
    max-width: min(100%, 22rem);
    padding: 0.55rem 0.65rem;
    border: 1px solid color-mix(in srgb, var(--rule) 78%, transparent);
    border-radius: 0.45rem;
    background: var(--paper-light);
    box-shadow: var(--shadow-soft, 0 4px 16px rgb(0 0 0 / 12%));
    color: var(--ink);
  }
  :global(:root.dark) .grammar-popover {
    background: color-mix(in srgb, var(--paper-dark) 70%, var(--paper-light));
  }
  .grammar-popover-msg {
    margin: 0 0 0.4rem;
    font-size: 0.9rem;
    color: #a33;
  }
  :global(:root.dark) .grammar-popover-msg {
    color: #e88;
  }
  .grammar-popover-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .grammar-popover-dismiss {
    opacity: 0.75;
  }
</style>
