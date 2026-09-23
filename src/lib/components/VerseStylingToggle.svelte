<script lang="ts">
  import { verseStyling } from '$lib/stores/verse-styling';
</script>

<div class="verse-styling-toggle">
  <span class="verse-styling-label">Verse styling</span>
  <button
    type="button"
    class="verse-styling-switch"
    class:on={$verseStyling}
    role="switch"
    aria-checked={$verseStyling}
    aria-label="Verse styling"
    onclick={() => verseStyling.toggle()}
  >
    <span class="verse-styling-thumb" aria-hidden="true"></span>
  </button>
</div>
