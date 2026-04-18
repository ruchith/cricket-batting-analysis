#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
PID_DIR="$ROOT/.pids"

set -a; source "$ROOT/.env" 2>/dev/null || true; set +a
REDIS_PORT="${REDIS_PORT:-6382}"

stop_pid() {
  local name="$1"
  local pidfile="$PID_DIR/$name.pid"
  if [ -f "$pidfile" ]; then
    local pid
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null && echo "  ✓ $name stopped (pid $pid)"
    else
      echo "  - $name was not running (stale pid)"
    fi
    rm -f "$pidfile"
  else
    echo "  - $name: no pid file"
  fi
}

echo "Stopping Cricket Batting Analysis..."
stop_pid frontend
stop_pid worker
stop_pid backend

# Fallback: kill any orphaned processes by name
pkill -f "uvicorn app.main" 2>/dev/null && echo "  ✓ killed orphaned uvicorn" || true
pkill -f "arq app.worker"   2>/dev/null && echo "  ✓ killed orphaned worker"  || true

redis-cli -p "$REDIS_PORT" shutdown nosave 2>/dev/null \
  && echo "  ✓ Redis stopped" \
  || { pkill -f "redis-server" 2>/dev/null && echo "  ✓ Redis force-killed" || echo "  - Redis was not running"; }
rm -f "$PID_DIR/redis.pid"
echo "Done."
