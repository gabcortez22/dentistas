#!/usr/bin/env bash
# Starts the production server from .next, asserts /api/health, always stops the server.
set -euo pipefail
PORT="${PORT:-3123}"
LOG="${TMPDIR:-/tmp}/dentistas-serve.log"
./node_modules/.bin/next start -p "$PORT" >"$LOG" 2>&1 &
PID=$!
trap 'kill "$PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do
  if body="$(curl -sf "http://127.0.0.1:${PORT}/api/health")"; then
    test "$body" = '{"status":"ok"}'
    exit 0
  fi
  sleep 0.5
done
echo "health endpoint never answered; server log:" >&2
cat "$LOG" >&2
exit 1
