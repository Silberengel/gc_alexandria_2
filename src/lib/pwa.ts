import { writable } from 'svelte/store';
import { APP_VERSION } from './constants';

/**
 * True when a newer build is available (waiting service worker and/or
 * `/version.json` disagrees with the baked-in APP_VERSION).
 */
export const pwaUpdateAvailable = writable(false);

type UpdateSW = (reloadPage?: boolean) => Promise<void>;

let updateSW: UpdateSW | null = null;
let versionWatchStarted = false;

/**
 * Activate the waiting service worker (if any), drop caches, and reload.
 *
 * vite-plugin-pwa's `updateSW(true)` only posts SKIP_WAITING — the page reload
 * is tied to a later `controlling` event, and only if `onNeedRefresh` ran.
 * Version-json prompts often have no waiting worker yet, so we always finish
 * with a hard clean reload (unregister + caches + reload).
 */
export async function applyPwaUpdate(): Promise<void> {
  try {
    if (updateSW) {
      await Promise.race([
        updateSW(true),
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, 500);
        })
      ]);
    }
  } catch (error) {
    console.warn('[pwa] updateServiceWorker failed; forcing clean reload', error);
  }
  // Hide only once reload is committed — earlier clears made the banner
  // flicker off while the page never refreshed.
  pwaUpdateAvailable.set(false);
  await forceCleanReload();
}

async function forceCleanReload(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }
  } catch {
    /* ignore */
  }
  try {
    if ('caches' in globalThis) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    /* ignore */
  }
  globalThis.location?.reload();
}

/** Test helper — inject the SW updater callback vite-plugin-pwa would set. */
export function setPwaUpdateSWForTests(fn: UpdateSW | null): void {
  updateSW = fn;
}

/** Compare the live release file to the shell we are running. */
export async function checkDeployedVersion(): Promise<void> {
  if (import.meta.env.DEV) return;
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as { version?: string };
    const remote = data.version?.trim();
    if (remote && remote !== APP_VERSION) {
      pwaUpdateAvailable.set(true);
    }
  } catch {
    /* offline or blocked — ignore */
  }
}

function startVersionWatch(): void {
  if (versionWatchStarted || import.meta.env.DEV) return;
  versionWatchStarted = true;
  void checkDeployedVersion();
  window.setInterval(() => {
    void checkDeployedVersion();
  }, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkDeployedVersion();
  });
  window.addEventListener('focus', () => {
    void checkDeployedVersion();
  });
}

/**
 * Register the production service worker (vite-plugin-pwa).
 * Skipped in dev so HMR is not intercepted.
 */
export function registerPwa(): void {
  startVersionWatch();
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
          if (!registration) return;
          const poke = () => {
            void registration.update();
            void checkDeployedVersion();
          };
          poke();
          window.setInterval(poke, 5 * 60 * 1000);
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') poke();
          });
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
