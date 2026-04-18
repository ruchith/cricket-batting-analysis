#!/usr/bin/env bash
# Start FastAPI backend (native)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

source "$ROOT/.env" 2>/dev/null || true
BACKEND_PORT="${BACKEND_PORT:-8082}"

cd "$ROOT/backend"
export PYTHONPATH="$ROOT/backend"

# Use uv to run with the venv
UV="$HOME/.local/bin/uv"
if [ -f "$UV" ]; then
  "$UV" run uvicorn app.main:app --host 0.0.0.0 --port "$BACKEND_PORT" --reload
else
  python -m uvicorn app.main:app --host 0.0.0.0 --port "$BACKEND_PORT" --reload
fi
