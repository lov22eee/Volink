#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/setup-env.sh
docker compose up -d --wait db
mkdir -p .run
# PID files are hints only; compare command lines before reusing an existing process.
alive() {
  [ -f ".run/$1.pid" ] || return 1
  local pid
  pid=$(cat ".run/$1.pid")
  kill -0 "$pid" 2>/dev/null || return 1
  ps -p "$pid" -o args= | grep -F -- "$2" >/dev/null
}
if ! alive backend volink-api-0.1.0-SNAPSHOT.jar; then
  ./scripts/backend.sh -DskipTests package
  nohup ./scripts/run-backend.sh >.run/backend.log 2>&1 &
  echo "$!" >.run/backend.pid
fi
if ! alive frontend vite; then
  (cd frontend && exec nohup node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort) >.run/frontend.log 2>&1 &
  echo "$!" >.run/frontend.pid
fi
for attempt in $(seq 1 120); do
  if curl -fsS http://127.0.0.1:5173/api/project/status >/dev/null 2>&1 && curl -fsS http://127.0.0.1:5173/ >/dev/null 2>&1; then
    echo 'Frontend, backend, and MySQL are ready. Run ./scripts/check-dev.sh for functional checks.'
    exit 0
  fi
  sleep 2
done
echo 'Startup failed. Inspect .run/backend.log and .run/frontend.log.' >&2
exit 1
