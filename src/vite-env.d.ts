/// <reference types="svelte" />
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/vanillajs" />

/** Semver from package.json at build time (see vite.config.ts). */
declare const __APP_VERSION__: string;
/** Semver+git SHA at build time, e.g. `0.4.2+df92b0d`. */
declare const __APP_BUILD__: string;

interface ImportMetaEnv {
  readonly VITE_SOCIAL_SEARCH_RELAYS?: string;
}
