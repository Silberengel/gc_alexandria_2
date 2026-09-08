<script lang="ts">
  interface Props {
    /** Filled amount on a 1–5 scale (fractional supported for averages). */
    value: number;
    size?: number;
    label?: string;
  }

  let { value, size = 16, label }: Props = $props();

  const clamped = $derived(Math.min(5, Math.max(0, value)));

  function fillFor(index: number): number {
    const remain = clamped - index;
    if (remain >= 1) return 1;
    if (remain <= 0) return 0;
    return remain;
  }
</script>

<span
  class="stars"
  style={`--star-size:${size}px`}
  role="img"
  aria-label={label ?? `${clamped.toFixed(1)} out of 5 stars`}
>
  {#each [0, 1, 2, 3, 4] as i}
    {@const fill = fillFor(i)}
    <span class="star" aria-hidden="true">
      <svg class="star-outline" viewBox="0 0 24 24" width={size} height={size}>
        <path
          d="M12 2.5l2.9 5.88 6.49.94-4.7 4.58 1.11 6.47L12 17.77l-5.8 3.05 1.11-6.47-4.7-4.58 6.49-.94L12 2.5z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linejoin="round"
        />
      </svg>
      {#if fill > 0}
        <span class="star-fill" style={`width:${fill * 100}%`}>
          <svg viewBox="0 0 24 24" width={size} height={size}>
            <path
              d="M12 2.5l2.9 5.88 6.49.94-4.7 4.58 1.11 6.47L12 17.77l-5.8 3.05 1.11-6.47-4.7-4.58 6.49-.94L12 2.5z"
              fill="currentColor"
            />
          </svg>
        </span>
      {/if}
    </span>
  {/each}
</span>

<style>
  .stars {
    display: inline-flex;
    align-items: center;
    gap: 0.12em;
    color: var(--accent);
    vertical-align: middle;
    line-height: 1;
  }
  .star {
    position: relative;
    display: inline-block;
    width: var(--star-size);
    height: var(--star-size);
    flex-shrink: 0;
  }
  .star-outline {
    display: block;
    color: color-mix(in srgb, var(--ink) 32%, transparent);
  }
  .star-fill {
    position: absolute;
    inset: 0 auto 0 0;
    overflow: hidden;
    color: var(--accent);
  }
  .star-fill svg {
    display: block;
  }
</style>
