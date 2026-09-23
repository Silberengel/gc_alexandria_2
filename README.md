# Alexandria

A Nostr-native digital library — browse publications, read editions, and discuss works in the browser. Static Svelte 5 SPA (Vite); no app server or server-side event DB.

Acceptance tests in [`features/`](features/) are the product contract. `@mvp` ships first; `@phase2` is deferred.

## Features

- **Catalog** — Cover shelves, nested bookshelves, subjects, labels, and search over Mercury + relays + Brainstorm
- **Reader** — Edition pages with ToC; AsciiDoc, Djot, and Markdown (sanitized); in-reader highlights (kind 9802)
- **Wiki** — Article versions, wikilinks, NIP-54 deference
- **Discussion** — Comments (kind 1111) and ratings on publications
- **Identity** — Anonymous browse; NIP-07 / Amber / bunker / Pomegranate sign-in; profiles and mute lists (kind 10000)
- **Trust** — Brainstorm NIP-50 search and NIP-85 GrapeRank scores; Trust filter in Settings
- **Relays** — Central selector (document / wiki / social stacks), shared pool with AUTH, Mercury HTTPS for catalog
- **Client cache** — Events and covers in HTTP cache / Cache Storage; themes in `localStorage`
- **Appearance** — Antique, Ocean, Forrest, and Soft Gray themes; mobile-first layout
- **PWA** — Installable app shell with offline-capable static assets (service worker)

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static output in dist/
npm test         # Vitest + Playwright against features/
```

Stack: TypeScript, Svelte 5, `nostr-tools` (no NDK).

## Deploy

Image: `silberengel/gc-alexandria-2` (host port **9071**).

```bash
docker login && ./scripts/build-and-push.sh
docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d
```

TLS vhost snippet: [`deploy/apache-gc-alexandria.imwald.eu.conf.snippet`](deploy/apache-gc-alexandria.imwald.eu.conf.snippet). Production Mercury: `https://mercury-relay.imwald.eu`.

## Related

- `gc-alexandria` — current site
- `gc_index_relay` — Mercury catalog HTTP API
- `jumble` — Imwald web client
- `imwald-android` — companion app
