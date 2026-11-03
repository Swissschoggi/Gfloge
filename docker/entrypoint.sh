#!/bin/sh
set -e

ROLE="${GF_ROLE:-api}"
DATA_DIR="${GF_HISTORICAL_DATA_DIR:-${GF_DATA_DIR:-/data}}"

# Ensure the persistent data directory exists and is writable by the
# runtime user before any download is attempted.
mkdir -p "$DATA_DIR/historical"
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$DATA_DIR"
fi

echo "[gfloge] applying database migrations"
node --import tsx packages/db/migrate-cli.ts

if [ "$ROLE" = "worker" ]; then
  echo "[gfloge] starting worker"
  exec node --import tsx apps/worker/src/index.ts
fi

echo "[gfloge] starting api"
exec node --import tsx apps/api/src/index.ts
