import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import { lookup as dnsLookup, setDefaultResultOrder } from 'node:dns';
import { readFileSync } from 'node:fs';
import { Agent as HttpsAgent } from 'node:https';
import { fileURLToPath, URL } from 'node:url';

setDefaultResultOrder('ipv4first');

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/** Short git SHA — changes every deploy even when package.json version does not. */
function resolveGitCommit(): string {
  const fromEnv = (process.env.GIT_COMMIT || process.env.VITE_GIT_COMMIT || '').trim();
  if (fromEnv) return fromEnv.replace(/^"|"$/g, '').slice(0, 12);
  try {
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return 'unknown';
  }
}

const gitCommit = resolveGitCommit();
/** Semver + build id, e.g. `0.4.2+df92b0d`. */
const appBuild = `${pkg.version}+${gitCommit}`;

/**
 * Emit /version.json (not precached). Clients compare `build` so same-semver
 * deploys still raise the update banner.
 */
function versionJsonPlugin(): Plugin {
  return {
    name: 'alexandria-version-json',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ version: pkg.version, build: appBuild }, null, 2)}\n`
      });
    }
  };
}

/** This machine's getaddrinfo fails IPv6-first for *.imwald.eu; A records work. */
const ipv4Https = new HttpsAgent({
  family: 4,
  keepAlive: true,
  lookup(hostname, _opts, cb) {
    dnsLookup(hostname, { family: 4 }, cb);
  }
});

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), '');
  const mercuryHttp = (fileEnv.VITE_MERCURY_HTTP || '').trim();
  let mercuryTarget = 'https://mercury-relay.imwald.eu';
  if (mercuryHttp) {
    try {
      mercuryTarget = new URL(mercuryHttp).origin;
    } catch {
      mercuryTarget = 'https://mercury-relay.imwald.eu';
    }
  }
  // unfold OG preview (embed/embed) — same host imwald blog uses.
  let ogPreviewTarget = 'https://blog.imwald.eu';
  const ogProxy = (fileEnv.VITE_OG_PREVIEW_PROXY_TARGET || '').trim();
  if (ogProxy) {
    try {
      ogPreviewTarget = new URL(ogProxy).origin;
    } catch {
      ogPreviewTarget = 'https://blog.imwald.eu';
    }
  }

  return {
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(appBuild)
  },
  plugins: [
    svelte(),
    versionJsonPlugin(),
    VitePWA({
      // Prompt when a new SW is waiting; banner OK activates it and reloads.
      registerType: 'prompt',
      // Manifest lives in public/ so index.html can link it without duplication.
      manifest: false,
      includeAssets: [
        'favicon.png',
        'pwa-192x192.png',
        'pwa-512x512.png',
        'pwa-maskable-192x192.png',
        'pwa-maskable-512x512.png',
        'screenshots/old_books.jpg'
      ],
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,jpg,svg,ico,webmanifest}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // Falsy disables NavigationRoute. Precached index.html was trapping
        // clients on an old shell after deploys; assets stay precached.
        navigateFallback: null,

        runtimeCaching: [
          {
            // Never cache the deploy stamp — banner detection must hit the network.
            urlPattern: /\/version\.json(?:\?.*)?$/i,
            handler: 'NetworkOnly'
          },
          {
            // Manifest must follow a new export. Shard URLs are versioned (?v=) and stay CacheFirst.
            urlPattern: /\/seeds\/manifest\.json$/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'alexandria-seeds-manifest',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // Local Douay / reading-plan seeds — CacheFirst after first fetch (no precache).
            urlPattern: /\/seeds\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'alexandria-seeds',
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // Google Fonts CSS
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          },
          {
            // Google Fonts files
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // Cover / avatar CDNs — CacheFirst so refresh paints from disk.
            urlPattern:
              /^https:\/\/(i\.nostr\.build|cdn\.nostr\.build|image\.nostr\.build|www\.gutenberg\.org|covers\.openlibrary\.org)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'alexandria-media-cdn',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      },
      devOptions: {
        enabled: false
      }
    })
  ],
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url))
    }
  },
  server: {
    proxy: {
      '/mercury': {
        target: mercuryTarget,
        changeOrigin: true,
        agent: ipv4Https,
        rewrite: (path) => path.replace(/^\/mercury/, ''),
        configure: (proxy) => {
          // DNS/outages are expected to fall back to relays; avoid stacked ENOTFOUND spam.
          proxy.on('error', (err, _req, res) => {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED') || msg.includes('socket hang up')) {
              if (res && 'writeHead' in res && typeof res.writeHead === 'function' && !res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'mercury unavailable' }));
              }
              return;
            }
            console.warn('[vite] mercury proxy error:', msg);
          });
        }
      },
      // Wikistr AsciiDoctor sidecar (EPUB/PDF). Server routes are /convert/*.
      '/api/asciidoctor': {
        target: 'http://127.0.0.1:8091',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/asciidoctor/, ''),
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            const msg = err instanceof Error ? err.message : String(err);
            if (res && 'writeHead' in res && typeof res.writeHead === 'function' && !res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'asciidoctor unavailable', detail: msg }));
            }
          });
        }
      },
      // Open Graph previews — unfold POST /og-preview/ (embed/embed).
      '/api/og-preview': {
        target: ogPreviewTarget,
        changeOrigin: true,
        agent: ipv4Https,
        timeout: 8_000,
        proxyTimeout: 8_000,
        rewrite: () => '/og-preview/',
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            const msg = err instanceof Error ? err.message : String(err);
            const expected =
              msg.includes('ENOTFOUND') ||
              msg.includes('ECONNREFUSED') ||
              msg.includes('ECONNRESET') ||
              msg.includes('socket hang up') ||
              msg.includes('EPIPE');
            if (res && 'writeHead' in res && typeof res.writeHead === 'function' && !res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'text/plain' });
              res.end('og-preview unavailable');
            } else if (!expected) {
              console.warn('[vite] og-preview proxy error:', msg);
            }
          });
        }
      }
    }
  }
  };
});
