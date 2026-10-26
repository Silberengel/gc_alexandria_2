<script lang="ts">
  import type { UserStatus } from '$lib/nip38-user-status';

  interface Props {
    general?: UserStatus | null;
    music?: UserStatus | null;
  }

  let { general = null, music = null }: Props = $props();

  const hasStatus = $derived(!!general || !!music);
</script>

{#if hasStatus}
  <span class="user-status" aria-label="User status">
    {#if general}
      {#if general.linkHref}
        <a
          class="user-status-line"
          href={general.linkHref}
          rel="noopener noreferrer"
          target="_blank"
          title={general.content}
        >
          <span class="user-status-text">{general.content}</span>
        </a>
      {:else}
        <span class="user-status-line" title={general.content}>
          <span class="user-status-text">{general.content}</span>
        </span>
      {/if}
    {/if}
    {#if music}
      {#if music.linkHref}
        <a
          class="user-status-line user-status-music"
          href={music.linkHref}
          rel="noopener noreferrer"
          target="_blank"
          title={music.content}
        >
          <span class="user-status-text">{music.content}</span>
        </a>
      {:else}
        <span class="user-status-line user-status-music" title={music.content}>
          <span class="user-status-text">{music.content}</span>
        </span>
      {/if}
    {/if}
  </span>
{/if}
