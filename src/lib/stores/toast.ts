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

function present(ok: boolean, message: string, ms: number): void {
  const id = ++nextId;
  toast.set({ ok, message, id });
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    toast.update((current) => (current?.id === id ? null : current));
  }, ms);
}

/** Green check when a relay accepted the event; red X when none did. */
export function showPublishResult(ok: boolean, message?: string): void {
  present(
    ok,
    message ?? (ok ? 'Successfully published.' : 'Failed to publish.'),
    4200
  );
}

/** A short status line (signing failures, custom publish copy, non-publish status). */
export function showNotice(message: string, ok = false): void {
  present(ok, message, ok ? 4200 : 7000);
}
