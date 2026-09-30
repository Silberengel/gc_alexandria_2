# Alexandria

A Nostr-native digital library. Static Svelte 5 SPA (Vite). No app server and no server-side event database.

Acceptance tests in [`features/`](features/) are the product contract.

## Features

- **Catalog** — Shelves, nested bookshelves, subjects, labels, and search over Mercury, relays, and Brainstorm (NIP-50)
- **Reader** — Edition pages with a table of contents; AsciiDoc, Djot, and Markdown; highlights (kind 9802)
- **Export** — EPUB, PDF, and AsciiDoc
- **Wiki and specs** — Kind 30818 and 30817, versions, wikilinks, NIP-54 deference
- **Discussion** — Comments (kind 1111) and ratings
- **Identity** — Anonymous browse; NIP-07, Amber, bunker, or Pomegranate; profiles and mute lists (kind 10000)
- **Trust** — GrapeRank (NIP-85) filter in Settings
- **Relays** — Document, wiki, and social stacks in one pool; NIP-42 when signed in
- **Cache** — Events and covers in the browser HTTP cache and Cache Storage
- **Appearance** — Antique and Soft Gray, each with dark mode; fonts and text size in `localStorage`
- **PWA** — Installable shell; the service worker caches app assets

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/
npm test         # Vitest
```

TypeScript, Svelte 5, `nostr-tools` (no NDK).

## Deploy

Unpack `dist/` on any host. The site origin is not compiled in.

Relays and pubkeys default to the values in `src/lib/constants.ts`. Set the `VITE_` variable next to a value to replace it. Leave it unset to keep the default. Lists are comma-separated and replace the whole list. `npm run dev` proxies Mercury at `/mercury`.

### Seeds

Douay-Rheims and its two reading plans load from `/seeds/` when that edition is opened.

`public/seeds/manifest.json` and `public/seeds/plans/*.jsonl` are in git. Verse shards `public/seeds/douay/shard-*.jsonl` (up to 2,000 events each) are gitignored. The committed manifest lists `shard-000` through `shard-019`.

Generate the shards where Mercury's HTTP API is reachable. `MERCURY_URL` is that API (default `http://127.0.0.1:4000`), not the public site. The export rewrites the shard list in `manifest.json`. Vite copies `public/seeds/` into `dist/seeds/`.

```bash
npm ci
MERCURY_URL=http://127.0.0.1:4000 npm run seeds:export-douay
npm run build
tar -C dist -czf alexandria-dist.tgz .
```

Without the shard files, the manifest still names them, so the reader treats the Douay as seeded and does not walk Mercury. If a shard cannot be read, Read fetches the index from relays.

### Web server

- Fall back to `index.html` for `/publication/`, `/wiki/`, `/spec/`, `/article/`, `/search`, `/p/`, `/booklists`, `/settings`, `/about`, `/contact`, `/start`, and Douay paths such as `/luke/9`. The app rewrites them to `/#/…`.
- `/seeds/` and `/assets/` must 404 when missing. A shard that returns `index.html` is parsed as verse data.
- `Cache-Control: no-cache` on `index.html`, `sw.js`, and `/seeds/manifest.json`. Long cache on the shard files (`?v=` is already on those URLs).
- EPUB and PDF use `VITE_ASCIIDOCTOR_SERVER_URL` when set. Otherwise proxy `/api/asciidoctor/`.

## Related

- `gc-alexandria` — previous library client
- `gc_index_relay` — Mercury catalog HTTP API
- `jumble` — Imwald web client
- `imwald-android` — companion app
