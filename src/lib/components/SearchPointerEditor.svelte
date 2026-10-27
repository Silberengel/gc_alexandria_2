<script lang="ts">
  import UserBadge from './UserBadge.svelte';
  import StringListRows from './StringListRows.svelte';
  import {
    formatSearchPointerQuery,
    searchPointerLabel,
    validateDTagInput,
    validateEventIdHex,
    validateKindInput,
    validatePubkeyHex,
    validateRelaysInput,
    type SearchPointer
  } from '$lib/search-pointer';

  interface Props {
    pointer: SearchPointer;
  }

  let { pointer }: Props = $props();

  let kindText = $state('');
  let pubkeyText = $state('');
  let dText = $state('');
  let idText = $state('');
  let relays = $state<string[]>(['']);
  /** Keep the relays block once the bech32 carried hints (even if cleared). */
  let showRelays = $state(false);
  let seededKey = '';

  $effect(() => {
    const relayKey = (pointer.relays ?? []).join('|');
    const key =
      pointer.type === 'coord'
        ? `c:${pointer.kind}:${pointer.pubkey}:${pointer.d}:${relayKey}`
        : `i:${pointer.id}:${pointer.author ?? ''}:${relayKey}`;
    if (key === seededKey) return;
    seededKey = key;
    if (pointer.type === 'coord') {
      kindText = String(pointer.kind);
      pubkeyText = pointer.pubkey;
      dText = pointer.d;
    } else {
      idText = pointer.id;
    }
    if (pointer.relays?.length) {
      showRelays = true;
      relays = [...pointer.relays];
    } else {
      showRelays = false;
      relays = [''];
    }
  });

  const kindCheck = $derived(validateKindInput(kindText));
  const pubkeyCheck = $derived(validatePubkeyHex(pubkeyText));
  const dCheck = $derived(validateDTagInput(dText));
  const idCheck = $derived(validateEventIdHex(idText));
  const relaysCheck = $derived(
    validateRelaysInput(relays.map((r) => r.trim()).filter(Boolean).join('\n'))
  );
  /** Live hex from the pubkey field — drives UserBadge as the user edits. */
  const pubkeyHex = $derived(pubkeyCheck.ok ? pubkeyCheck.value : '');

  const canSubmit = $derived(
    (pointer.type === 'coord' ? kindCheck.ok && pubkeyCheck.ok && dCheck.ok : idCheck.ok) &&
      (!showRelays || relaysCheck.ok)
  );

  function relaunch(): void {
    if (!canSubmit) return;
    const relayHints =
      showRelays && relaysCheck.ok && relaysCheck.value.length ? relaysCheck.value : undefined;
    let next: SearchPointer;
    if (pointer.type === 'coord') {
      if (!kindCheck.ok || !pubkeyCheck.ok || !dCheck.ok) return;
      next = {
        type: 'coord',
        kind: kindCheck.value,
        pubkey: pubkeyCheck.value,
        d: dCheck.value,
        relays: relayHints
      };
    } else {
      if (!idCheck.ok) return;
      next = {
        type: 'id',
        id: idCheck.value,
        author: pointer.author,
        relays: relayHints
      };
    }
    const q = formatSearchPointerQuery(next);
    window.location.hash = `#/search?q=${encodeURIComponent(q)}`;
  }
</script>

<div class="search-pointer" class:search-pointer-coord={pointer.type === 'coord'}>
  <p class="search-pointer-kicker muted">{searchPointerLabel(pointer)}</p>
  {#if pointer.type === 'coord'}
    <div class="search-pointer-parts">
      <label class="search-pointer-part">
        <span class="search-pointer-label">Kind</span>
        <input
          class="search-pointer-input"
          class:invalid={!kindCheck.ok}
          type="text"
          inputmode="numeric"
          autocomplete="off"
          spellcheck="false"
          bind:value={kindText}
          aria-invalid={!kindCheck.ok}
        />
        {#if !kindCheck.ok}
          <span class="search-pointer-error">{kindCheck.error}</span>
        {/if}
      </label>
      <span class="search-pointer-sep" aria-hidden="true"><span class="search-pointer-sep-mark">:</span></span>
      <label class="search-pointer-part search-pointer-part-wide">
        <span class="search-pointer-label">Pubkey</span>
        <input
          class="search-pointer-input mono"
          class:invalid={!pubkeyCheck.ok}
          type="text"
          autocomplete="off"
          spellcheck="false"
          bind:value={pubkeyText}
          aria-invalid={!pubkeyCheck.ok}
        />
        {#if !pubkeyCheck.ok}
          <span class="search-pointer-error">{pubkeyCheck.error}</span>
        {:else if pubkeyHex}
          <span class="search-pointer-badge">
            <UserBadge pubkey={pubkeyHex} compact />
          </span>
        {/if}
      </label>
      <span class="search-pointer-sep" aria-hidden="true"><span class="search-pointer-sep-mark">:</span></span>
      <label class="search-pointer-part search-pointer-part-wide">
        <span class="search-pointer-label">d-tag</span>
        <input
          class="search-pointer-input"
          class:invalid={!dCheck.ok}
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="(empty for replaceable)"
          bind:value={dText}
          aria-invalid={!dCheck.ok}
        />
        {#if !dCheck.ok}
          <span class="search-pointer-error">{dCheck.error}</span>
        {/if}
      </label>
    </div>
  {:else}
    <div class="search-pointer-parts">
      <label class="search-pointer-part search-pointer-part-wide">
        <span class="search-pointer-label">Event id</span>
        <input
          class="search-pointer-input mono"
          class:invalid={!idCheck.ok}
          type="text"
          autocomplete="off"
          spellcheck="false"
          bind:value={idText}
          aria-invalid={!idCheck.ok}
        />
        {#if !idCheck.ok}
          <span class="search-pointer-error">{idCheck.error}</span>
        {/if}
      </label>
      {#if pointer.author}
        <span class="search-pointer-sep" aria-hidden="true"><span class="search-pointer-sep-mark">·</span></span>
        <div class="search-pointer-part search-pointer-part-wide">
          <span class="search-pointer-label">Author</span>
          <p class="search-pointer-readonly mono">{pointer.author}</p>
          <span class="search-pointer-badge">
            <UserBadge pubkey={pointer.author} compact />
          </span>
        </div>
      {/if}
    </div>
  {/if}
  {#if showRelays}
    <div class="search-pointer-relays" class:invalid={!relaysCheck.ok}>
      <StringListRows
        bind:values={relays}
        label="Relay hints"
        hint={relaysCheck.ok
          ? 'One ws:// or wss:// URL per row. Clear all to drop hints.'
          : relaysCheck.error}
        placeholder="wss://…"
        addLabel="Add relay hint"
        removeLabel="Remove relay hint"
        inputType="url"
        mono
      />
    </div>
  {/if}
  <button type="button" class="btn search-pointer-go" disabled={!canSubmit} onclick={relaunch}>
    Search again
  </button>
</div>
