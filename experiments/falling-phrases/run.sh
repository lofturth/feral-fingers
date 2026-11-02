#!/bin/sh
set -eu
cd "$(dirname "$0")"
PORT="${1:-4185}"
echo "Starting Falling Phrases in worktree on http://127.0.0.1:$PORT/"
exec python3 -m http.server "$PORT" --bind 127.0.0.1
