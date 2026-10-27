import { writable } from 'svelte/store';

/** Publication reader: TopBar hides on scroll down / shows on scroll up. */
export const topBarAutoHide = writable(false);
