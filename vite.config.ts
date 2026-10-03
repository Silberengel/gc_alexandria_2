import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { lookup as dnsLookup, setDefaultResultOrder } from 'node:dns';
import { Agent as HttpsAgent } from 'node:https';
import { fileURLToPath, URL } from 'node:url';

setDefaultResultOrder('ipv4first');

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

  return {
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
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
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/healthz$/, /^\/mercury/, /^\/seeds\//],
        runtimeCaching: [
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
      // Wikistr AsciiDoctor sidecar (EPUB/PDF) — same path layout as jumble prod.
      '/api/asciidoctor': {
        target: 'https://jumble.imwald.eu',
        changeOrigin: true,
        agent: ipv4Https,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            const msg = err instanceof Error ? err.message : String(err);
            if (res && 'writeHead' in res && typeof res.writeHead === 'function' && !res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'asciidoctor unavailable', detail: msg }));
            }
          });
        }
      }
    }
  }
  };
});
