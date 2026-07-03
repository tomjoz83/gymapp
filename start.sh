#!/usr/bin/env bash
# Start the Personal Trainer app.
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but was not found on PATH." >&2
  exit 1
fi

# Data is stored in a local JSON file (data.json) — no database needed.
# Node 18+ covers everything this app and its tests use (built-in test runner + fetch).
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js 18 or newer is required (found $(node -v))." >&2
  exit 1
fi

# Install Express the first time.
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

PORT="${PORT:-3000}"
echo "Starting Personal Trainer on http://localhost:${PORT}"
exec node server.js
