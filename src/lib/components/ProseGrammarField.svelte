<script lang="ts">
  import ComposeGrammarTextarea from './ComposeGrammarTextarea.svelte';
  import {
    checkGrammar,
    defaultGrammarLanguageToolCode,
    grammarLanguageOptions,
    type GrammarIssue
  } from '$lib/compose-grammar';

  interface Props {
    value?: string;
    rows?: number;
    placeholder?: string;
    id?: string;
    disabled?: boolean;
    required?: boolean;
    fill?: boolean;
    /**
     * When false, hide Grammar/Language controls and never call LanguageTool
     * (encrypted / private-content composers). Defaults on for prose surfaces.
     */
    grammarEligible?: boolean;
    onPaste?: (event: ClipboardEvent) => void;
    onDrop?: (event: DragEvent) => void;
    element?: HTMLTextAreaElement | null;
  }

  let {
    value = $bindable(''),
    rows = 3,
    placeholder = '',
    id = '',
    disabled = false,
    required = false,
    fill = false,
    grammarEligible = true,
    onPaste,
    onDrop,
    element = $bindable<HTMLTextAreaElement | null>(null)
  }: Props = $props();

  let grammarOn = $state(grammarEligible);
  let grammarLang = $state(defaultGrammarLanguageToolCode());
  let grammarIssues = $state<GrammarIssue[]>([]);
  let grammarCheckedSource = $state('');
  let grammarBusy = $state(false);
  const langChoices = $derived(grammarLanguageOptions(grammarLang));
  const showGrammar = $derived(grammarEligible && grammarOn && !disabled);

  $effect(() => {
    // Re-default when eligibility flips (e.g. compose kind change).
    grammarOn = grammarEligible;
  });

  $effect(() => {
    if (!showGrammar) {
      grammarIssues = [];
      grammarCheckedSource = '';
      grammarBusy = false;
      return;
    }
    const text = value;
    const lang = grammarLang;
    let cancelled = false;
    const t = setTimeout(() => {
      grammarBusy = true;
      void checkGrammar(text, lang)
        .then((issues) => {
          if (cancelled) return;
          grammarIssues = issues;
          grammarCheckedSource = text;
        })
        .finally(() => {
          if (!cancelled) grammarBusy = false;
        });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
      grammarBusy = false;
    };
  });

  function applyFix(issue: GrammarIssue, replacement: string): void {
    const before = value.slice(0, issue.offset);
    const after = value.slice(issue.offset + issue.length);
    value = `${before}${replacement}${after}`;
    grammarIssues = [];
    grammarCheckedSource = '';
  }
</script>

<div class="prose-grammar-field">
  <ComposeGrammarTextarea
    {id}
    bind:value
    {rows}
    {placeholder}
    {fill}
    {disabled}
    {required}
    issues={grammarIssues}
    checkedSource={grammarCheckedSource}
    enabled={showGrammar}
    onApply={applyFix}
    {onPaste}
    {onDrop}
    bind:element
  />
  {#if grammarEligible}
    <div class="compose-grammar-tools">
      <label class="compose-grammar-check">
        <input type="checkbox" bind:checked={grammarOn} disabled={disabled} />
        <span>Grammar{#if grammarOn && grammarBusy}…{/if}</span>
      </label>
      <label class="compose-grammar-lang">
        <span class="visually-hidden">Language</span>
        <select bind:value={grammarLang} disabled={disabled || !grammarOn} aria-label="Language">
          {#each langChoices as opt (opt.languageToolCode)}
            <option value={opt.languageToolCode}>{opt.label}</option>
          {/each}
        </select>
      </label>
    </div>
  {/if}
</div>

<style>
  .prose-grammar-field {
    display: grid;
    gap: 0.35rem;
    min-width: 0;
  }
  .prose-grammar-field:has(.grammar-field.fill) {
    height: 100%;
    grid-template-rows: minmax(0, 1fr) auto;
  }
  .compose-grammar-tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.55rem 0.85rem;
  }
  .compose-grammar-check {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.88rem;
    color: var(--ink-soft, inherit);
    cursor: pointer;
  }
  .compose-grammar-check input {
    margin: 0;
  }
  .compose-grammar-lang select {
    font: inherit;
    font-size: 0.88rem;
    padding: 0.2rem 0.4rem;
    border: 1px solid color-mix(in srgb, var(--rule, currentColor) 70%, transparent);
    border-radius: 0.35rem;
    background: var(--paper-light, inherit);
    color: var(--ink, inherit);
  }
  .compose-grammar-lang select:disabled {
    opacity: 0.55;
  }
</style>
