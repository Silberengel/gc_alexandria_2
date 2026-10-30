<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { composerFieldSpecs, getKind } from '$lib/kind-compose';
  import {
    citationKindLabel,
    citationModesForKind,
    todayIsoDate,
    type CitationMode
  } from '$lib/citations';
  import { CITATION_KINDS, KIND } from '$lib/constants';

  export type CitationDraftResult = {
    kind: number;
    content: string;
    values: Record<string, string>;
    mode: CitationMode;
  };

  interface Props {
    open?: boolean;
    /** Pre-fill quoted text from the editor selection. */
    initialContent?: string;
    onClose?: () => void;
    onSubmit?: (draft: CitationDraftResult) => Promise<void> | void;
  }

  let { open = false, initialContent = '', onClose, onSubmit }: Props = $props();

  let kind = $state<number>(KIND.CITATION_WEB);
  let content = $state('');
  let values = $state<Record<string, string>>({});
  let mode = $state<CitationMode>('inline');
  let error = $state('');
  let busy = $state(false);

  const fields = $derived(composerFieldSpecs(kind));
  const modes = $derived(citationModesForKind(kind));
  const kindDef = $derived(getKind(kind));

  function defaultsForKind(k: number): Record<string, string> {
    const out: Record<string, string> = {};
    const today = todayIsoDate();
    for (const f of composerFieldSpecs(k)) {
      if (f.id === 'accessed_on' || f.id === 'published_on') out[f.id] = today;
      else out[f.id] = '';
    }
    return out;
  }

  function reset(): void {
    kind = KIND.CITATION_WEB;
    content = initialContent.trim();
    values = defaultsForKind(KIND.CITATION_WEB);
    mode = 'inline';
    error = '';
    busy = false;
  }

  function close(): void {
    if (busy) return;
    onClose?.();
  }

  function onBackdrop(e: MouseEvent): void {
    if (e.target === e.currentTarget) close();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && open) close();
  }

  function setKind(next: number): void {
    kind = next;
    values = { ...defaultsForKind(next), ...pickOverlap(values, next) };
    const allowed = citationModesForKind(next);
    if (!allowed.includes(mode)) mode = allowed[0]!;
  }

  function pickOverlap(
    prev: Record<string, string>,
    nextKind: number
  ): Record<string, string> {
    const ids = new Set(composerFieldSpecs(nextKind).map((f) => f.id));
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(prev)) {
      if (ids.has(k) && v.trim()) out[k] = v;
    }
    return out;
  }

  function setValue(id: string, v: string): void {
    values = { ...values, [id]: v };
  }

  async function submit(): Promise<void> {
    if (busy) return;
    error = '';
    const quoted = content.trim();
    if (!quoted) {
      error = 'Add the cited text.';
      return;
    }
    for (const f of fields) {
      if (!f.required) continue;
      if (!String(values[f.id] ?? '').trim()) {
        error = `${f.label} is required.`;
        return;
      }
    }
    busy = true;
    try {
      await onSubmit?.({
        kind,
        content: quoted,
        values: { ...values },
        mode
      });
      close();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKey);
  });
  onDestroy(() => {
    window.removeEventListener('keydown', onKey);
  });

  $effect(() => {
    if (open) reset();
  });
</script>

{#if open}
  <div class="login-overlay" role="presentation" onclick={onBackdrop}>
    <div
      class="login-dialog card citation-compose-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="citation-compose-title"
      onclick={(e) => e.stopPropagation()}
    >
      <header class="citation-compose-head">
        <h2 id="citation-compose-title">Add citation</h2>
        <p class="muted">
          Publishes an NKBIP-03 citation event, then inserts
          <code>[[citation::…]]</code> at the caret.
        </p>
      </header>

      <label class="citation-compose-field">
        <span>Source type</span>
        <select
          value={kind}
          disabled={busy}
          onchange={(e) => setKind(Number((e.currentTarget as HTMLSelectElement).value))}
        >
          {#each CITATION_KINDS as k (k)}
            <option value={k}>{citationKindLabel(k)}</option>
          {/each}
        </select>
      </label>

      <label class="citation-compose-field">
        <span>Placement in document</span>
        <select
          value={mode}
          disabled={busy}
          onchange={(e) => (mode = (e.currentTarget as HTMLSelectElement).value as CitationMode)}
        >
          {#each modes as m (m)}
            <option value={m}>{m}</option>
          {/each}
        </select>
      </label>

      <label class="citation-compose-field">
        <span>{kindDef?.content?.label ?? 'Cited text'}</span>
        <textarea
          rows="4"
          bind:value={content}
          disabled={busy}
          placeholder="Quoted or referenced passage"
        ></textarea>
      </label>

      {#each fields as field (field.id)}
        <label class="citation-compose-field">
          <span>
            {field.label}{#if field.required}*{/if}
          </span>
          {#if field.multiline || field.widget === 'textarea'}
            <textarea
              rows="3"
              value={values[field.id] ?? ''}
              disabled={busy}
              placeholder={field.help ?? ''}
              oninput={(e) => setValue(field.id, (e.currentTarget as HTMLTextAreaElement).value)}
            ></textarea>
          {:else}
            <input
              type={field.widget === 'url' ? 'url' : 'text'}
              value={values[field.id] ?? ''}
              disabled={busy}
              placeholder={field.help ?? ''}
              oninput={(e) => setValue(field.id, (e.currentTarget as HTMLInputElement).value)}
            />
          {/if}
        </label>
      {/each}

      {#if error}
        <p class="muted citation-compose-error" role="alert">{error}</p>
      {/if}

      <footer class="citation-compose-actions">
        <button type="button" class="btn" disabled={busy} onclick={close}>Cancel</button>
        <button type="button" class="btn primary" disabled={busy} onclick={() => void submit()}>
          {busy ? 'Publishing…' : 'Publish & insert'}
        </button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .citation-compose-modal {
    width: min(32rem, calc(100vw - 2rem));
    max-height: min(90vh, 44rem);
    overflow: auto;
    padding: 1.1rem 1.15rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .citation-compose-head h2 {
    margin: 0 0 0.25rem;
    font-size: 1.15rem;
  }
  .citation-compose-head p {
    margin: 0;
    font-size: var(--text-meta, 0.85rem);
  }
  .citation-compose-field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.9rem;
  }
  .citation-compose-field span {
    color: var(--text-muted);
  }
  .citation-compose-field input,
  .citation-compose-field textarea,
  .citation-compose-field select {
    font: inherit;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--rule, #ccc);
    border-radius: var(--radius, 0.35rem);
    background: var(--surface, #fff);
    color: inherit;
  }
  .citation-compose-error {
    margin: 0;
  }
  .citation-compose-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.55rem;
    margin-top: 0.25rem;
  }
</style>
