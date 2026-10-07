#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
source .env
set +a
if [ -d .tools/jdk/usr/lib/jvm ] && [ -z "${JAVA_HOME:-}" ]; then
  export JAVA_HOME=$(python3 -c 'from pathlib import Path; print(next(Path(".tools/jdk/usr/lib/jvm").glob("java-21-openjdk-*")).resolve())')
fi
if [ -n "${JAVA_HOME:-}" ]; then
  exec "$JAVA_HOME/bin/java" -jar backend/target/volink-api-0.1.0-SNAPSHOT.jar "$@"
fi
exec java -jar backend/target/volink-api-0.1.0-SNAPSHOT.jar "$@"
