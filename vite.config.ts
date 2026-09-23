import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
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
        navigateFallbackDenylist: [/^\/healthz$/, /^\/mercury/],
        runtimeCaching: [
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
        target: 'https://mercury-relay.imwald.eu',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/mercury/, ''),
        configure: (proxy) => {
          // DNS/outages are expected to fall back to relays; avoid stacked ENOTFOUND spam.
          proxy.on('error', (err, _req, res) => {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED')) {
              if (res && 'writeHead' in res && typeof res.writeHead === 'function' && !res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'mercury unavailable' }));
              }
              return;
            }
            console.warn('[vite] mercury proxy error:', msg);
          });
        }
      }
    }
  }
});
