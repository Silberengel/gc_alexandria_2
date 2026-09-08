import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [svelte()],
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
