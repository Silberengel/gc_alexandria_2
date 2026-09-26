# Multi-stage build: Vite static SPA → nginx
FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
# The image must ship the Douay verses and both reading plans. Shards are
# generated (gitignored); a build without them would silently fall back to Mercury.
RUN test -s public/seeds/manifest.json \
 && test -s public/seeds/plans/bible-in-a-year.jsonl \
 && test -s public/seeds/plans/chronological.jsonl \
 && test -s public/seeds/douay/shard-000.jsonl \
 && test -s public/seeds/douay/shard-019.jsonl
RUN npm run build

FROM nginx:alpine

LABEL org.opencontainers.image.title="gc-alexandria-2" \
  org.opencontainers.image.description="Library of Alexandria (Svelte SPA)" \
  org.opencontainers.image.source="https://github.com/Silberengel/gc_alexandria_2"

COPY --from=builder /app/dist /usr/share/nginx/html
COPY deploy/nginx-default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
