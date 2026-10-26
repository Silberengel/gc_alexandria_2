<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    normalizePrivateRelayUrls,
    publicFallbackPrivateRelays,
    publishPrivateRelayList
  } from '$lib/nip37';

  interface Props {
    open?: boolean;
    onClose?: () => void;
    /** Called after a kind-10013 list is published successfully. */
    onPublished?: () => void;
  }

  let { open = false, onClose, onPublished }: Props = $props();

  let rows = $state<string[]>(['']);
  let error = $state('');
  let busy = $state(false);
  const fallbackRelays = publicFallbackPrivateRelays();

  function close(): void {
    if (busy) return;
    error = '';
    onClose?.();
  }

  function onBackdrop(e: MouseEvent): void {
    if (e.target === e.currentTarget) close();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && open) close();
  }

  function setUrl(i: number, url: string): void {
    rows = rows.map((r, idx) => (idx === i ? url : r));
  }

  function addRow(): void {
    rows = [...rows, ''];
  }

  function removeRow(i: number): void {
    if (rows.length <= 1) {
      rows = [''];
      return;
    }
    rows = rows.filter((_, idx) => idx !== i);
  }

  async function publishUrls(urls: string[]): Promise<void> {
    busy = true;
    error = '';
    try {
      await publishPrivateRelayList(urls);
      onPublished?.();
      close();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function createWithMine(): Promise<void> {
    const urls = normalizePrivateRelayUrls(rows);
    if (!urls.length) {
      error = 'Add at least one ws:// or wss:// relay URL.';
      return;
    }
    await publishUrls(urls);
  }

  async function createWithPublic(): Promise<void> {
    await publishUrls(fallbackRelays);
  }

  onMount(() => {
    window.addEventListener('keydown', onKey);
  });
  onDestroy(() => {
    window.removeEventListener('keydown', onKey);
  });

  $effect(() => {
    if (open) {
      rows = [''];
      error = '';
      busy = false;
    }
  });
</script>

{#if open}
  <div class="login-overlay" role="presentation" onclick={onBackdrop}>
    <div
      class="login-dialog card private-relay-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="private-relay-title"
    >
      <header class="login-dialog-head">
        <h2 id="private-relay-title">Private draft relays</h2>
        <button class="btn" type="button" onclick={close} aria-label="Close" disabled={busy}
          >Close</button
        >
      </header>

      <p class="login-lede">
        Encrypted drafts (NIP-37) are stored on relays from your kind 10013 list. Prefer your own
        <strong>NIP-42 AUTH</strong> private-storage relays — for example
        <code>wss://nostr.land</code> or a local <code>ws://localhost</code> relay.
      </p>

      <div class="tag-rows relay-rows">
        <div class="tag-rows-head">
          <span>Your relays</span>
          <button type="button" class="tag-rows-icon" onclick={addRow} aria-label="Add relay"
            >+</button
          >
        </div>
        {#each rows as url, i}
          <div class="tag-row relay-row">
            <input
              type="url"
              value={url}
              placeholder="wss://… or ws://localhost"
              aria-label={`Relay ${i + 1}`}
              disabled={busy}
              oninput={(e) => setUrl(i, e.currentTarget.value)}
            />
            <button
              type="button"
              class="tag-rows-icon"
              onclick={() => removeRow(i)}
              aria-label={`Remove relay ${i + 1}`}
              disabled={busy}>−</button
            >
          </div>
        {/each}
      </div>

      <button class="btn btn-primary" type="button" disabled={busy} onclick={() => void createWithMine()}>
        {#if busy}
          Publishing…
        {:else}
          Create a list with my relays
        {/if}
      </button>

      <div class="private-relay-fallback">
        <p class="muted">
          Or use Alexandria’s public fallback relays (operators treat private events confidentially).
          These URLs will be published in your list:
        </p>
        <ul class="private-relay-fallback-list">
          {#each fallbackRelays as relay}
            <li><code>{relay}</code></li>
          {/each}
        </ul>
        <button class="btn" type="button" disabled={busy} onclick={() => void createWithPublic()}>
          Create a list with public relays
        </button>
      </div>

      {#if error}
        <p class="compose-error">{error}</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .private-relay-modal {
    width: min(32rem, 100%);
  }
  .private-relay-fallback {
    display: grid;
    gap: 0.5rem;
    margin-top: 0.25rem;
    padding-top: 0.75rem;
    border-top: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  }
  .private-relay-fallback-list {
    margin: 0;
    padding-left: 1.1rem;
    font-size: 0.85rem;
  }
  .private-relay-fallback .btn {
    justify-self: start;
    opacity: 0.85;
  }
</style>
