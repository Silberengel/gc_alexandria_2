import { mount, unmount } from 'svelte';
import UserBadge from '$lib/components/UserBadge.svelte';

const SLOT_SEL = '.nostr-mention-slot[data-nostr-pubkey]';

/**
 * Mount compact UserBadges into inline mention slots left in rendered markup.
 * Returns a disposer that unmounts every badge this call created.
 */
export function attachInlineMentions(root: HTMLElement): () => void {
  const slots = root.querySelectorAll<HTMLElement>(SLOT_SEL);
  const cleanups: Array<() => void> = [];
  for (const slot of slots) {
    if (slot.dataset.mentionMounted === '1') continue;
    const pubkey = (slot.getAttribute('data-nostr-pubkey') ?? '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(pubkey)) continue;
    try {
      slot.replaceChildren();
      const ui = mount(UserBadge, {
        target: slot,
        props: { pubkey, compact: true }
      });
      slot.dataset.mentionMounted = '1';
      cleanups.push(() => {
        try {
          unmount(ui);
        } catch {
          /* already gone */
        }
        delete slot.dataset.mentionMounted;
      });
    } catch {
      delete slot.dataset.mentionMounted;
    }
  }
  return () => {
    for (const stop of cleanups) stop();
  };
}
