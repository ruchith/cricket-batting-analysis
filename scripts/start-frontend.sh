#!/usr/bin/env bash
# Start Vite dev server
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

source "$ROOT/.env" 2>/dev/null || true
FRONTEND_PORT="${FRONTEND_PORT:-3009}"

cd "$ROOT/frontend"

if [ ! -d node_modules ]; then
  echo "Installing frontend dependencies…"
  npm install
fi

export FRONTEND_PORT="$FRONTEND_PORT"
exec npm run dev -- --port "$FRONTEND_PORT"
