#!/usr/bin/env bash
# Build and push silberengel/gc-alexandria-2 to Docker Hub.
# Vendors the sibling kind-compose-catalog (file:../) into the build context.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
IMAGE="${DOCKER_IMAGE:-silberengel/gc-alexandria-2}"
GIT_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
CATALOG_SRC="$(cd "$ROOT/../kind-compose-catalog" && pwd)"
CONTEXT="$(mktemp -d "${TMPDIR:-/tmp}/gc-alexandria-build.XXXXXX")"
cleanup() { rm -rf "$CONTEXT"; }
trap cleanup EXIT

echo "Staging build context (catalog from ${CATALOG_SRC})"
rsync -a \
  --exclude node_modules \
  --exclude dist \
  --exclude .git \
  --exclude .github \
  --exclude .cursor \
  --exclude features \
  --exclude coverage \
  --exclude .vscode \
  --exclude .idea \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '**/*.test.ts' \
  --exclude playwright-report \
  --exclude test-results \
  "$ROOT/" "$CONTEXT/"

mkdir -p "$CONTEXT/vendor"
rsync -a \
  --exclude node_modules \
  --exclude .git \
  "$CATALOG_SRC/" "$CONTEXT/vendor/kind-compose-catalog/"

# Ensure catalog dist is present for the image build.
if [[ ! -f "$CONTEXT/vendor/kind-compose-catalog/dist/index.js" ]]; then
  (cd "$CONTEXT/vendor/kind-compose-catalog" && npm ci --omit=dev && npm run build)
fi

node -e "
const fs = require('fs');
const path = require('path');
const ctx = process.argv[1];
const pkgPath = path.join(ctx, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.dependencies['@silberengel/kind-compose-catalog'] = 'file:./vendor/kind-compose-catalog';
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
" "$CONTEXT"

# Refresh lockfile inside the staged context so npm ci resolves the vendored path.
(cd "$CONTEXT" && npm install --package-lock-only --ignore-scripts >/dev/null)

echo "Building ${IMAGE}:${VERSION} and :latest (commit ${GIT_COMMIT})"
docker build \
  --build-arg "GIT_COMMIT=${GIT_COMMIT}" \
  --label "org.opencontainers.image.revision=${GIT_COMMIT}" \
  --label "org.opencontainers.image.version=${VERSION}" \
  -t "${IMAGE}:${VERSION}" \
  -t "${IMAGE}:latest" \
  "$CONTEXT"

echo "Pushing ${IMAGE}:${VERSION} and :latest"
docker push "${IMAGE}:${VERSION}"
docker push "${IMAGE}:latest"
echo "Done. On the server:"
echo "  docker compose -f docker-compose.prod.yml pull"
echo "  docker compose -f docker-compose.prod.yml up -d"
echo "Apache: see deploy/apache-gc-alexandria.imwald.eu.conf.snippet (port 9071)"
