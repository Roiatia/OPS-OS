#!/usr/bin/env bash
# Start OPS-OS backend + frontend with one command.
# Usage: ./start.sh   (from repo root)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

# Cloud SQL Auth Proxy settings (used when DATABASE_URL points at 127.0.0.1:5433).
PROXY_PORT=5433
PROXY_INSTANCE="ops-tools-503212:europe-west3:ops-os-db"

# Stop backend + frontend (and proxy, if we started it) on exit / Ctrl-C.
cleanup() {
  echo ""
  echo "Stopping OPS-OS..."
  if [[ -n "${BACKEND_PID:-}" ]]; then kill "$BACKEND_PID" 2>/dev/null || true; fi
  if [[ -n "${FRONTEND_PID:-}" ]]; then kill "$FRONTEND_PID" 2>/dev/null || true; fi
  if [[ -n "${PROXY_PID:-}" ]]; then kill "$PROXY_PID" 2>/dev/null || true; fi
  wait 2>/dev/null || true
  echo "Done."
}
trap cleanup EXIT INT TERM

if [[ ! -f "$BACKEND/.env" ]]; then
  echo "Missing backend/.env"
  echo "Copy your Cloud SQL (GCP) config into backend/.env (see backend/.env.example)."
  echo "Then start the proxy: cloud-sql-proxy --gcloud-auth --port $PROXY_PORT $PROXY_INSTANCE"
  exit 1
fi

# Returns 0 if something is already listening on the proxy port.
proxy_is_up() {
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$PROXY_PORT" >/dev/null 2>&1
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$PROXY_PORT") >/dev/null 2>&1
  fi
}

# If the backend is configured for Cloud SQL (proxy on 127.0.0.1:5433), make
# sure the proxy is running — auto-start it when possible, else fail fast.
if grep -Eq '^DATABASE_URL="postgresql://[^"]*(127\.0\.0\.1|localhost):'"$PROXY_PORT"'/' "$BACKEND/.env"; then
  if proxy_is_up; then
    echo "→ Cloud SQL Auth Proxy already running on :$PROXY_PORT"
  elif command -v cloud-sql-proxy >/dev/null 2>&1; then
    echo "→ Starting Cloud SQL Auth Proxy on :$PROXY_PORT ($PROXY_INSTANCE)"
    cloud-sql-proxy --gcloud-auth --port "$PROXY_PORT" "$PROXY_INSTANCE" &
    PROXY_PID=$!
    # Wait up to ~15s for the proxy to accept connections.
    for _ in $(seq 1 30); do
      proxy_is_up && break
      # Bail early if the proxy process died (e.g. auth failure).
      if ! kill -0 "$PROXY_PID" 2>/dev/null; then
        echo "Cloud SQL Auth Proxy exited on startup. Check 'gcloud auth' and try:"
        echo "  cloud-sql-proxy --gcloud-auth --port $PROXY_PORT $PROXY_INSTANCE"
        exit 1
      fi
      sleep 0.5
    done
    if ! proxy_is_up; then
      echo "Cloud SQL Auth Proxy did not come up on :$PROXY_PORT within timeout."
      exit 1
    fi
    echo "→ Cloud SQL Auth Proxy is ready on :$PROXY_PORT"
  else
    echo "backend/.env points at Cloud SQL (127.0.0.1:$PROXY_PORT) but nothing is listening"
    echo "and 'cloud-sql-proxy' is not installed / not on PATH."
    echo "Start it manually, or install it: https://cloud.google.com/sql/docs/postgres/sql-proxy"
    echo "  cloud-sql-proxy --gcloud-auth --port $PROXY_PORT $PROXY_INSTANCE"
    exit 1
  fi
fi

echo "→ Installing backend deps (if needed)..."
(cd "$BACKEND" && npm install --silent)

echo "→ Generating Prisma client..."
(cd "$BACKEND" && npx prisma generate)

echo "→ Installing frontend deps (if needed)..."
(cd "$FRONTEND" && npm install --silent)

echo ""
echo "→ Starting backend  (http://localhost:3001)"
(cd "$BACKEND" && npm run dev) &
BACKEND_PID=$!

echo "→ Starting frontend (http://localhost:5173)"
(cd "$FRONTEND" && npm run dev) &
FRONTEND_PID=$!

echo ""
echo "OPS-OS is running. Press Ctrl+C to stop both."
echo ""

wait
