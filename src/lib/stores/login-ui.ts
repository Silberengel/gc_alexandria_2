import { writable } from 'svelte/store';

/** Shared “open the sign-in dialog” flag for TopBar and action buttons. */
export const loginDialogOpen = writable(false);

export function openLoginDialog(): void {
  loginDialogOpen.set(true);
}

export function closeLoginDialog(): void {
  loginDialogOpen.set(false);
}
