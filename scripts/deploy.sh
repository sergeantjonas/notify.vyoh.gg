#!/usr/bin/env bash
# Deploys the notify hub to the shared VPS, from a laptop.
#
#   scripts/deploy.sh                                  # the current commit's image
#   NOTIFY_IMAGE_TAG=sha-abc1234 scripts/deploy.sh     # a rollback, or a retry
#
# A rollback is a tag, not a rebuild, and it does not undo a migration:
# migrations run on every boot and are forward-only.
set -euo pipefail

HOST="${NOTIFY_DEPLOY_HOST:-vyoh}"
REMOTE_DIR="${NOTIFY_REMOTE_DIR:-/srv/notify}"
IMAGE="ghcr.io/sergeantjonas/notify"
PUBLIC_URL="${NOTIFY_URL:-https://notify.vyoh.gg}"
# Must match compose's default.
API_PORT="${API_PORT:-2013}"

cd "$(dirname "$0")/.."

TAG="${NOTIFY_IMAGE_TAG:-sha-$(git rev-parse --short=7 HEAD)}"
[[ "$TAG" =~ ^(sha-[0-9a-f]{7}|main)$ ]] || {
  echo "refusing to deploy an unrecognised tag: $TAG" >&2
  exit 1
}

# Checked before anything on the box is touched: CI pushes only after its
# smoke passes, so a missing image is a run that failed or is still going.
echo "==> checking $TAG is published"
docker manifest inspect "$IMAGE:$TAG" >/dev/null 2>&1 || {
  echo "$IMAGE:$TAG is not on the registry — has CI finished?" >&2
  exit 1
}

# Only the ops surface, and never .env: production secrets have no local
# counterpart, and nothing here may overwrite them.
echo "==> copying the ops surface to $HOST:$REMOTE_DIR"
ssh "$HOST" "mkdir -p '$REMOTE_DIR'"
rsync -az compose.prod.yaml "$HOST:$REMOTE_DIR/"
rsync -az --delete deploy/ "$HOST:$REMOTE_DIR/deploy/"

# --wait-timeout, because `restart: unless-stopped` means a container that
# crash-loops — a failing migration, most likely — never reaches "exited".
echo "==> pulling and starting $TAG"
ssh "$HOST" "cd '$REMOTE_DIR' && NOTIFY_IMAGE_TAG='$TAG' docker compose -f compose.prod.yaml pull --quiet \
  && NOTIFY_IMAGE_TAG='$TAG' docker compose -f compose.prod.yaml up -d --no-build --wait --wait-timeout 180"
ssh "$HOST" "echo '$TAG' > '$REMOTE_DIR/.image-tag'"

# Loopback first, separating "the container is wrong" from "nginx, DNS or TLS
# is wrong"; /ready as well, since /health answers without the database.
echo "==> smoking loopback"
ssh "$HOST" "curl -fsS http://127.0.0.1:$API_PORT/health >/dev/null \
  && curl -fsS http://127.0.0.1:$API_PORT/ready >/dev/null"

# Then the public URL, the only check covering DNS, the vhost, the certificate
# and the firewall at once. The body names the service: without the vhost,
# nginx answers this name from another tenant's server block.
echo "==> smoking $PUBLIC_URL"
curl -fsS "$PUBLIC_URL/health" | grep -q '"service":"notify"' \
  || { echo "$PUBLIC_URL/health did not answer as the hub — is the vhost installed?" >&2; exit 1; }

# Scoped to this project's images: the daemon is shared, and an unscoped prune
# takes the other tenants' rollback targets with it.
ssh "$HOST" "docker image prune -f --filter 'label=org.opencontainers.image.source=https://github.com/sergeantjonas/notify.vyoh.gg' >/dev/null || true"
echo "==> deployed $TAG"
