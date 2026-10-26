import { writable } from 'svelte/store';

/**
 * True when a newer service worker is waiting. Landing shows an update banner
 * so the reader can apply it deliberately (vite-plugin-pwa `prompt` mode).
 */
export const pwaUpdateAvailable = writable(false);

type UpdateSW = (reloadPage?: boolean) => Promise<void>;

let updateSW: UpdateSW | null = null;

/** Activate the waiting service worker and reload the page. */
export function applyPwaUpdate(): void {
  pwaUpdateAvailable.set(false);
  if (!updateSW) {
    globalThis.location?.reload();
    return;
  }
  void updateSW(true);
}

/**
 * Register the production service worker (vite-plugin-pwa).
 * Skipped in dev so HMR is not intercepted.
 */
export function registerPwa(): void {
  if (import.meta.env.DEV) return;
  if (typeof window === 'undefined' || !window.isSecureContext) return;
  if (!('serviceWorker' in navigator)) return;

  void import('virtual:pwa-register')
    .then(({ registerSW }) => {
      updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
          pwaUpdateAvailable.set(true);
        },
        onRegisteredSW(_swUrl, registration) {
          // Periodic update checks while the tab stays open.
          if (!registration) return;
          window.setInterval(() => {
            void registration.update();
          }, 60 * 60 * 1000);
        },
        onRegisterError(error) {
          console.warn('[pwa] service worker registration failed', error);
        }
      });
    })
    .catch((error) => {
      console.warn('[pwa] register module unavailable', error);
    });
}
