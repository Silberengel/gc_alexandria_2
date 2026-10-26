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
  }

  let { event, showMenu = true }: Props = $props();

  const fields = $derived(parseKind0(event));
  const kindLine = $derived(eventKindLabelLine(event));
  const title = $derived(fields.title || 'Unnamed reader');
  const picture = $derived(
    fields.picture && isAllowedHref(fields.picture) ? fields.picture : ''
  );
  const banner = $derived(fields.banner && isAllowedHref(fields.banner) ? fields.banner : '');
  const profileHref = $derived.by(() => {
    try {
      return `#/p/${nip19.npubEncode(event.pubkey)}`;
    } catch {
      return event.pubkey ? `#/p/${event.pubkey}` : '';
    }
  });
</script>

<div class="profile-meta-card">
  {#if showMenu}
    <CopyPointerButton {event} class="generic-card-copy" />
  {/if}
  <div class="profile-meta-inner">
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
      {/if}
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
    {#if fields.about}
      <div class="profile-meta-about">
        {@html aboutHtml(fields.about)}
      </div>
    {/if}
    {#if fields.websites.length}
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
    {#if profileHref}
      <div class="profile-meta-actions">
        <a class="btn profile-meta-open" href={profileHref} use:link>Open profile</a>
      </div>
    {/if}
  </div>
</div>
