#!/usr/bin/env bash
# Start Redis on the configured port (native, no Docker required)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

source "$ROOT/.env" 2>/dev/null || true
REDIS_PORT="${REDIS_PORT:-6382}"

echo "Starting Redis on port $REDIS_PORT..."
exec redis-server --port "$REDIS_PORT" --daemonize no --loglevel notice
