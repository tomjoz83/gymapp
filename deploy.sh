#!/usr/bin/env bash
# Deploy the Personal Trainer app on the VPS.
# Pulls the latest code from GitHub, installs any new deps, and restarts the service.
# Run manually with:  bash deploy.sh
# Or let the GitHub Actions workflow run it automatically on every push to master.
set -euo pipefail

# Move to the repo root (the dir this script lives in), regardless of where it's called from.
cd "$(dirname "$0")"

echo "==> Pulling latest from GitHub..."
# --ff-only refuses to create a messy merge if local and remote have diverged.
# If this fails, someone edited files on the VPS — see README/notes for how to resolve.
git fetch origin
git pull --ff-only

echo "==> Installing dependencies (only changes if package-lock.json changed)..."
# npm ci is faster and reproducible, but needs a lockfile; fall back to install otherwise.
if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

echo "==> Importing programs into the database..."
# DB_PATH must match the systemd service's DB_PATH env.
DB_PATH="${DB_PATH:-/home/tj/personal-trainer.db}" node scripts/import-programs.js ./programs

echo "==> Restarting the app (systemd service: personal-trainer)..."
sudo systemctl restart personal-trainer
sleep 2

echo "==> Service status:"
systemctl --no-pager --full status personal-trainer | head -n 8 || true

echo "==> HTTP check:"
# Hit a current endpoint. Unauthenticated /api returns 401 (server up + auth working);
# a 200/401 both mean the app is alive. (The old /api/workouts route was removed in Phase 3a.)
curl -s -o /dev/null -w "    http://localhost:3000/api/active-program -> HTTP %{http_code}\n" http://localhost:3000/api/active-program || true

echo "==> Deploy complete."
