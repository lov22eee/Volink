#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -e .env ]; then
  echo '.env exists; preserving the current configuration.'
  exit 0
fi
umask 077
python3 - <<'PY'
import os, secrets
with open('.env', 'x') as f:
    f.write('MYSQL_DATABASE=volink\nMYSQL_USER=volink\n')
    f.write('MYSQL_PASSWORD=' + secrets.token_hex(24) + '\n')
    f.write('MYSQL_ROOT_PASSWORD=' + secrets.token_hex(32) + '\n')
    f.write('MYSQL_PORT=3307\nSERVER_PORT=8080\n')
os.chmod('.env', 0o600)
print('Created ignored .env with random local database passwords; values are not printed.')
PY
