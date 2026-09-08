#!/usr/bin/env bash
# Build and push silberengel/gc-alexandria-2 to Docker Hub.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
IMAGE="${DOCKER_IMAGE:-silberengel/gc-alexandria-2}"
GIT_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

echo "Building ${IMAGE}:${VERSION} and :latest (commit ${GIT_COMMIT})"
docker build \
  --label "org.opencontainers.image.revision=${GIT_COMMIT}" \
  --label "org.opencontainers.image.version=${VERSION}" \
  -t "${IMAGE}:${VERSION}" \
  -t "${IMAGE}:latest" \
  .

echo "Pushing ${IMAGE}:${VERSION} and :latest"
docker push "${IMAGE}:${VERSION}"
docker push "${IMAGE}:latest"
echo "Done. On the server:"
echo "  docker compose -f docker-compose.prod.yml pull"
echo "  docker compose -f docker-compose.prod.yml up -d"
echo "Apache: see deploy/apache-gc-alexandria.imwald.eu.conf.snippet (port 9071)"
