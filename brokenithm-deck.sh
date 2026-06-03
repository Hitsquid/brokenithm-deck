#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-39868}"

node src/server.js &
server_pid=$!

cleanup() {
  kill "$server_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

url="http://${HOST}:${PORT}"
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$url" >/dev/null 2>&1 || true
fi

wait "$server_pid"
