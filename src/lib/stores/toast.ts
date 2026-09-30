import { writable } from 'svelte/store';

export type PublishToast = {
  ok: boolean;
  message: string;
  id: number;
};

const toast = writable<PublishToast | null>(null);
let hideTimer = 0;
let nextId = 0;

export { toast };

/** Green check when a relay accepted the event; red X when none did. */
export function showPublishResult(ok: boolean): void {
  const id = ++nextId;
  toast.set({
    ok,
    message: ok ? 'Successfully published.' : 'Failed to published.',
    id
  });
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    toast.update((current) => (current?.id === id ? null : current));
  }, 4200);
}
