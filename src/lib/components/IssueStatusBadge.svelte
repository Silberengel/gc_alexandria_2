<script lang="ts">
  import type { ResolvedIssueStatus } from '$lib/nip34';

  interface Props {
    status: ResolvedIssueStatus;
  }

  let { status }: Props = $props();
</script>

<span class="issue-status" data-status={status.id}>{status.label}</span>

<style>
  .issue-status {
    display: inline-flex;
    align-items: center;
    padding: 0.1rem 0.45rem;
    border-radius: 0.3rem;
    font-size: 0.72rem;
    font-weight: 650;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    border: 1px solid color-mix(in srgb, var(--rule) 70%, transparent);
    background: color-mix(in srgb, var(--paper-dark) 20%, var(--paper-light));
    color: var(--ink);
  }
  .issue-status[data-status='open'] {
    border-color: color-mix(in srgb, #2f6fed 45%, var(--rule));
    background: color-mix(in srgb, #2f6fed 16%, var(--paper-light));
  }
  .issue-status[data-status='resolved'] {
    border-color: color-mix(in srgb, #1a7f37 45%, var(--rule));
    background: color-mix(in srgb, #1a7f37 16%, var(--paper-light));
  }
  .issue-status[data-status='closed'] {
    border-color: color-mix(in srgb, var(--rule) 90%, transparent);
    opacity: 0.85;
  }
  .issue-status[data-status='draft'] {
    border-color: color-mix(in srgb, #9a6700 45%, var(--rule));
    background: color-mix(in srgb, #9a6700 14%, var(--paper-light));
  }
</style>
