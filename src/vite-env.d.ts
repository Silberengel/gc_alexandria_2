/// <reference types="svelte" />
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/vanillajs" />

/** Baked from package.json at build time (see vite.config.ts). */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_SOCIAL_SEARCH_RELAYS?: string;
}
