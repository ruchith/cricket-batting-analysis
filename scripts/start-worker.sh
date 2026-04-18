#!/usr/bin/env bash
# Start arq worker (native)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

source "$ROOT/.env" 2>/dev/null || true

cd "$ROOT/backend"
export PYTHONPATH="$ROOT/backend"

UV="$HOME/.local/bin/uv"
if [ -f "$UV" ]; then
  "$UV" run arq app.worker.settings.WorkerSettings
else
  python -m arq app.worker.settings.WorkerSettings
fi
