import { writable } from 'svelte/store';
import { APP_BUILD, APP_VERSION } from './constants';

/**
 * True when a newer build is available (waiting service worker and/or
 * `/version.json` disagrees with the baked-in APP_BUILD).
 */
export const pwaUpdateAvailable = writable(false);

type UpdateSW = (reloadPage?: boolean) => Promise<void>;

let updateSW: UpdateSW | null = null;
let versionWatchStarted = false;

const VERSION_POLL_MS = 30_000;
const UPDATE_SW_WAIT_MS = 1_200;

/** How the live `/version.json` relates to this shell. */
export function remoteBuildIsNewer(
  remote: { version?: string; build?: string } | null | undefined
): boolean {
  if (!remote || typeof remote !== 'object') return false;
  const build = remote.build?.trim();
  if (build) return build !== APP_BUILD;
  const version = remote.version?.trim();
  // Legacy stamps without `build` — fall back to semver.
  return Boolean(version && version !== APP_VERSION);
}

async function clearServiceWorkersAndCaches(): Promise<void> {
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
}

/**
 * Drop every SW + Cache Storage entry, then navigate with a cache-busting
 * query so index.html / hashed assets cannot stick from HTTP or bfcache.
 *
 * Prefer this over `location.reload()` — reload often reuses a cached shell.
 */
export async function forceCleanReload(): Promise<void> {
  await clearServiceWorkersAndCaches();
  const url = new URL(globalThis.location.href);
  url.searchParams.set('_pwa', String(Date.now()));
  try {
    globalThis.location.replace(url.toString());
  } catch {
    globalThis.location.href = url.toString();
  }
  // If navigation is blocked somehow, keep hammering.
  globalThis.setTimeout(() => {
    try {
      globalThis.location.reload();
    } catch {
      /* ignore */
    }
  }, 2_000);
}

/**
 * Activate any waiting service worker, then hard-nuke caches and navigate.
 *
 * Keep the banner up until the document unloads — clearing it early made OK
 * look like a no-op when the soft reload never happened.
 */
export async function applyPwaUpdate(): Promise<void> {
  try {
    if (updateSW) {
      await Promise.race([
        updateSW(true),
        new Promise<void>((resolve) => {
          globalThis.setTimeout(resolve, UPDATE_SW_WAIT_MS);
        })
      ]);
    }
  } catch (error) {
    console.warn('[pwa] updateServiceWorker failed; forcing clean reload', error);
  }
  await forceCleanReload();
}

/** Test helper — inject the SW updater callback vite-plugin-pwa would set. */
export function setPwaUpdateSWForTests(fn: UpdateSW | null): void {
  updateSW = fn;
}

/** Compare the live release file to the shell we are running. */
export async function checkDeployedVersion(): Promise<void> {
  if (import.meta.env.DEV) return;
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
    });
    if (!res.ok) return;
    const data = (await res.json()) as { version?: string; build?: string };
    if (remoteBuildIsNewer(data)) {
      pwaUpdateAvailable.set(true);
    }
  } catch {
    /* offline or blocked — ignore */
  }
}

function startVersionWatch(): void {
  if (versionWatchStarted || import.meta.env.DEV) return;
  versionWatchStarted = true;
  const poke = () => {
    void checkDeployedVersion();
  };
  poke();
  window.setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    poke();
  }, VERSION_POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') poke();
  });
  window.addEventListener('focus', poke);
  window.addEventListener('online', poke);
  // Catch bfcache restores that skipped a normal load.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) poke();
  });
}

/**
 * Register the production service worker (vite-plugin-pwa).
 * Skipped in dev so HMR is not intercepted.
 */
export function registerPwa(): void {
  startVersionWatch();
  // Open (and migrate) the manuscript IDB on boot so schema bumps apply even
  // before Compose mounts — same origin DB survives SW updates.
  void import('./publication-manuscripts')
    .then(({ ensureManuscriptDb }) => ensureManuscriptDb())
    .catch((error) => {
      console.warn('[pwa] manuscript DB open/migrate failed', error);
    });
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
            void registration.update().catch(() => {
              /* ignore */
            });
            void checkDeployedVersion();
          };
          poke();
          window.setInterval(() => {
            if (document.visibilityState === 'hidden') return;
            poke();
          }, VERSION_POLL_MS);
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') poke();
          });
          window.addEventListener('focus', poke);
          // A waiting worker that arrived while we were backgrounded.
          registration.addEventListener('updatefound', () => {
            const installing = registration.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                pwaUpdateAvailable.set(true);
              }
            });
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
