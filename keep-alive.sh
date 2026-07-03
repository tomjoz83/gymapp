#!/usr/bin/env bash
# Starts the Personal Trainer server if it isn't already running.
# Driven by cron: once at boot (@reboot) and every minute as a watchdog.
DIR="/home/tj/claude/personal-trainer"
export PATH="/home/tj/.local/bin:$PATH"
export PORT=3000

if ! pgrep -f "${DIR}/server.js" >/dev/null 2>&1; then
  cd "$DIR" || exit 1
  nohup /home/tj/.local/bin/node "${DIR}/server.js" >> "${DIR}/server.log" 2>&1 &
fi
