<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { nip19 } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import CopyPointerButton from './CopyPointerButton.svelte';
  import Nip05Badge from './Nip05Badge.svelte';
  import { aboutHtml, parseKind0 } from '$lib/profile-fields';
  import { isAllowedHref } from '$lib/markup';
  import { toNostrBuildThumbUrl } from '$lib/nostr-build';
  import { cropRenderedUrl } from '$lib/crop-url';
  import { openMediaViewer } from '$lib/stores/media-viewer';
  import { eventKindLabelLine } from '$lib/kind-label';

  interface Props {
    event: Event;
    /** When false, hide the ⋯ menu (embedded citations). */
    showMenu?: boolean;
    /**
     * Search / embed listing tile: no banner; pic, handle, short npub, about.
     */
    compact?: boolean;
  }

  let { event, showMenu = true, compact = false }: Props = $props();

  const fields = $derived(parseKind0(event));
  const kindLine = $derived(eventKindLabelLine(event));
  const title = $derived(fields.title || 'Unnamed reader');
  const handle = $derived(fields.name.trim());
  const picture = $derived(
    fields.picture && isAllowedHref(fields.picture) ? fields.picture : ''
  );
  const banner = $derived(fields.banner && isAllowedHref(fields.banner) ? fields.banner : '');
  const npub = $derived.by(() => {
    try {
      return nip19.npubEncode(event.pubkey);
    } catch {
      return '';
    }
  });
  const shortNpub = $derived(
    npub ? `${npub.slice(0, 12)}…${npub.slice(-4)}` : event.pubkey.slice(0, 8) + '…'
  );
  const profileHref = $derived(
    npub ? `#/p/${npub}` : event.pubkey ? `#/p/${event.pubkey}` : ''
  );
</script>

<div class="profile-meta-card" class:profile-meta-compact={compact}>
  {#if showMenu}
    <CopyPointerButton {event} class="generic-card-copy" />
  {/if}
  <div class="profile-meta-inner">
    {#if !compact && (banner || picture)}
      <div
        class="profile-meta-hero"
        class:profile-meta-hero-banner={Boolean(banner)}
        class:profile-meta-hero-pic={Boolean(picture)}
      >
        <div class="profile-meta-hero-media">
          {#if banner}
            <button
              type="button"
              class="profile-meta-banner"
              title="View banner"
              aria-label={`View banner for ${title}`}
              onclick={() => openMediaViewer({ url: banner, title })}
            >
              <img src={toNostrBuildThumbUrl(banner)} alt="" />
            </button>
          {/if}
          {#if picture}
            <button
              type="button"
              class="profile-meta-avatar"
              title="View profile picture"
              aria-label={`View profile picture of ${title}`}
              onclick={() => openMediaViewer({ url: picture, title })}
            >
              <img src={toNostrBuildThumbUrl(picture)} alt="" />
            </button>
          {/if}
        </div>
        <div class="profile-meta-text profile-meta-hero-text">
          <p class="profile-meta-kind muted">{kindLine}</p>
          <h3 class="profile-meta-title">{title}</h3>
          {#if fields.displayName && fields.name && fields.name !== fields.displayName}
            <p class="muted profile-meta-name">{fields.name}</p>
          {/if}
          {#if fields.nip05List.length}
            <ul class="profile-meta-nip05">
              {#each fields.nip05List as n}
                <li><Nip05Badge nip05={n} pubkey={event.pubkey} /></li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>
    {:else if !compact}
      <div class="profile-meta-identity">
        <div class="profile-meta-text">
          <p class="profile-meta-kind muted">{kindLine}</p>
          <h3 class="profile-meta-title">{title}</h3>
          {#if fields.displayName && fields.name && fields.name !== fields.displayName}
            <p class="muted profile-meta-name">{fields.name}</p>
          {/if}
          {#if fields.nip05List.length}
            <ul class="profile-meta-nip05">
              {#each fields.nip05List as n}
                <li><Nip05Badge nip05={n} pubkey={event.pubkey} /></li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>
    {/if}
    {#if compact}
      <div class="profile-meta-identity">
        {#if picture}
          <button
            type="button"
            class="profile-meta-avatar"
            title="View profile picture"
            aria-label={`View profile picture of ${title}`}
            onclick={() => openMediaViewer({ url: picture, title })}
          >
            <img src={toNostrBuildThumbUrl(picture)} alt="" />
          </button>
        {:else}
          <div class="profile-meta-avatar profile-meta-avatar-empty" aria-hidden="true"></div>
        {/if}
        <div class="profile-meta-text">
          <h3 class="profile-meta-title">
            {#if handle}@{handle}{:else}{title}{/if}
          </h3>
          {#if handle && fields.displayName && fields.displayName !== handle}
            <p class="muted profile-meta-name">{fields.displayName}</p>
          {/if}
          <p class="muted profile-meta-npub" title={npub || event.pubkey}>{shortNpub}</p>
          {#if fields.nip05}
            <ul class="profile-meta-nip05">
              <li><Nip05Badge nip05={fields.nip05} pubkey={event.pubkey} /></li>
            </ul>
          {/if}
        </div>
      </div>
    {/if}
    {#if fields.about}
      <div class="profile-meta-about">
        {@html aboutHtml(fields.about)}
      </div>
    {/if}
    {#if !compact && fields.websites.length}
      <ul class="profile-meta-links">
        {#each fields.websites as url}
          {#if isAllowedHref(url)}
            <li>
              <a href={url} rel="noopener noreferrer" title={url}>{cropRenderedUrl(url)}</a>
            </li>
          {/if}
        {/each}
      </ul>
    {/if}
    {#if profileHref && !compact}
      <div class="profile-meta-actions">
        <a class="btn profile-meta-open" href={profileHref} use:link>Open profile</a>
      </div>
    {/if}
  </div>
</div>
