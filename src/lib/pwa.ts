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
      registerSW({
        immediate: true,
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
