<script lang="ts">
  import type { AppHandlerInfo } from '$lib/app-handlers';

  interface Props {
    app: AppHandlerInfo;
    /** When false, render a bare label (parent supplies the link). */
    linked?: boolean;
  }

  let { app, linked = true }: Props = $props();

  const label = $derived(app.about ? `${app.name} — ${app.about}` : app.name);
  const asLink = $derived(linked && !!app.href);
</script>

{#if asLink}
  <a
    class="work-app-link"
    href={app.href}
    target="_blank"
    rel="noopener noreferrer"
    title={label}
  >{app.name}</a>
{:else}
  <span class="work-app-link" title={label}>{app.name}</span>
{/if}

<style>
  .work-app-link {
    color: inherit;
    font-size: inherit;
    font-weight: 400;
    line-height: inherit;
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, currentColor 28%, transparent);
    text-underline-offset: 0.12em;
    opacity: 0.72;
  }
  a.work-app-link:hover,
  a.work-app-link:focus-visible {
    opacity: 0.95;
    text-decoration-color: color-mix(in srgb, currentColor 55%, transparent);
    outline: none;
  }
  span.work-app-link {
    text-decoration: none;
  }
</style>
