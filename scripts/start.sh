#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
PID_DIR="$ROOT/.pids"
LOG_DIR="$ROOT/logs"

# Export all vars from .env so child processes (uvicorn, arq) inherit them
set -a; source "$ROOT/.env" 2>/dev/null || true; set +a
REDIS_PORT="${REDIS_PORT:-6382}"
BACKEND_PORT="${BACKEND_PORT:-8082}"
FRONTEND_PORT="${FRONTEND_PORT:-3009}"

mkdir -p "$PID_DIR" "$LOG_DIR"

echo "Starting Cricket Batting Analysis..."

# ── Redis ──────────────────────────────────────────────────────────────────────
redis-server --port "$REDIS_PORT" --daemonize yes \
  --logfile "$LOG_DIR/redis.log" \
  --pidfile "$PID_DIR/redis.pid"
echo "  ✓ Redis      port=$REDIS_PORT  log=logs/redis.log"

for i in $(seq 1 10); do
  redis-cli -p "$REDIS_PORT" ping &>/dev/null && break
  sleep 0.5
done

# ── Backend ────────────────────────────────────────────────────────────────────
cd "$ROOT/backend"
export PYTHONPATH="$ROOT/backend"
nohup ~/.local/bin/uv run uvicorn app.main:app \
  --host 0.0.0.0 --port "$BACKEND_PORT" \
  > "$LOG_DIR/backend-uvicorn.log" 2>&1 &
echo $! > "$PID_DIR/backend.pid"
echo "  ✓ Backend    port=$BACKEND_PORT  log=logs/backend.log  (uvicorn stderr → logs/backend-uvicorn.log)"

# ── Worker ─────────────────────────────────────────────────────────────────────
nohup ~/.local/bin/uv run arq app.worker.settings.WorkerSettings \
  > "$LOG_DIR/worker-arq.log" 2>&1 &
echo $! > "$PID_DIR/worker.pid"
echo "  ✓ Worker               log=logs/worker.log  (arq stderr → logs/worker-arq.log)"

# ── Frontend ───────────────────────────────────────────────────────────────────
cd "$ROOT/frontend"
if [ ! -d node_modules ]; then
  echo "  Installing frontend dependencies..."
  npm install --silent
fi
export FRONTEND_PORT="$FRONTEND_PORT"
nohup npm run dev -- --port "$FRONTEND_PORT" \
  > "$LOG_DIR/frontend.log" 2>&1 &
echo $! > "$PID_DIR/frontend.pid"
echo "  ✓ Frontend   port=$FRONTEND_PORT  log=logs/frontend.log"

echo ""
echo "  Frontend: http://localhost:$FRONTEND_PORT"
echo "  API:      http://localhost:$BACKEND_PORT"
echo "  API docs: http://localhost:$BACKEND_PORT/docs"
echo "  Logs:     $LOG_DIR/"
echo ""
echo "  Run 'bash scripts/stop.sh' to stop everything."
