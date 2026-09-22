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
    {#if music}
      {#if music.linkHref}
        <a
          class="user-status-line"
          href={music.linkHref}
          rel="noopener noreferrer"
          target="_blank"
          title={music.content}
        >
          <svg class="user-status-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
            />
          </svg>
          <span class="user-status-text">{music.content}</span>
        </a>
      {:else}
        <span class="user-status-line" title={music.content}>
          <svg class="user-status-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
            />
          </svg>
          <span class="user-status-text">{music.content}</span>
        </span>
      {/if}
    {/if}
    {#if general}
      {#if general.linkHref}
        <a
          class="user-status-line"
          href={general.linkHref}
          rel="noopener noreferrer"
          target="_blank"
          title={general.content}
        >
          <svg class="user-status-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M22 12h-4l-3 9L9 3l-3 9H2"
            />
          </svg>
          <span class="user-status-text">{general.content}</span>
        </a>
      {:else}
        <span class="user-status-line" title={general.content}>
          <svg class="user-status-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M22 12h-4l-3 9L9 3l-3 9H2"
            />
          </svg>
          <span class="user-status-text">{general.content}</span>
        </span>
      {/if}
    {/if}
  </span>
{/if}
