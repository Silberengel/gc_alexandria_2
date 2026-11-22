<script lang="ts">
  import {
    KIND0_ADD_TAG_OPTIONS,
    emptyKind0TagRows,
    isKind0AtMostOne,
    isKind0Singleton,
    isKnownKind0EditorName,
    kind0FieldLabel
  } from '$lib/compose-kind0';
  import { uploadComposeMedia } from '$lib/compose-media-insert';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { session } from '$lib/stores/session';
  import { showNotice } from '$lib/stores/toast';

  interface Props {
    tags?: string[][];
  }

  let { tags = $bindable([] as string[][]) }: Props = $props();

  let addChoice = $state<string>(KIND0_ADD_TAG_OPTIONS[0]!);
  let uploadingRow = $state<number | null>(null);

  $effect(() => {
    if (!tags.length) tags = emptyKind0TagRows();
  });

  function setName(i: number, name: string): void {
    const next = tags.map((r) => [...r]);
    const row = next[i] ?? ['', ''];
    row[0] = name.trim();
    next[i] = row;
    tags = next;
  }

  function setValue(i: number, value: string): void {
    const next = tags.map((r) => [...r]);
    const row = next[i] ?? ['', ''];
    while (row.length < 2) row.push('');
    row[1] = value;
    next[i] = row;
    tags = next;
  }

  function move(i: number, dir: -1 | 1): void {
    const j = i + dir;
    if (j < 0 || j >= tags.length) return;
    const next = [...tags];
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
    tags = next;
  }

  function removeRow(i: number): void {
    const name = tags[i]?.[0] ?? '';
    if (isKind0Singleton(name)) return;
    const next = tags.filter((_, idx) => idx !== i);
    tags = next.length ? next : emptyKind0TagRows();
  }

  function canAdd(name: string): boolean {
    if (!isKind0AtMostOne(name)) return true;
    return !tags.some((t) => t[0] === name);
  }

  function addSelected(): void {
    const name = addChoice === '__custom__' ? 'custom' : addChoice;
    if (!canAdd(name) && name !== 'custom') return;
    if (name === 'bot') {
      tags = [...tags, ['bot', 'false']];
      return;
    }
    tags = [...tags, [name === 'custom' ? '' : name, '']];
  }

  const addOptions = $derived.by(() => {
    const opts: Array<{ id: string; label: string; disabled: boolean }> = KIND0_ADD_TAG_OPTIONS.map(
      (id) => ({
        id,
        label: kind0FieldLabel(id),
        disabled: !canAdd(id)
      })
    );
    opts.push({ id: '__custom__', label: 'Custom…', disabled: false });
    return opts;
  });

  async function uploadFieldImage(i: number, file: File | undefined): Promise<void> {
    if (!file) return;
    if (!$session.pubkey) {
      openLoginDialog();
      showNotice('Sign in to upload.');
      return;
    }
    uploadingRow = i;
    try {
      const uploaded = await uploadComposeMedia({ file, pubkey: $session.pubkey });
      setValue(i, uploaded.url);
      showNotice('Image uploaded.', true);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      uploadingRow = null;
    }
  }
</script>

<div class="tag-rows kind0-rows">
  <div class="tag-rows-head">
    <span>Profile fields</span>
  </div>
  <p class="tag-rows-hint muted">
    JSON content is built from these rows; same-named tags are published as mirrors. Values that exist
    only as tags (e.g. lud16) are merged in on load.
  </p>

  {#each tags as row, i}
    {@const name = row[0] ?? ''}
    {@const value = name === 'bot' && row.length === 1 ? 'true' : (row[1] ?? '')}
    {@const known = isKnownKind0EditorName(name)}
    <div class="kind0-block">
      <div class="kind0-head">
        {#if known}
          <span class="kind0-label">{kind0FieldLabel(name)}</span>
        {:else}
          <input
            type="text"
            class="kind0-name"
            value={name}
            placeholder="tag name"
            aria-label="Custom tag name"
            oninput={(e) => setName(i, e.currentTarget.value)}
          />
        {/if}
        <div class="kind0-move">
          <button
            type="button"
            class="tag-rows-icon"
            onclick={() => move(i, -1)}
            aria-label="Move up"
            disabled={i === 0}>↑</button
          >
          <button
            type="button"
            class="tag-rows-icon"
            onclick={() => move(i, 1)}
            aria-label="Move down"
            disabled={i >= tags.length - 1}>↓</button
          >
        </div>
        {#if !isKind0Singleton(name)}
          <button
            type="button"
            class="tag-rows-icon"
            onclick={() => removeRow(i)}
            aria-label="Remove field">−</button
          >
        {/if}
      </div>
      {#if name === 'bot'}
        {@const botValue =
          value.trim().toLowerCase() === 'true' || (row.length === 1 && !value.trim())
            ? 'true'
            : 'false'}
        <div class="kind0-bot compose-option-group" role="radiogroup" aria-label="Bot">
          {#each ['false', 'true'] as opt}
            <label class="kind0-bot-opt compose-option">
              <input
                type="radio"
                name={`kind0-bot-${i}`}
                value={opt}
                checked={botValue === opt}
                onchange={() => setValue(i, opt)}
              />
              <span>{opt}</span>
            </label>
          {/each}
        </div>
      {:else if name === 'picture' || name === 'banner'}
        <div class="kind0-url-row">
          <input
            type="url"
            value={value}
            placeholder={kind0FieldLabel(name) || 'value'}
            aria-label={kind0FieldLabel(name) || 'value'}
            oninput={(e) => setValue(i, e.currentTarget.value)}
          />
          <label
            class="btn btn-icon kind0-upload"
            class:is-busy={uploadingRow === i}
            title={uploadingRow === i ? 'Uploading…' : 'Upload image'}
            aria-label={uploadingRow === i ? 'Uploading…' : 'Upload image'}
          >
            {#if uploadingRow === i}
              <span class="jump-busy-spinner" aria-hidden="true"></span>
            {:else}
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.75"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M12 15V4m0 0L8 8m4-4 4 4M5 16.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1.5"
                />
              </svg>
            {/if}
            <input
              type="file"
              accept="image/*"
              hidden
              disabled={uploadingRow !== null}
              onchange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = '';
                void uploadFieldImage(i, file);
              }}
            />
          </label>
        </div>
      {:else}
        <input
          type={name === 'website' ? 'url' : 'text'}
          value={value}
          placeholder={kind0FieldLabel(name) || 'value'}
          aria-label={kind0FieldLabel(name) || 'value'}
          oninput={(e) => setValue(i, e.currentTarget.value)}
        />
      {/if}
    </div>
  {/each}

  <div class="kind0-add">
    <select bind:value={addChoice} aria-label="Add profile field">
      {#each addOptions as opt}
        <option value={opt.id} disabled={opt.disabled}>{opt.label}</option>
      {/each}
    </select>
    <button type="button" class="btn" onclick={addSelected}>Add</button>
  </div>
</div>

<style>
  .tag-rows {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .tag-rows-head {
    font-size: 0.95rem;
  }
  .tag-rows-hint {
    margin: 0;
    font-size: 0.8rem;
    line-height: 1.35;
  }
  .kind0-block {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-width: 0;
  }
  .kind0-head {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
  }
  .kind0-label {
    flex: 1 1 auto;
    font-size: 0.88rem;
    opacity: 0.9;
  }
  .kind0-name {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0.3rem 0.5rem;
    font-size: 0.88rem;
  }
  .kind0-move {
    display: flex;
    gap: 0.15rem;
    flex: 0 0 auto;
  }
  .kind0-block > input[type='text'],
  .kind0-block > input[type='url'],
  .kind0-url-row > input[type='url'] {
    width: 100%;
    box-sizing: border-box;
    padding: 0.35rem 0.55rem;
    font-size: 0.9rem;
  }
  .kind0-url-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
  }
  .kind0-url-row > input {
    flex: 1 1 auto;
    min-width: 0;
  }
  .kind0-upload {
    flex: 0 0 auto;
    cursor: pointer;
    min-width: 2rem;
    min-height: 2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .kind0-upload.is-busy {
    opacity: 0.75;
  }
  .kind0-bot {
    display: flex;
    gap: 1rem;
    align-items: center;
  }
  .kind0-bot-opt {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.9rem;
  }
  .kind0-add {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    margin-top: 0.15rem;
  }
  .kind0-add select {
    flex: 1 1 auto;
    min-width: 0;
  }
  .tag-rows-icon {
    box-sizing: border-box;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.65rem;
    height: 1.65rem;
    margin: 0;
    padding: 0;
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    border-radius: 0.3rem;
    background: color-mix(in srgb, currentColor 4%, transparent);
    color: inherit;
    font: inherit;
    font-size: 0.85rem;
    line-height: 1;
    cursor: pointer;
  }
  .tag-rows-icon:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--accent, currentColor) 40%, transparent);
  }
  .tag-rows-icon:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .muted {
    opacity: 0.75;
  }
</style>
