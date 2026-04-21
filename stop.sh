#!/usr/bin/env bash

REPO="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$REPO/data"

echo "==> Cricket Batting Analysis — stopping services"

# ── Frontend ─────────────────────────────────────────────────────────────────
if [ -f "$LOG_DIR/frontend.pid" ]; then
  PID=$(cat "$LOG_DIR/frontend.pid")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" && echo "[frontend] stopped (PID $PID)"
  fi
  rm -f "$LOG_DIR/frontend.pid"
else
  pkill -f "vite.*cricket\|cricket.*vite" 2>/dev/null && echo "[frontend] stopped" || true
fi

# ── Worker ───────────────────────────────────────────────────────────────────
if [ -f "$LOG_DIR/worker.pid" ]; then
  PID=$(cat "$LOG_DIR/worker.pid")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" && echo "[worker] stopped (PID $PID)"
  fi
  rm -f "$LOG_DIR/worker.pid"
else
  pkill -f "arq app.worker.settings.WorkerSettings" 2>/dev/null && echo "[worker] stopped" || true
fi

# ── Backend ──────────────────────────────────────────────────────────────────
if [ -f "$LOG_DIR/backend.pid" ]; then
  PID=$(cat "$LOG_DIR/backend.pid")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" && echo "[backend] stopped (PID $PID)"
  fi
  rm -f "$LOG_DIR/backend.pid"
else
  PIDS=$(pgrep -f "uvicorn app.main:app.*8082" 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "$PIDS" | xargs kill 2>/dev/null && echo "[backend] stopped"
  fi
fi

# ── Redis ────────────────────────────────────────────────────────────────────
ENV_FILE="$REPO/.env"
REDIS_PORT=6382
if [ -f "$ENV_FILE" ]; then
  PORT_VAL=$(grep '^REDIS_PORT=' "$ENV_FILE" | cut -d= -f2)
  [ -n "$PORT_VAL" ] && REDIS_PORT="$PORT_VAL"
fi

if [ -f "$LOG_DIR/redis.pid" ]; then
  PID=$(cat "$LOG_DIR/redis.pid")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" && echo "[redis] stopped (PID $PID)"
  fi
  rm -f "$LOG_DIR/redis.pid"
else
  redis-cli -p "$REDIS_PORT" shutdown nosave 2>/dev/null && echo "[redis] stopped on $REDIS_PORT" || true
fi

echo "==> Done."
