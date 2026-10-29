<script lang="ts">
  import { createPointerArm } from '$lib/pointer-activate';

  interface Props {
    quote: string;
    /** When true, tray sits as a bottom sheet (narrow phones). */
    sheet?: boolean;
    markMode?: boolean;
    onMarkMode?: (on: boolean) => void;
    onHighlight?: () => void;
    onHighlightNote?: () => void;
    onReply?: () => void;
    onInk?: () => void;
    onDismiss?: () => void;
  }

  let {
    quote,
    sheet = false,
    markMode = false,
    onMarkMode,
    onHighlight,
    onHighlightNote,
    onReply,
    onInk,
    onDismiss
  }: Props = $props();

  const preview = $derived(
    quote.length > 120 ? `${quote.slice(0, 117).trimEnd()}…` : quote
  );

  /**
   * Fire on pointerdown so the action runs before the browser clears the
   * text selection (which unmounts this tray and kills the synthetic click
   * on many touch/stylus browsers, e.g. Samsung). Keyboard still uses click.
   */
  const arm = createPointerArm();

  function runPointerAction(e: PointerEvent, fn: (() => void) | undefined): void {
    if (!fn) return;
    arm.run(e, fn);
  }

  function runClickAction(e: MouseEvent, fn: (() => void) | undefined): void {
    if (!fn) return;
    arm.absorbClick(e, fn);
  }
</script>

<div
  class="sel-tray"
  class:sheet
  role="toolbar"
  tabindex="-1"
  aria-label="Selection actions"
  onpointerdown={(e) => {
    // Keep the text selection when pressing tray chrome, but do not cancel
    // pointerdown on buttons — that suppresses click on many touch/stylus browsers.
    const t = e.target;
    if (t instanceof Element && t.closest('button, a, input, textarea, label')) return;
    e.preventDefault();
  }}
>
  <div class="sel-top">
    <p class="sel-quote muted">{preview}</p>
    {#if onDismiss}
      <button
        type="button"
        class="sel-close"
        aria-label="Close"
        title="Close"
        onpointerdown={(e) => runPointerAction(e, onDismiss)}
        onclick={(e) => runClickAction(e, onDismiss)}
        >×</button
      >
    {/if}
  </div>
  <div class="sel-actions">
    {#if onMarkMode}
      <button
        type="button"
        class="btn"
        class:active={markMode}
        aria-pressed={markMode}
        onpointerdown={(e) => runPointerAction(e, () => onMarkMode?.(!markMode))}
        onclick={(e) => runClickAction(e, () => onMarkMode?.(!markMode))}
        >Mark</button
      >
    {/if}
    {#if onHighlight}
      <button
        type="button"
        class="btn"
        onpointerdown={(e) => runPointerAction(e, onHighlight)}
        onclick={(e) => runClickAction(e, onHighlight)}>Highlight</button
      >
    {/if}
    {#if onHighlightNote}
      <button
        type="button"
        class="btn"
        onpointerdown={(e) => runPointerAction(e, onHighlightNote)}
        onclick={(e) => runClickAction(e, onHighlightNote)}
        >Highlight + note</button
      >
    {/if}
    {#if onReply}
      <button
        type="button"
        class="btn"
        onpointerdown={(e) => runPointerAction(e, onReply)}
        onclick={(e) => runClickAction(e, onReply)}>Reply</button
      >
    {/if}
    {#if onInk}
      <button
        type="button"
        class="btn"
        onpointerdown={(e) => runPointerAction(e, onInk)}
        onclick={(e) => runClickAction(e, onInk)}>Ink note</button
      >
    {/if}
  </div>
</div>

<style>
  .sel-tray {
    display: grid;
    gap: 0.45rem;
    padding: 0.55rem 0.65rem;
    border-radius: 0.45rem;
    background: color-mix(in srgb, var(--paper, #f7f2e8) 92%, #fff);
    border: 1px solid color-mix(in srgb, var(--ink, #1a1510) 14%, transparent);
    box-shadow: 0 0.25rem 0.9rem rgb(0 0 0 / 12%);
    max-width: 28rem;
  }
  .sel-tray.sheet {
    position: fixed;
    left: 0.5rem;
    right: 0.5rem;
    bottom: 0.75rem;
    z-index: 60;
    max-width: none;
  }
  .sel-top {
    display: flex;
    align-items: flex-start;
    gap: 0.35rem;
  }
  .sel-quote {
    margin: 0;
    flex: 1 1 auto;
    min-width: 0;
    font-size: 0.82rem;
    line-height: 1.35;
    max-height: 3.2em;
    overflow: hidden;
  }
  .sel-close {
    flex-shrink: 0;
    width: 1.75rem;
    height: 1.75rem;
    margin: -0.15rem -0.2rem 0 0;
    padding: 0;
    border: 0;
    border-radius: 0.3rem;
    background: transparent;
    color: color-mix(in srgb, var(--ink, #1a1510) 70%, transparent);
    font: inherit;
    font-size: 1.35rem;
    line-height: 1;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-user-select: none;
    user-select: none;
  }
  .sel-close:hover,
  .sel-close:focus-visible {
    background: color-mix(in srgb, var(--ink, #1a1510) 10%, transparent);
    color: var(--ink, #1a1510);
  }
  .sel-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .sel-actions .btn {
    touch-action: manipulation;
    -webkit-user-select: none;
    user-select: none;
  }
  .sel-actions .active {
    outline: 2px solid color-mix(in srgb, var(--accent, #6b4c2a) 70%, transparent);
  }
</style>
