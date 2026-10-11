import type { Event } from 'nostr-tools';
import { writable } from 'svelte/store';

export const rawEventViewer = writable<Event | null>(null);

export function openRawEvent(event: Event): void {
  rawEventViewer.set(event);
}

export function closeRawEvent(): void {
  rawEventViewer.set(null);
}
