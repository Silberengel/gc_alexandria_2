<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import { parseAppHandler } from '$lib/app-handlers';
  import { kindDescription } from '$lib/kind-label';
  import CopyPointerButton from './CopyPointerButton.svelte';
  import AppHandlerIcon from './AppHandlerIcon.svelte';
  import UserBadge from './UserBadge.svelte';

  interface Props {
    event: Event;
    showMenu?: boolean;
    /** Compact strip (icon + name only) vs full card. */
    compact?: boolean;
  }

  let { event, showMenu = true, compact = false }: Props = $props();

  const info = $derived(parseAppHandler(event));
  const kindChips = $derived((info?.supportedKinds ?? []).slice(0, 12));
  const extraKinds = $derived(Math.max(0, (info?.supportedKinds.length ?? 0) - kindChips.length));
</script>

{#if info}
  {#if compact}
    <div class="app-handler-chip">
      {#if showMenu}
        <CopyPointerButton {event} class="app-handler-chip-menu" />
      {/if}
      <AppHandlerIcon app={info} />
    </div>
  {:else}
    <article class="card app-handler-card">
      {#if showMenu}
        <CopyPointerButton {event} class="generic-card-copy" />
      {/if}
      <div class="card-clip app-handler-card-inner">
        <p class="app-handler-kind muted">KIND: 31990 · App handler</p>
        <div class="app-handler-hero">
          <div class="app-handler-hero-text">
            <h3 class="app-handler-title">
              {#if info.href}
                <a href={info.href} target="_blank" rel="noopener noreferrer">{info.name}</a>
              {:else}
                {info.name}
              {/if}
            </h3>
            <p class="app-handler-by muted">
              by <UserBadge pubkey={event.pubkey} />
            </p>
          </div>
        </div>
        {#if info.about}
          <p class="app-handler-about">{info.about}</p>
        {/if}
        {#if info.website || info.href}
          <p class="app-handler-link-row">
            <a
              class="app-handler-site"
              href={info.website || info.href}
              target="_blank"
              rel="noopener noreferrer"
            >{info.website || info.href}</a>
          </p>
        {/if}
        {#if info.topics.length}
          <div class="chip-row">
            {#each info.topics as topic}
              <a
                class="chip chip-quiet"
                href={`#/search?subject=${encodeURIComponent(topic)}`}
                use:link>{topic}</a
              >
            {/each}
          </div>
        {/if}
        {#if kindChips.length}
          <div class="app-handler-kinds">
            <span class="app-handler-kinds-label muted">Handles</span>
            <div class="chip-row">
              {#each kindChips as k}
                <span class="chip chip-quiet" title={kindDescription(k)}>{k}</span>
              {/each}
              {#if extraKinds}
                <span class="muted app-handler-kinds-more">+{extraKinds}</span>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    </article>
  {/if}
{/if}

<style>
  .app-handler-chip {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    max-width: 100%;
  }
  .app-handler-chip :global(.app-handler-chip-menu) {
    position: absolute;
    top: -0.15rem;
    right: -0.15rem;
  }
  .app-handler-card {
    position: relative;
  }
  .app-handler-card-inner {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .app-handler-kind {
    margin: 0;
    font-size: 0.75rem;
  }
  .app-handler-hero {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }
  .app-handler-hero-text {
    min-width: 0;
    flex: 1 1 auto;
  }
  .app-handler-title {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 700;
    line-height: 1.25;
  }
  .app-handler-title a {
    color: inherit;
    text-decoration: none;
  }
  .app-handler-title a:hover,
  .app-handler-title a:focus-visible {
    text-decoration: underline;
  }
  .app-handler-by {
    margin: 0.2rem 0 0;
    font-size: 0.88rem;
  }
  .app-handler-about {
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.45;
    white-space: pre-wrap;
  }
  .app-handler-link-row {
    margin: 0;
  }
  .app-handler-site {
    font-size: 0.88rem;
    word-break: break-all;
  }
  .app-handler-kinds {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .app-handler-kinds-label {
    font-size: 0.72rem;
    font-weight: 650;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .app-handler-kinds-more {
    font-size: 0.82rem;
    align-self: center;
  }
</style>
