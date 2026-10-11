import { writable } from 'svelte/store';

/** Lowercased event id whose root reply form is open. */
export const opComposeId = writable<string | null>(null);

/** Events that already show the reply icon on their own toolbar. */
export const opReplyToolbar = writable<Set<string>>(new Set());

export function registerOpReplyToolbar(id: string): () => void {
  const key = id.toLowerCase();
  opReplyToolbar.update((set) => new Set(set).add(key));
  return () => {
    opReplyToolbar.update((set) => {
      const next = new Set(set);
      next.delete(key);
      return next;
    });
    opComposeId.update((cur) => (cur === key ? null : cur));
  };
}

export function toggleOpCompose(id: string): void {
  const key = id.toLowerCase();
  opComposeId.update((cur) => (cur === key ? null : key));
}

export function closeOpCompose(id?: string): void {
  const key = id?.toLowerCase();
  opComposeId.update((cur) => (!key || cur === key ? null : cur));
}
