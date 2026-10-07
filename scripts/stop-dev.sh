#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
for name in frontend backend; do
  file=".run/$name.pid"
  if [ -f "$file" ]; then
    pid=$(cat "$file")
    args=$(ps -p "$pid" -o args= || true)
    if [[ "$name" == frontend && "$args" == *vite* ]] || [[ "$name" == backend && "$args" == *volink-api-0.1.0-SNAPSHOT.jar* ]]; then
      kill "$pid" 2>/dev/null || true
    fi
    rm -f "$file"
  fi
done
# Preserve MySQL and its volume. To stop MySQL explicitly: docker compose stop db
