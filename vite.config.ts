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
        rewrite: (path) => path.replace(/^\/mercury/, '')
      }
    }
  }
});
