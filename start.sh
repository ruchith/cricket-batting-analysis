#!/usr/bin/env bash
set -e

REPO="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$REPO/.env"

if [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | grep -v '^$' | xargs)
fi

BACKEND_PORT="${BACKEND_PORT:-8082}"
FRONTEND_PORT="${FRONTEND_PORT:-3009}"
REDIS_PORT="${REDIS_PORT:-6382}"
LOG_DIR="$REPO/data"
mkdir -p "$LOG_DIR"

echo "==> Cricket Batting Analysis — starting services"
echo "    Redis:    port $REDIS_PORT"
echo "    Backend:  http://localhost:$BACKEND_PORT"
echo "    Frontend: http://localhost:$FRONTEND_PORT"
echo ""

# ── Redis ────────────────────────────────────────────────────────────────────
if redis-cli -p "$REDIS_PORT" ping &>/dev/null; then
  echo "[redis] already running on $REDIS_PORT"
else
  redis-server --port "$REDIS_PORT" --daemonize yes \
    --logfile "$LOG_DIR/redis.log" \
    --pidfile "$LOG_DIR/redis.pid"
  echo "[redis] started on $REDIS_PORT"
fi

# ── Backend ──────────────────────────────────────────────────────────────────
if lsof -ti tcp:"$BACKEND_PORT" &>/dev/null; then
  echo "[backend] port $BACKEND_PORT already in use — skipping"
else
  cd "$REPO/backend"
  nohup .venv/bin/uvicorn app.main:app \
    --host 0.0.0.0 --port "$BACKEND_PORT" --reload \
    >> "$LOG_DIR/backend.log" 2>&1 &
  echo $! > "$LOG_DIR/backend.pid"
  echo "[backend] started (PID $(cat "$LOG_DIR/backend.pid"))"
fi

# ── Worker ───────────────────────────────────────────────────────────────────
if pgrep -f "cricket-batting-analysis.*arq\|arq.*WorkerSettings" &>/dev/null; then
  echo "[worker] already running"
else
  cd "$REPO/backend"
  nohup .venv/bin/python -m arq app.worker.settings.WorkerSettings \
    >> "$LOG_DIR/worker.log" 2>&1 &
  echo $! > "$LOG_DIR/worker.pid"
  echo "[worker] started (PID $(cat "$LOG_DIR/worker.pid"))"
fi

# ── Frontend ─────────────────────────────────────────────────────────────────
if lsof -ti tcp:"$FRONTEND_PORT" &>/dev/null; then
  echo "[frontend] port $FRONTEND_PORT already in use — skipping"
else
  cd "$REPO/frontend"
  if [ ! -d node_modules ]; then
    echo "[frontend] running npm install..."
    npm install --silent
  fi
  FRONTEND_PORT="$FRONTEND_PORT" nohup npm run dev \
    >> "$LOG_DIR/frontend.log" 2>&1 &
  echo $! > "$LOG_DIR/frontend.pid"
  echo "[frontend] started (PID $(cat "$LOG_DIR/frontend.pid"))"
fi

echo ""
echo "==> All services started. Logs in $LOG_DIR/"
echo "    Frontend: http://localhost:$FRONTEND_PORT"
echo "    API docs: http://localhost:$BACKEND_PORT/docs"
echo ""
echo "    Run ./stop.sh to stop all services."
