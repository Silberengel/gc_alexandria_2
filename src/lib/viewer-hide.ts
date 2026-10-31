/**
 * Viewer-local hide for muted events (kind 10000 `e`), including addressable
 * coordinates so a republished replaceable at the same `d` stays hidden.
 * Separate from NIP-09 author deletions.
 */
import { get, writable } from 'svelte/store';
import type { Event } from 'nostr-tools';
import { isAddressableKind } from './nostr/replaceable';
import { firstTag } from './nostr/verify';

function addressableCoord(event: Event): string | null {
  if (!isAddressableKind(event.kind)) return null;
  const d = firstTag(event, 'd');
  if (d == null) return null;
  return `${event.kind}:${event.pubkey.toLowerCase()}:${d}`;
}

export type ViewerHideState = {
  eventIds: Set<string>;
  addresses: Set<string>;
};

export const emptyViewerHideState = (): ViewerHideState => ({
  eventIds: new Set(),
  addresses: new Set()
});

export const viewerHideState = writable<ViewerHideState>(emptyViewerHideState());

export function applyViewerHideState(state: ViewerHideState): void {
  viewerHideState.set({
    eventIds: new Set(state.eventIds),
    addresses: new Set(state.addresses)
  });
}

export function clearViewerHide(): void {
  viewerHideState.set(emptyViewerHideState());
}

/** Merge mute-list `e` ids (and known addressable coords) into viewer-hide. */
export function viewerHideFromMuteEventIds(
  eventIds: Iterable<string>,
  addressHints: Iterable<string> = []
): ViewerHideState {
  const state = emptyViewerHideState();
  for (const id of eventIds) {
    const key = id.trim().toLowerCase();
    if (/^[0-9a-f]{64}$/i.test(key)) state.eventIds.add(key);
  }
  for (const addr of addressHints) {
    const key = addr.trim().toLowerCase();
    if (key.includes(':')) state.addresses.add(key);
  }
  return state;
}

export function rememberViewerHideTarget(event: Event, state: ViewerHideState = get(viewerHideState)): void {
  const next = {
    eventIds: new Set(state.eventIds),
    addresses: new Set(state.addresses)
  };
  next.eventIds.add(event.id.toLowerCase());
  const coord = addressableCoord(event);
  if (coord) next.addresses.add(coord.toLowerCase());
  // Also record raw `kind:pubkey:d` from tags when present.
  if (isAddressableKind(event.kind)) {
    const d = firstTag(event, 'd');
    if (d != null) {
      next.addresses.add(`${event.kind}:${event.pubkey.toLowerCase()}:${d}`.toLowerCase());
    }
  }
  applyViewerHideState(next);
}

export function forgetViewerHideTarget(event: Event, state: ViewerHideState = get(viewerHideState)): void {
  const next = {
    eventIds: new Set(state.eventIds),
    addresses: new Set(state.addresses)
  };
  next.eventIds.delete(event.id.toLowerCase());
  const coord = addressableCoord(event);
  if (coord) next.addresses.delete(coord.toLowerCase());
  applyViewerHideState(next);
}

export function isViewerHidden(
  event: Event,
  state: ViewerHideState = get(viewerHideState)
): boolean {
  if (state.eventIds.has(event.id.toLowerCase())) return true;
  if (!state.addresses.size) return false;
  const coord = addressableCoord(event);
  if (coord && state.addresses.has(coord.toLowerCase())) return true;
  return false;
}
