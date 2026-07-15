#!/usr/bin/env bash
# Start OPS-OS backend + frontend with one command.
# Usage: ./start.sh   (from repo root)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

# Stop backend + frontend child processes on exit / Ctrl-C.
cleanup() {
  echo ""
  echo "Stopping OPS-OS..."
  if [[ -n "${BACKEND_PID:-}" ]]; then kill "$BACKEND_PID" 2>/dev/null || true; fi
  if [[ -n "${FRONTEND_PID:-}" ]]; then kill "$FRONTEND_PID" 2>/dev/null || true; fi
  wait 2>/dev/null || true
  echo "Done."
}
trap cleanup EXIT INT TERM

if [[ ! -f "$BACKEND/.env" ]]; then
  echo "Missing backend/.env"
  echo "Copy your Supabase URLs into backend/.env (see backend/.env.example)."
  exit 1
fi

echo "→ Installing backend deps (if needed)..."
(cd "$BACKEND" && npm install --silent)

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
