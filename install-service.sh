#!/usr/bin/env bash
# One-shot installer: makes the Personal Trainer app run 24/7 via systemd.
# Run it with:  sudo bash /home/tj/claude/personal-trainer/install-service.sh
set -e

DIR="/home/tj/claude/personal-trainer"

echo "==> Stopping any running dev server (freeing port 3000)..."
pkill -f "${DIR}/server.js" 2>/dev/null || true
sleep 1

echo "==> Installing systemd service..."
cp "${DIR}/personal-trainer.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now personal-trainer
sleep 1

echo
echo "==> Service status:"
systemctl --no-pager --full status personal-trainer | head -n 8 || true

echo
echo "==> HTTP check:"
curl -s -o /dev/null -w "    http://localhost:3000 -> HTTP %{http_code}\n" http://localhost:3000/api/workouts || true

echo
echo "==> Done. The app now starts on boot and restarts automatically if it crashes."
