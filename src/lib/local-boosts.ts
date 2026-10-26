import { writable } from 'svelte/store';

/**
 * Bumps when the viewer publishes or deletes a kind 6/16 so FeedBoosters can
 * merge memory-indexed boosts without waiting for a relay echo / refresh.
 */
export const boostPaintRevision = writable(0);

export function bumpBoostPaint(): void {
  boostPaintRevision.update((n) => n + 1);
}
